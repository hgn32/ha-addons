#!/usr/bin/env bash
set -uo pipefail

LOG_FILE="/data/session_opener.log"
TS="$(date '+%Y-%m-%d %H:%M:%S') (${TZ:-UTC})"
STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap 'rm -f "${STDOUT_FILE}" "${STDERR_FILE}"' EXIT

# 注意: --bare は使用しないこと。--bare を付けると Anthropic 認証が
# ANTHROPIC_API_KEY / apiKeyHelper に固定され、OAuth（サブスクリプション）
# 認証情報が一切読まれなくなり、このアドオンの目的（従量課金APIキーを使わず
# サブスクリプションの5時間セッションを起点にすること）と矛盾するため。
#
# --output-format json は標準出力にのみ JSON を出す前提のため、標準エラー
# 出力（更新通知等）と混ぜて解析すると壊れる。ストリームを分けて記録する。
claude -p "ok" \
  --model haiku \
  --output-format json \
  --no-session-persistence >"${STDOUT_FILE}" 2>"${STDERR_FILE}"
EXIT_CODE=$?
STDOUT="$(cat "${STDOUT_FILE}")"
STDERR="$(cat "${STDERR_FILE}")"

echo "${TS} exit=${EXIT_CODE} stdout: ${STDOUT}" >> "${LOG_FILE}"
[ -n "${STDERR}" ] && echo "${TS} stderr: ${STDERR}" >> "${LOG_FILE}"

if [ "${EXIT_CODE}" -ne 0 ]; then
  SUMMARY="コマンドが失敗しました（終了コード: ${EXIT_CODE}）: $(printf '%s' "${STDOUT}${STDERR}" | head -c 300)"
else
  SUMMARY=$(node -e '
const raw = require("fs").readFileSync(process.argv[1], "utf8");
try {
  const j = JSON.parse(raw);
  if (j.is_error) {
    console.log("エラー: " + (j.result || j.subtype || "unknown"));
  } else {
    console.log("成功: 応答=" + JSON.stringify(j.result) + " session_id=" + j.session_id);
  }
} catch (e) {
  console.log("");
}
' "${STDOUT_FILE}" 2>/dev/null)
  if [ -z "${SUMMARY}" ]; then
    SUMMARY="応答の解析に失敗しました: $(printf '%s' "${STDOUT}" | head -c 300)"
  fi
fi

echo "セッションオープナー実行結果: ${SUMMARY}"
echo "${TS} summary: ${SUMMARY}" >> "${LOG_FILE}"

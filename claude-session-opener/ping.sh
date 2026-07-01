#!/usr/bin/env bash
set -uo pipefail

LOG_FILE="/data/session_opener.log"
TS="$(date '+%Y-%m-%d %H:%M:%S') (${TZ:-UTC})"

# 注意: --bare は使用しないこと。--bare を付けると Anthropic 認証が
# ANTHROPIC_API_KEY / apiKeyHelper に固定され、OAuth（サブスクリプション）
# 認証情報が一切読まれなくなり、このアドオンの目的（従量課金APIキーを使わず
# サブスクリプションの5時間セッションを起点にすること）と矛盾するため。
RAW=$(claude -p "ok" \
  --model haiku \
  --output-format json \
  --no-session-persistence 2>&1)
EXIT_CODE=$?

echo "${TS} exit=${EXIT_CODE} raw: ${RAW}" >> "${LOG_FILE}"

if [ "${EXIT_CODE}" -ne 0 ]; then
  SUMMARY="コマンドが失敗しました（終了コード: ${EXIT_CODE}）"
else
  SUMMARY=$(echo "${RAW}" | node -e '
const raw = require("fs").readFileSync(0, "utf8");
try {
  const j = JSON.parse(raw);
  if (j.is_error) {
    console.log("エラー: " + (j.result || j.subtype || "unknown"));
  } else {
    console.log("成功: 応答=" + JSON.stringify(j.result) + " session_id=" + j.session_id);
  }
} catch (e) {
  console.log("応答の解析に失敗しました（詳細は /data/session_opener.log を参照）");
}
' 2>/dev/null)
  [ -z "${SUMMARY}" ] && SUMMARY="応答の解析に失敗しました（詳細は ${LOG_FILE} を参照）"
fi

echo "セッションオープナー実行結果: ${SUMMARY}"
echo "${TS} summary: ${SUMMARY}" >> "${LOG_FILE}"

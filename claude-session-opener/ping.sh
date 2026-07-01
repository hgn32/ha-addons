#!/usr/bin/env bash
set -uo pipefail

LOG_FILE="/data/session_opener.log"

# 注意: --bare は使用しないこと。--bare を付けると Anthropic 認証が
# ANTHROPIC_API_KEY / apiKeyHelper に固定され、OAuth（サブスクリプション）
# 認証情報が一切読まれなくなり、このアドオンの目的（従量課金APIキーを使わず
# サブスクリプションの5時間セッションを起点にすること）と矛盾するため。
RESULT=$(claude -p "ok" \
  --model haiku \
  --output-format json \
  --no-session-persistence 2>&1) || true

echo "$(date -Iseconds) result: ${RESULT}" >> "${LOG_FILE}"

# 動作確認: この呼び出しが実際に5時間セッションを起点にしたかは、
# Claude Code 内で /usage を確認して検証する必要がある。2026年6月15日以降の
# 課金変更により、claude -p は対話利用のセッション枠にカウントされず、
# 別枠の Agent SDK クレジットから消費される可能性がある（試験的機能）。
echo "$(date -Iseconds) NOTE: この呼び出しが実際に5時間セッションを起点にしたかは、Claude Code内で /usage を確認して検証してください。2026年6月15日以降の課金変更により、claude -p はセッション枠にカウントされない可能性があります。" >> "${LOG_FILE}"

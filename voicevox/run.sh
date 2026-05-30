#!/bin/bash

CONFIG_FILE=/config/configuration.yaml
TTS_MARKER="platform: voicevox_tts"

if [ ! -f "$CONFIG_FILE" ] || ! grep -q "$TTS_MARKER" "$CONFIG_FILE"; then
    echo ""
    echo "=========================================="
    echo "[VOICEVOX] TTS が configuration.yaml に未設定です。"
    echo "以下を /config/configuration.yaml に追記してください："
    echo ""
    echo "tts:"
    echo "  - platform: voicevox_tts"
    echo "    host: 127.0.0.1"
    echo "    port: 50021"
    echo "    speaker: 10"
    echo "#  3:ずんだもん"
    echo "# 10:雨晴はう"
    echo "# 24:WhiteCUL"
    echo "# 89:Voidoll"
    echo "# 58:猫使ビィ"
    echo "# 48:ナースロボ＿タイプＴ"
    echo "# 46:小夜/SAYO"
    echo ""
    echo "追記後、Home Assistant を再起動してください。"
    echo "=========================================="
    echo ""
fi

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

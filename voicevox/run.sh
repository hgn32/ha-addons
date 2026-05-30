#!/bin/bash

CONFIG_FILE=/config/configuration.yaml
TTS_MARKER="platform: voicevox_tts"

if [ -f "$CONFIG_FILE" ] && grep -q "$TTS_MARKER" "$CONFIG_FILE"; then
    echo "[VOICEVOX] TTS config already present in configuration.yaml, skipping."
else
    echo "[VOICEVOX] Adding TTS config to configuration.yaml..."
    cat >> "$CONFIG_FILE" << 'EOF'

tts:
  - platform: voicevox_tts
    host: 127.0.0.1
    port: 50021
    speaker: 10
#  3:ずんだもん
# 10:雨晴はう
# 24:WhiteCUL
# 89:Voidoll
# 58:猫使ビィ
# 48:ナースロボ＿タイプＴ
# 46:小夜/SAYO
EOF
    echo "[VOICEVOX] Done."
fi

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

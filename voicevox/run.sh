#!/bin/bash

# Deploy custom component
DEST=/config/custom_components/voicevox_tts
mkdir -p "$DEST"
cp -r /custom_components/voicevox_tts/. "$DEST/"
echo "[VOICEVOX] Custom component deployed to $DEST"

# Advertise via mDNS for HA auto-discovery
python3 /advertise.py &

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

#!/usr/bin/env bash
set -e

python3 /advertise.py &

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

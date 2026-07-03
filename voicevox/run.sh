#!/usr/bin/env bash
set -e

python3 /advertise.py &

# 最大メモリ使用量 (max_memory_mb) -> ulimit -v (仮想メモリ上限)
# VOICEVOX Engine は Python プロセスで JVM の -Xmx のようなヒープ上限指定がないため、
# OS レベルの仮想アドレス空間(RLIMIT_AS)を制限することで代用する。
# 共有ライブラリ等の mmap 分だけ実メモリ(RSS)より緩い上限になる点に注意。
MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else "" end' /data/options.json 2>/dev/null)
[ -z "$MAX_MEMORY_MB" ] && MAX_MEMORY_MB=2048
echo "[voicevox] max virtual memory: ${MAX_MEMORY_MB}MB (ulimit -v)"
ulimit -v $((MAX_MEMORY_MB * 1024))

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

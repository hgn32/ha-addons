#!/usr/bin/env bash
set -e

python3 /advertise.py &

# 最大メモリ使用量 (max_memory_mb) -> ulimit -v (仮想メモリ上限)
# VOICEVOX Engine は Python プロセスで JVM の -Xmx のようなヒープ上限指定がないため、
# OS レベルの仮想アドレス空間(RLIMIT_AS)を制限することで代用する。
# 仮想アドレス空間は onnxruntime の予約領域等で実メモリ(RSS)より大幅に大きくなるため、
# 小さい値を設定するとエンジンがメモリ確保に失敗して落ちる(50021 が Connection refused になる)。
# 既定は 0 = 無制限。0 より大きい値を明示設定した場合のみ適用する。
MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else "" end' /data/options.json 2>/dev/null)
[ -z "$MAX_MEMORY_MB" ] && MAX_MEMORY_MB=0
if [ "$MAX_MEMORY_MB" -gt 0 ]; then
    echo "[voicevox] max virtual memory: ${MAX_MEMORY_MB}MB (ulimit -v)"
    echo "[voicevox] 注意: 値が小さすぎるとエンジンが起動できず 50021 が Connection refused になります。その場合は max_memory_mb を 0 (無制限) に戻してください。"
    ulimit -v $((MAX_MEMORY_MB * 1024))
else
    echo "[voicevox] max virtual memory: unlimited (max_memory_mb=0)"
fi

exec gosu user /opt/voicevox_engine/run \
    --cors_policy_mode all \
    --cpu_num_threads 6 \
    --host 0.0.0.0 \
    --load_all_models

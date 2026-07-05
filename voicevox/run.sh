#!/usr/bin/env bash
set -e

python3 /advertise.py &

# ---- 設定の読み込み(診断のため内容をそのままログタブに表示する) ----
OPTIONS_JSON=$(cat /data/options.json 2>/dev/null || echo '{}')
echo "[voicevox] options.json: ${OPTIONS_JSON}"

MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else 0 end' <<<"${OPTIONS_JSON}" 2>/dev/null || echo 0)
LOAD_ALL_MODELS=$(jq -r 'if (.load_all_models == false) then "false" else "true" end' <<<"${OPTIONS_JSON}" 2>/dev/null || echo true)

# 最大メモリ使用量 (max_memory_mb) -> ulimit -v (仮想メモリ上限)
# 仮想アドレス空間(VSZ)は実メモリ(RSS)より大幅に大きくなるため、小さい値では
# モデル読み込み中にメモリ確保に失敗し、エンジンが待ち受け開始まで到達しないことがある。
# 既定 0 = 無制限。実測の RSS/VSZ は下の起動監視ログで確認できる。
if [ "${MAX_MEMORY_MB}" -gt 0 ] 2>/dev/null; then
    ulimit -v $((MAX_MEMORY_MB * 1024))
    echo "[voicevox] ulimit -v を適用: ${MAX_MEMORY_MB}MB"
else
    MAX_MEMORY_MB=0
    echo "[voicevox] ulimit -v: 無制限 (max_memory_mb=0)"
fi

ENGINE_ARGS=(--cors_policy_mode all --cpu_num_threads 6 --host 0.0.0.0)
if [ "${LOAD_ALL_MODELS}" = "true" ]; then
    ENGINE_ARGS+=(--load_all_models)
fi
echo "[voicevox] 起動コマンド: /opt/voicevox_engine/run ${ENGINE_ARGS[*]}"

gosu user /opt/voicevox_engine/run "${ENGINE_ARGS[@]}" &
ENGINE_PID=$!
trap 'kill -TERM "${ENGINE_PID}" 2>/dev/null' TERM INT

# ---- 起動監視: 50021 で待ち受けを開始するまで 15 秒ごとに状態をログに出す ----
(
    START=$(date +%s)
    TICK=0
    while kill -0 "${ENGINE_PID}" 2>/dev/null; do
        if python3 -c "import socket;socket.create_connection(('127.0.0.1',50021),timeout=2).close()" 2>/dev/null; then
            ELAPSED=$(( $(date +%s) - START ))
            VERSION=$(python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:50021/version',timeout=5).read().decode().strip())" 2>/dev/null || echo "?")
            echo "[voicevox] OK: エンジン起動完了。50021 で待ち受け中 (${ELAPSED}秒, エンジン版 ${VERSION})"
            exit 0
        fi
        TICK=$((TICK + 1))
        if [ $((TICK % 3)) -eq 0 ]; then
            ELAPSED=$(( $(date +%s) - START ))
            MEM=$(awk '/VmRSS/{r=$2} /VmSize/{v=$2} END{printf "RSS=%dMB VSZ=%dMB", r/1024, v/1024}' "/proc/${ENGINE_PID}/status" 2>/dev/null || echo "RSS=? VSZ=?")
            echo "[voicevox] 起動待ち ${ELAPSED}秒: ${MEM} (上限=${MAX_MEMORY_MB}MB, 0=無制限)"
        fi
        sleep 5
    done
    echo "[voicevox] 起動監視: エンジンは 50021 の待ち受け開始前にプロセスが消滅しました"
) &

EXIT_CODE=0
wait "${ENGINE_PID}" || EXIT_CODE=$?
echo "[voicevox] エンジンプロセスが終了しました (exit code=${EXIT_CODE})"
exit "${EXIT_CODE}"

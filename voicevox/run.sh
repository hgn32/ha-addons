#!/usr/bin/env bash
set -e

python3 /advertise.py &

# ---- 設定の読み込み(診断のため内容をそのままログタブに表示する) ----
OPTIONS_JSON=$(cat /data/options.json 2>/dev/null || echo '{}')
echo "[voicevox] options.json: ${OPTIONS_JSON}"

MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else 0 end' <<<"${OPTIONS_JSON}" 2>/dev/null || echo 0)
LOAD_ALL_MODELS=$(jq -r 'if (.load_all_models == false) then "false" else "true" end' <<<"${OPTIONS_JSON}" 2>/dev/null || echo true)
# 指定スタイルのみ事前読み込み(スタイルIDのリスト)。使う場合は load_all_models=false と併用する。
# スキーマは list(str) だが、GUI がスカラーや旧形式(数値)で送っても壊れないよう配列/スカラー両対応にする。
PRELOAD_IDS=$(jq -r '(.preload_speaker_ids // []) | (if type=="array" then . else [.] end) | map(tostring) | join(" ")' <<<"${OPTIONS_JSON}" 2>/dev/null || echo "")

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

# ---- 設定・辞書の永続化 ----
# VOICEVOX Engine は設定(CORS/allow_origin)・ユーザー辞書・プリセットを
# XDG_DATA_HOME 配下の voicevox-engine/ に読み書きする。既定はコンテナ内の非永続領域の
# ため再起動で消える。保存先を /data に移すだけで、設定も辞書もまとめて永続化される
# (実測確認済み: 設定ページでの変更が /data/xdg に保存され、再起動後も復元される)。
# CORS はエンジン既定の localapps。TTS(サーバー間通信)や設定ページの表示には影響しない。
# 変更したい場合は設定ページ(http://<HAのアドレス>:50021/setting)から行うと永続化される。
export XDG_DATA_HOME=/data/xdg
mkdir -p "${XDG_DATA_HOME}"
# gosu user で実行するエンジンが読み書きできるよう所有権を付与する。
chown -R user:user "${XDG_DATA_HOME}" 2>/dev/null || true

ENGINE_ARGS=(--cpu_num_threads 6 --host 0.0.0.0)
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
            # 指定スタイルの事前読み込み(モデル読み込み済みならエンジン側で no-op)
            for SID in ${PRELOAD_IDS}; do
                if python3 -c "import urllib.request;urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:50021/initialize_speaker?speaker=${SID}&skip_reinit=true',method='POST'),timeout=180).read()" 2>/dev/null; then
                    echo "[voicevox] スタイルID ${SID} を事前読み込みしました"
                else
                    echo "[voicevox] 警告: スタイルID ${SID} の事前読み込みに失敗しました(存在しないIDの可能性)"
                fi
            done
            if [ -n "${PRELOAD_IDS}" ]; then
                MEM=$(awk '/VmRSS/{r=$2} /VmSize/{v=$2} END{printf "RSS=%dMB VSZ=%dMB", r/1024, v/1024}' "/proc/${ENGINE_PID}/status" 2>/dev/null || echo "RSS=? VSZ=?")
                echo "[voicevox] 事前読み込み完了後のメモリ: ${MEM}"
            fi
            # 上限運用時の余裕チェック: 未読込スタイルの初回読み込みは VSZ を約1GB 消費する
            if [ "${MAX_MEMORY_MB}" -gt 0 ]; then
                VSZ_NOW=$(awk '/VmSize/{print int($2/1024)}' "/proc/${ENGINE_PID}/status" 2>/dev/null || echo 0)
                HEADROOM=$((MAX_MEMORY_MB - VSZ_NOW))
                if [ "${HEADROOM}" -lt 1024 ]; then
                    echo "[voicevox] 警告: 仮想メモリ上限 ${MAX_MEMORY_MB}MB まで残り ${HEADROOM}MB です。事前読み込みしていないスタイルを初めて使うと上限を超えて合成に失敗する恐れがあります。他のスタイルも使う場合は max_memory_mb を 0(無制限)にするか増やしてください。"
                fi
            fi
            exit 0
        fi
        TICK=$((TICK + 1))
        if [ $((TICK % 3)) -eq 0 ]; then
            ELAPSED=$(( $(date +%s) - START ))
            MEM=$(awk '/VmRSS/{r=$2} /VmSize/{v=$2} END{printf "RSS=%dMB VSZ=%dMB", r/1024, v/1024}' "/proc/${ENGINE_PID}/status" 2>/dev/null || echo "RSS=? VSZ=?")
            # /proc/meminfo・loadavg はコンテナ内でもホスト全体の値を示す
            HOSTMEM=$(awk '/MemAvailable/{printf "%dMB", $2/1024}' /proc/meminfo 2>/dev/null || echo "?")
            LOAD=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null || echo "?")
            echo "[voicevox] 起動待ち ${ELAPSED}秒: ${MEM} (上限=${MAX_MEMORY_MB}MB, 0=無制限) / ホスト空きメモリ=${HOSTMEM} load=${LOAD}"
        fi
        sleep 5
    done
    echo "[voicevox] 起動監視: エンジンは 50021 の待ち受け開始前にプロセスが消滅しました"
) &

EXIT_CODE=0
wait "${ENGINE_PID}" || EXIT_CODE=$?
echo "[voicevox] エンジンプロセスが終了しました (exit code=${EXIT_CODE})"
exit "${EXIT_CODE}"

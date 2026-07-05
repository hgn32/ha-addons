#!/bin/bash
echo "---------- start original exec ----------"

###### JVM 最大メモリ使用量 (max_memory_mb) -> JAVA_TOOL_OPTIONS
# 本家の startup_script.sh は `java -jar ...` を直接起動し JAVA_OPTS 等を
# 一切参照しないため、JVM が自動で拾う JAVA_TOOL_OPTIONS 経由で -Xmx を渡す。
MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else "" end' /data/options.json 2>/dev/null)
[ -z "$MAX_MEMORY_MB" ] && MAX_MEMORY_MB=2048
export JAVA_TOOL_OPTIONS="-Xmx${MAX_MEMORY_MB}m"
echo "---------- JVM max heap size: ${MAX_MEMORY_MB}MB ----------"

###### 永続データディレクトリ (/config/tachidesk)
# 個々のファイルを /config へシンボリックリンクする方式は使わない。
# 上流 startup_script.sh の `sed -i`(server.conf)や Suwayomi 本体の
# H2 マイグレーション(Files.copy REPLACE_EXISTING で database.mv.db を差し替え)
# は「一時ファイル + rename/置き換え」でリンク自体を実ファイルに変えてしまい、
# 以後の書き込みがコンテナ内へ落ちてアップデートのたびに巻き戻る。
# Tachidesk データディレクトリ全体を /config/tachidesk に置き、
# コンテナ側はディレクトリごとリンクする(rename はディレクトリ内で完結し安全)。
TACHIDESK=/home/suwayomi/.local/share/Tachidesk
PERSIST=/config/tachidesk
mkdir -p "$PERSIST"

###### 旧レイアウト(/config 直下のファイル)からの一回限りの移行
if [ ! -f "$PERSIST/.layout-v2" ]; then
    echo "---------- migrating legacy /config files into $PERSIST ----------"
    for f in database.mv.db database.trace.db server.conf options.json; do
        if [ -e "/config/$f" ] && [ ! -e "$PERSIST/$f" ]; then
            mv "/config/$f" "$PERSIST/$f"
            echo "moved /config/$f -> $PERSIST/$f"
        fi
    done
    if [ -d /config/extensions ] && [ ! -e "$PERSIST/extensions" ]; then
        mv /config/extensions "$PERSIST/extensions"
        echo "moved /config/extensions -> $PERSIST/extensions"
    fi
    # Suwayomi は suwayomi ユーザーで動くため、移行したファイルの所有権を渡す
    chown -R suwayomi:suwayomi "$PERSIST" 2>/dev/null || chmod -R a+rwX "$PERSIST"
    touch "$PERSIST/.layout-v2"
fi

###### 非永続ディレクトリ (bin / cache / logs / downloads / thumbnails / backups)
# これらは容量が大きい・キャッシュ・バージョン密結合・(ユーザーの明示的な希望で)
# バックアップに含めたくない、のいずれかに該当する。永続領域には「コンテナ内
# ディレクトリへのシンボリックリンク」だけを置く(tar はリンクを辿らないので
# HA のバックアップにはリンクエントリしか入らない)。実体はコンテナ内なので:
#   - 再起動では残る / アドオン更新で消える
#   - bin(KCEF 等バージョン密結合バイナリ)は本体が起動時に自動で再取得する
#   - backups(.tachibk)は「更新前に作成 → 更新後に復元」のために
#     一旦 PC 側にダウンロードしておく運用に変更(README 参照)。
#     ホストの /addon_configs/<slug>/backups からは直接見えなくなる
# webUI はここに含めない(= 永続・バックアップ対象)。Suwayomi 本体は起動の
# たびに webUI ディレクトリを削除→実ディレクトリとして作り直して静的アセットを
# 展開し直すため、symlink を張っても起動時に実体へ置き換わってしまい、
# symlink 方式では対象外にできない(0.20 で試みたが機能していなかった)。
EPHEMERAL=/var/lib/tachidesk-ephemeral
mkdir -p "$EPHEMERAL"
for d in bin cache logs downloads thumbnails backups; do
    mkdir -p "$EPHEMERAL/$d"
    # 過去バージョンで永続化されてしまった実体はバックアップ肥大の元なので破棄
    if [ -e "$PERSIST/$d" ] && [ ! -L "$PERSIST/$d" ]; then
        rm -rf "$PERSIST/$d"
    fi
    ln -sfn "$EPHEMERAL/$d" "$PERSIST/$d"
done
chown -R suwayomi:suwayomi "$EPHEMERAL" 2>/dev/null || chmod -R a+rwX "$EPHEMERAL"

###### 0.20 が張った webUI の symlink の除去(一回限りの移行)
# webUI は 0.21 から永続・バックアップ対象(上のコメント参照)。リンク先の
# 非永続領域はもう用意しないため、残っていたらここで外す。本体が起動時に
# 実ディレクトリとして作り直し、以後は永続領域に残る。
if [ -L "$PERSIST/webUI" ]; then
    rm -f "$PERSIST/webUI"
fi

###### 旧 /config/backups(0.16〜0.19 時代の実体)からの一回限りの退避
# 中身は一度だけ新しい保存先(コンテナ内、非永続)へコピーして今回のセッション
# では引き続き参照できるようにしつつ、host からの残骸表示を消すため空にする。
if [ -d /config/backups ] && [ ! -L /config/backups ]; then
    echo "---------- migrating legacy /config/backups (now non-persistent) ----------"
    find /config/backups -mindepth 1 -maxdepth 1 -exec mv {} "$EPHEMERAL/backups/" \; 2>/dev/null
    rmdir /config/backups 2>/dev/null
fi

###### 掃除
# 前コンテナが強制終了した場合に残る H2 のロックファイル
rm -f "$PERSIST/database.lock.db"
# Suwayomi の H2 マイグレーションが残す一時ファイル・退避コピー
# (database.mv.db.*.backup は DB と同サイズありバックアップを肥大させる。
#  DB 本体と .tachibk が残っているので不要)
rm -f "$PERSIST"/database.mv.db.*.backup "$PERSIST"/database.*.sql

###### コンテナ側 Tachidesk をディレクトリごとリンク
if [ -L "$TACHIDESK" ]; then
    rm -f "$TACHIDESK"
else
    rm -rf "$TACHIDESK"
fi
ln -s "$PERSIST" "$TACHIDESK"

###### 所有権の自動修復
# /config 配下は HA のバックアップ復元や過去バージョンの経緯で root 所有の
# ファイルが混ざることがあり、suwayomi ユーザーで動く本体が書き込めず
# 「Permission denied」(例: extensions/icon/*.tmp)になる。
# 所有者が suwayomi でないものだけを毎起動時に修復する(chown -h は
# シンボリックリンク自体を対象にし、リンク先には触らない)。
find "$PERSIST" ! -user suwayomi -exec chown -h suwayomi:suwayomi {} + 2>/dev/null \
    || chmod -R a+rwX "$PERSIST" 2>/dev/null

###### ls
echo "---------- ls:/config ----------"
ls -la /config
echo "---------- ls:$PERSIST ----------"
ls -la "$PERSIST"

###### Summary viewer (ingress :8099)
# Runs alongside the Suwayomi server in the same container, sharing /config.
# Reachable Suwayomi API is on localhost:4567 (overridable via add-on options).
# BACKUP_DIR points at the Suwayomi server's backup folder. これは 0.20 から
# 非永続領域(コンテナ内、$EPHEMERAL/backups)を指す。参照は同一コンテナ内
# なので ingress パネルからの閲覧・ダウンロードは引き続き問題なく行える。
echo "---------- start summary viewer (:8099) ----------"
BACKUP_DIR="$EPHEMERAL/backups" \
ALIASES_FILE=/config/aliases.json \
OPTIONS_FILE=/data/options.json \
/opt/summary/venv/bin/uvicorn app.main:app \
  --app-dir /opt/summary --host 0.0.0.0 --port 8099 &

echo "---------- fin original exec ----------"
exec runuser -p -u suwayomi -- /bin/bash /home/suwayomi/startup_script.sh

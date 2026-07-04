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

###### backups
# Suwayomi は自動バックアップ (.tachibk) を <dataDir>/backups に書く。
# 実体は従来どおり /config/backups に置き(統合 Summary viewer の
# 「サーバ上のフォルダから選択」やホストの /addon_configs/<slug>/backups が
# ここを参照する)、Tachidesk 側からはディレクトリリンクで参照させる。
mkdir -p /config/backups
chown suwayomi:suwayomi /config/backups 2>/dev/null || chmod 0777 /config/backups
if [ ! -L "$PERSIST/backups" ]; then
    # 実ディレクトリとして作られていた場合は中身を /config/backups へ退避
    if [ -d "$PERSIST/backups" ]; then
        mv "$PERSIST/backups"/* /config/backups/ 2>/dev/null
    fi
    rm -rf "$PERSIST/backups"
    ln -s /config/backups "$PERSIST/backups"
fi

###### バージョン依存物の掃除
# bin/ には KCEF(Chromium)などサーババージョンと密結合のバイナリが入る。
# 永続化したままアップデートすると不整合で起動しなくなるため毎回作り直させる
# (上流 startup_script.sh が bin/kcef を再リンク/再取得する)。cache/ も同様。
rm -rf "$PERSIST/bin" "$PERSIST/cache"
# 前コンテナが強制終了した場合に残る H2 のロックファイルを掃除
rm -f "$PERSIST/database.lock.db"

###### コンテナ側 Tachidesk をディレクトリごとリンク
if [ -L "$TACHIDESK" ]; then
    rm -f "$TACHIDESK"
else
    rm -rf "$TACHIDESK"
fi
ln -s "$PERSIST" "$TACHIDESK"
# ディレクトリ自体は毎回所有権を確認(中身は suwayomi ユーザーが作るので不要)
chown suwayomi:suwayomi "$PERSIST" 2>/dev/null || chmod a+rwX "$PERSIST"

###### ls
echo "---------- ls:/config ----------"
ls -la /config
echo "---------- ls:$PERSIST ----------"
ls -la "$PERSIST"

###### Summary viewer (ingress :8099)
# Runs alongside the Suwayomi server in the same container, sharing /config.
# Reachable Suwayomi API is on localhost:4567 (overridable via add-on options).
# BACKUP_DIR points at the Suwayomi server's backup folder (/config/backups).
echo "---------- start summary viewer (:8099) ----------"
BACKUP_DIR=/config/backups \
ALIASES_FILE=/config/aliases.json \
OPTIONS_FILE=/data/options.json \
/opt/summary/venv/bin/uvicorn app.main:app \
  --app-dir /opt/summary --host 0.0.0.0 --port 8099 &

echo "---------- fin original exec ----------"
exec runuser -p -u suwayomi -- /bin/bash /home/suwayomi/startup_script.sh

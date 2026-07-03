#!/bin/bash
echo "---------- start original exec ----------"

###### JVM 最大メモリ使用量 (max_memory_mb) -> JAVA_TOOL_OPTIONS
# 本家の startup_script.sh は `java -jar ...` を直接起動し JAVA_OPTS 等を
# 一切参照しないため、JVM が自動で拾う JAVA_TOOL_OPTIONS 経由で -Xmx を渡す。
MAX_MEMORY_MB=$(jq -r 'if (.max_memory_mb != null) then .max_memory_mb else "" end' /data/options.json 2>/dev/null)
[ -z "$MAX_MEMORY_MB" ] && MAX_MEMORY_MB=2048
export JAVA_TOOL_OPTIONS="-Xmx${MAX_MEMORY_MB}m"
echo "---------- JVM max heap size: ${MAX_MEMORY_MB}MB ----------"

###### server.conf
rm -f /home/suwayomi/.local/share/Tachidesk/server.conf
ln -s /config/server.conf /home/suwayomi/.local/share/Tachidesk/server.conf

###### options.json
rm -f /home/suwayomi/.local/share/Tachidesk/options.json
ln -s /config/options.json /home/suwayomi/.local/share/Tachidesk/options.json

###### database.mv.db
rm -f /home/suwayomi/.local/share/Tachidesk/database.mv.db
ln -s /config/database.mv.db /home/suwayomi/.local/share/Tachidesk/database.mv.db

###### database.trace.db
rm -f /home/suwayomi/.local/share/Tachidesk/database.trace.db
ln -s /config/database.trace.db /home/suwayomi/.local/share/Tachidesk/database.trace.db

###### extensions
rm -rf /home/suwayomi/.local/share/Tachidesk/extensions
ln -s /config/extensions /home/suwayomi/.local/share/Tachidesk/extensions

###### backups
# Suwayomi writes automated backups (.tachibk) under <dataDir>/backups.
# Persist them under /config/backups so they survive restarts AND so the
# integrated Summary viewer's "サーバ上のフォルダから選択" lists them.
mkdir -p /config/backups
# Created as root, but the Suwayomi server runs as the 'suwayomi' user and must
# be able to write automated backups here. Hand ownership over (fall back to a
# permissive mode if the user/group can't be resolved).
chown suwayomi:suwayomi /config/backups 2>/dev/null || chmod 0777 /config/backups
rm -rf /home/suwayomi/.local/share/Tachidesk/backups
ln -s /config/backups /home/suwayomi/.local/share/Tachidesk/backups

###### ls
echo "---------- ls:/config ----------"
ls -la /config
echo "---------- ls:/home/suwayomi/.local/share/Tachidesk/ ----------"
ls -la /home/suwayomi/.local/share/Tachidesk/

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

#!/bin/bash
echo "---------- start original exec ----------"
###### server.conf
rm -f /home/suwayomi/.local/share/Tachidesk/server.conf
ln -s /config/server.conf /home/suwayomi/.local/share/Tachidesk/server.conf

###### server.conf
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

###### ls
echo "---------- ls:/config ----------"
ls -la /config
echo "---------- ls:/home/suwayomi/.local/share/Tachidesk/ ----------"
ls -la /home/suwayomi/.local/share/Tachidesk/

echo "---------- fin original exec ----------"
exec runuser -p -u suwayomi -- /bin/bash /home/suwayomi/startup_script.sh

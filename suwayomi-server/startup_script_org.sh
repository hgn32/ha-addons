#!/bin/bash
echo "---------- start original exec ----------"
###### server.conf
rm -f /home/suwayomi/.local/share/Tachidesk/server.conf
ln -s /config/suwayomi/server.conf /home/suwayomi/.local/share/Tachidesk/server.conf

###### server.conf
rm -f /home/suwayomi/.local/share/Tachidesk/options.json
ln -s /config/suwayomi/options.json /home/suwayomi/.local/share/Tachidesk/options.json

###### database.mv.db
rm -f /home/suwayomi/.local/share/Tachidesk/database.mv.db
ln -s /config/suwayomi/database.mv.db /home/suwayomi/.local/share/Tachidesk/database.mv.db

###### database.trace.db
rm -f /home/suwayomi/.local/share/Tachidesk/database.trace.db
ln -s /config/suwayomi/database.trace.db /home/suwayomi/.local/share/Tachidesk/database.trace.db

###### extensions
rm -rf /home/suwayomi/.local/share/Tachidesk/extensions
ln -s /config/suwayomi/extensions /home/suwayomi/.local/share/Tachidesk/extensions

###### ls
echo "---------- ls:/config/suwayomi ----------"
ls -la /config/suwayomi
echo "---------- ls:/home/suwayomi/.local/share/Tachidesk/ ----------"
ls -la /home/suwayomi/.local/share/Tachidesk/

echo "---------- fin original exec ----------"
exec runuser -p -u suwayomi -- /bin/bash /home/suwayomi/startup_script.sh

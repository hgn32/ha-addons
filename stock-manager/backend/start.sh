#!/bin/sh
set -e

# Persistent data lives in the dedicated add-on config dir, mounted at /config
# (host path /addon_configs/<slug>, included in backups).
mkdir -p /config/images

# Create or update the SQLite schema from prisma/schema.prisma.
npx prisma db push --accept-data-loss

exec node dist/index.js

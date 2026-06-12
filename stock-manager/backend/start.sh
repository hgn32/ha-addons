#!/bin/sh
set -e

# Persistent data lives under /config so it survives addon restarts/updates.
mkdir -p /config/stock_manager/images

# Create or update the SQLite schema from prisma/schema.prisma.
npx prisma db push --accept-data-loss

exec node dist/index.js

#!/bin/sh
set -e

# Persistent data lives under /config so it survives addon restarts/updates.
mkdir -p /config/stock-manager/images

# Create or update the SQLite schema from prisma/schema.prisma.
npx prisma db push --skip-generate

exec node dist/index.js

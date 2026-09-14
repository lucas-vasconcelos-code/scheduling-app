#!/bin/sh
set -eu
if [ "${APP_MODE:-}" = "google" ]; then
  npm run db:migrate
fi
exec node apps/server/dist/index.js

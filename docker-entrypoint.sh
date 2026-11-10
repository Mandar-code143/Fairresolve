#!/bin/sh
set -e

STORAGE_DIR="${FAIRRESOLVE_STORAGE_DIR:-/app/data}"
UPLOADS_DIR="${STORAGE_DIR}/private_uploads"

mkdir -p "${STORAGE_DIR}" "${UPLOADS_DIR}"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${STORAGE_DIR}"
  exec gosu node "$@"
fi

exec "$@"

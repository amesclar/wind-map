#!/bin/sh
# Container entrypoint (SCRUM-134).
#
# Locally LITESTREAM_BUCKET is unset, so this simply runs the app, exactly as the previous CMD did.
# On Cloud Run it restores the SQLite database from the GCS replica when the instance has none,
# then runs the app under Litestream, which stops it and writes a final frame when Cloud Run
# terminates the instance.
set -eu

APP_COMMAND="uvicorn backend.app.main:app --host 0.0.0.0 --port 5005"
DATABASE_FILE="/app/data/wind_map.db"

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
    exec $APP_COMMAND
fi

# Both flags keep a first deployment clean: no local database and no replica yet is not an error.
litestream restore -if-db-not-exists -if-replica-exists "$DATABASE_FILE"

# First start with no replica: create the schema before Litestream watches the file, so it starts
# from a valid database instead of waiting for the app to create one under its own supervision.
if [ ! -f "$DATABASE_FILE" ]; then
    python -c "from backend.app.database import init_db; init_db()"
fi

exec litestream replicate -exec "$APP_COMMAND"

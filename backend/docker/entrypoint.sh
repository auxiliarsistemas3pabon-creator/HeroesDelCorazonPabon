#!/usr/bin/env bash
set -e

# Wait for the configured database to accept connections before starting Django.
if [ "${DATABASE_ENGINE:-mssql}" = "mssql" ]; then
    if [ -z "${SQLSERVER_USER:-}" ] || [ -z "${SQLSERVER_PASSWORD:-}" ]; then
        echo "SQLSERVER_USER and SQLSERVER_PASSWORD are required for SQL Server." >&2
        exit 1
    fi
    DB_HOST="${SQLSERVER_HOST:-localhost}"
    DB_PORT="${SQLSERVER_PORT:-1433}"
else
    DB_HOST="${POSTGRES_HOST:-}"
    DB_PORT="${POSTGRES_PORT:-5432}"
fi
if [ -n "$DB_HOST" ]; then
    echo "Waiting for database at ${DB_HOST}:${DB_PORT}..."
    until python -c "import socket,sys; s=socket.socket(); s.settimeout(2); sys.exit(s.connect_ex(('${DB_HOST}', int('${DB_PORT}'))))" 2>/dev/null; do
        sleep 1
    done
    echo "Database port is ready."
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    python manage.py migrate --noinput
fi

if [ "${COLLECT_STATIC:-false}" = "true" ]; then
    python manage.py collectstatic --noinput
fi

exec "$@"

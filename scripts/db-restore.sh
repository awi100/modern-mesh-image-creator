#!/usr/bin/env bash
#
# Restore a dump into a LOCAL database and report what landed.
#
# This exists to be run, not just to exist. A backup you have never restored is
# an assumption; the failure you care about (a dump that writes cleanly and
# restores to nothing) is invisible until you try.
#
#   ./scripts/db-restore.sh                      # newest dump -> mm_restore
#   ./scripts/db-restore.sh ~/mm-backups/x.dump mydb
#
# It will not touch a remote host: the target is always local. Restoring over
# production is the one mistake this must make impossible, so there is no flag
# for it.

set -euo pipefail

PGBIN=${PG_BIN_DIR:-/opt/homebrew/opt/postgresql@17/bin}

# This machine already had a Postgres 14 on 5432 (an older Intel Homebrew),
# which prompts for a password and is nothing to do with this app. The v17
# server is on 5433 so the two never collide and a restore can never be aimed
# at the wrong local server.
export PGPORT=${PGPORT:-5433}
export PGHOST=${PGHOST:-localhost}
OUT_DIR=${OUT_DIR:-"$HOME/mm-backups"}

FILE=${1:-$(ls -t "$OUT_DIR"/mm-*.dump 2>/dev/null | head -1 || true)}
TARGET=${2:-mm_restore}

[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "no dump found in $OUT_DIR" >&2; exit 1; }
echo "restoring $FILE -> local database '$TARGET'"

"$PGBIN/pg_isready" -q -p "$PGPORT" || {
  echo "local postgres isn't running. start it with:" >&2
  echo "  brew services start postgresql@17   (it listens on $PGPORT)" >&2
  exit 1
}

"$PGBIN/dropdb" --if-exists "$TARGET"
"$PGBIN/createdb" "$TARGET"
# Postgres 15+ gives every new database a `public` schema, so the dump's
# CREATE SCHEMA public always fails and every restore reports "1 error
# ignored". Dropping it first means a clean restore reports zero errors — and
# then any error at all is a real one worth reading.
"$PGBIN/psql" -q -d "$TARGET" -c 'DROP SCHEMA IF EXISTS public CASCADE;' >/dev/null

# --no-owner: the dump has no ownership anyway, and local roles differ.
# Errors are reported but don't abort, so one bad object doesn't hide the rest.
"$PGBIN/pg_restore" --dbname="$TARGET" --no-owner --no-privileges "$FILE" 2>&1 \
  | grep -v '^$' | head -20 || true

echo
echo "row counts in the restored copy:"
"$PGBIN/psql" -d "$TARGET" -At -F$'\t' -c "
  SELECT relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
  LIMIT 12;" | awk -F'\t' '{printf "  %-26s %s\n", $1, $2}'

# --- compare against production -------------------------------------------
# The drill is only worth running if it ends in pass or fail. Eyeballing two
# lists is how a dump that quietly lost a table gets signed off.
URL=${DATABASE_URL:-}
if [ -z "$URL" ] && [ -f .env ]; then
  URL=$(grep -E '^DIRECT_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
fi

if [ -z "$URL" ]; then
  echo
  echo "no production connection available — compare the counts above by hand."
  exit 0
fi

echo
echo "comparing against production..."
# EXACT counts, not pg_stat_user_tables.n_live_tup — that is an estimate the
# stats collector maintains lazily, and on production it was wildly stale
# (reporting 3 folders where there are 27). Comparing estimates against a
# freshly-restored database's accurate stats produces a page of differences
# that all mean nothing, which trains you to ignore the check.
COUNTS_SQL="
  SELECT table_name || ':' || (xpath('/row/c/text()', x))[1]::text
  FROM (
    SELECT table_name,
           query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name),
                        false, true, '') AS x
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ) t
  ORDER BY table_name;"
PROD=$("$PGBIN/psql" "$URL" -At -c "$COUNTS_SQL")
LOCAL=$("$PGBIN/psql" -d "$TARGET" -At -c "$COUNTS_SQL")

DIFF=$(diff <(echo "$PROD") <(echo "$LOCAL") || true)
if [ -z "$DIFF" ]; then
  echo "PASS — every table matches production row for row."
else
  echo "DIFFERENCES (production < / restored >):"
  echo "$DIFF" | sed 's/^/  /'
  echo
  echo "Some drift is expected if production changed while the dump was taken."
  echo "A table missing entirely, or counts far apart, is not drift."
fi

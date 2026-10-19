#!/usr/bin/env bash
#
# Dump the production database, and refuse to call it a backup until it has
# been checked.
#
# Used by BOTH `npm run db:backup` and the nightly GitHub Action, so the
# verification can't drift between them. The Action checks this repo out purely
# to get this file.
#
# Why each flag:
#   --schema=public   the only schema we own. auth/storage/realtime belong to
#                     Supabase and are recreated by any new project; we use
#                     iron-session and Cloudinary, so they hold nothing of ours.
#   -Fc               custom format: compressed, and pg_restore can list it,
#                     restore selectively, and parallelise.
#   --no-owner
#   --no-privileges   so it restores into a database with different role names
#                     (a local Postgres, or a fresh Supabase project) without
#                     erroring on every GRANT.
#
# The connection MUST be the session pooler on port 5432. Port 6543 is
# pgbouncer in transaction mode and cannot run pg_dump at all, and the direct
# db.<ref>.supabase.co host is IPv6-only, which GitHub runners can't reach.

set -euo pipefail

# A dump smaller than this means something went wrong — an empty database, a
# connection that died mid-stream, an auth failure that still exited 0. The
# real dump is ~2-4 MB; 200 KB is a floor well below it and well above nothing.
MIN_BYTES=${MIN_BYTES:-200000}

# Tables whose absence means the dump is not worth keeping, whatever its size.
REQUIRED_TABLES="designs shopify_orders shopify_order_items inventory_items supplies"

OUT_DIR=${OUT_DIR:-"$HOME/mm-backups"}
KEEP_DAYS=${KEEP_DAYS:-30}

die() { echo "backup FAILED: $*" >&2; exit 1; }

# --- connection ------------------------------------------------------------
URL=${DATABASE_URL:-}
if [ -z "$URL" ] && [ -f .env ]; then
  # DIRECT_URL is the session pooler (5432); DATABASE_URL in .env is the
  # transaction pooler (6543), which pg_dump cannot use.
  URL=$(grep -E '^DIRECT_URL=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
fi
[ -n "$URL" ] || die "no connection string (set DATABASE_URL, or DIRECT_URL in .env)"
case "$URL" in
  *:6543*) die "that's the transaction pooler (6543); pg_dump needs the session pooler on 5432" ;;
esac

# --- the right pg_dump -----------------------------------------------------
# pg_dump refuses to dump a server newer than itself, and this machine had a
# 14.x client on PATH against a 17.x server.
for c in "${PG_BIN_DIR:-}/pg_dump" /opt/homebrew/opt/postgresql@17/bin/pg_dump "$(command -v pg_dump || true)"; do
  [ -x "${c:-}" ] && PG_DUMP=$c && break
done
[ -n "${PG_DUMP:-}" ] || die "pg_dump not found"
PG_RESTORE="$(dirname "$PG_DUMP")/pg_restore"
MAJOR=$("$PG_DUMP" --version | sed -E 's/.* ([0-9]+).*/\1/')
[ "$MAJOR" -ge 17 ] || die "pg_dump is $MAJOR.x but the server is 17.x — it will refuse. Use postgresql@17."

# --- dump ------------------------------------------------------------------
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y-%m-%d)
FILE="$OUT_DIR/mm-$STAMP.dump"

echo "dumping with $("$PG_DUMP" --version)"
"$PG_DUMP" "$URL" \
  --schema=public --no-owner --no-privileges \
  --format=custom --compress=9 \
  --file="$FILE" || die "pg_dump exited non-zero"

# --- verify ----------------------------------------------------------------
# Everything below is the point of the script. An unverified dump is a file,
# not a backup, and the failure mode that matters is the one that looks fine.
SIZE=$(wc -c < "$FILE" | tr -d ' ')
[ "$SIZE" -ge "$MIN_BYTES" ] || die "dump is only $SIZE bytes (floor $MIN_BYTES) — treating as empty"

LISTING=$("$PG_RESTORE" --list "$FILE" 2>/dev/null) || die "pg_restore can't read the dump — it is corrupt"
for t in $REQUIRED_TABLES; do
  echo "$LISTING" | grep -qE "TABLE DATA public $t\b" \
    || die "no data for table '$t' — refusing to keep this dump"
done
TABLES=$(echo "$LISTING" | grep -cE "TABLE DATA public " || true)

echo "ok: $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables with data)"

# --- prune -----------------------------------------------------------------
find "$OUT_DIR" -name 'mm-*.dump' -type f -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true

# For the Action to pick up.
echo "$FILE" > "${BACKUP_PATH_FILE:-/dev/null}"

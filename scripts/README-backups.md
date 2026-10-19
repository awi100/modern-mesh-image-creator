# Backups

Supabase's free tier has **no automatic backups**. These scripts are the
replacement, and they are the reason it's safe to be on the free tier at all.

## Day to day

    npm run db:backup     # dump production to ~/mm-backups, verified
    npm run db:restore    # restore the newest dump locally, then PASS/FAIL
                          # against production's exact row counts

Run `db:backup` before any schema change or risky migration.

A nightly run of the same script happens in the private repo
`awi100/modern-mesh-backups` and publishes each dump as a release asset,
keeping 30 days. `scripts/backup-workflow.yml` here is the copy of that
workflow; the live one is in that repo.

## Things that will bite

**Use the session pooler, port 5432.** `DATABASE_URL` in `.env` is the
transaction pooler on 6543 — pgbouncer in transaction mode, which cannot run
`pg_dump` at all. `DIRECT_URL` is the right one. The scripts read `DIRECT_URL`
and refuse a 6543 URL outright.

**pg_dump must be at least as new as the server (17).** This machine had a 14
on `PATH` from an old Intel Homebrew; `postgresql@17` is installed under
`/opt/homebrew` and the scripts find it themselves.

**Two Postgres servers run locally.** The old 14 owns port 5432 and wants a
password; v17 is on **5433** so restores can never be aimed at the wrong one.

**The nightly job is also the keep-alive.** Free projects pause after 7 days
of inactivity, and a paused project means the Shopify fulfillment webhook
fails and stock deductions are silently missed. If the job stops, backups and
the webhook both stop. Check `LAST-RUN.md` in the backups repo.

## Restore drill

Do it every few months, and after any change to the schema. `npm run db:restore`
ends in `PASS — every table matches production row for row`, or a list of
differences. A dump that writes cleanly and restores to nothing is invisible
until you try.

# Database migrations

Incremental schema changes applied **after** the baseline (`../schema.sql`,
recorded as `0000_baseline`). The runner is `../../scripts/migrate.js`.

## How it works

On every API boot (and on `npm run migrate`), the runner:
1. ensures a `schema_migrations` table,
2. applies the baseline once, then each `*.sql` file here that hasn't been
   applied yet, **in filename order**, each in its own transaction,
3. records the filename in `schema_migrations`.

This makes updates non-destructive: a new database gets the full schema; an
existing one gets only the pending migrations, with data preserved. No `down -v`.

## Writing a migration

- Name it `NNNN_short_description.sql` with a zero-padded, incrementing number
  (`0001_…`, `0002_…`). Order is by filename.
- Put **plain DDL only** — do **not** wrap it in `BEGIN`/`COMMIT`; the runner
  wraps each file in a transaction.
- Prefer **idempotent** DDL so a re-run (or a fresh DB that already has it from
  the baseline) is harmless: `CREATE … IF NOT EXISTS`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`, `DROP … IF EXISTS`.
- For a brand-new column the app reads, also add it to `../schema.sql` so fresh
  installs get it directly. Existing installs get it from the migration. (Both
  paths are idempotent, so running both is safe.)

## Applying

- Automatically: the API container runs the runner on startup.
- Manually: `docker compose exec api npm run migrate`
  (or `DATABASE_URL=… npm run migrate` locally).

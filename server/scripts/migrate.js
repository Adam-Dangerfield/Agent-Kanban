#!/usr/bin/env node
/* ============================================================
 *  Lightweight SQL migration runner — the app's update process.
 *
 *  Applies, in order, each tracked step that hasn't run yet:
 *    1. the baseline  (db/schema.sql)      → version "0000_baseline"
 *    2. each db/migrations/*.sql (sorted)   → version = filename
 *  Applied versions are recorded in the `schema_migrations` table, so every
 *  step runs exactly once. Each step runs in its own transaction; the whole
 *  run is serialised with a Postgres advisory lock so two booting containers
 *  can't double-apply.
 *
 *  This is what makes updates non-destructive: on a NEW database it builds the
 *  full schema; on an EXISTING database it applies only the pending migrations,
 *  preserving data. No more `down -v`.
 *
 *  Usage:
 *    DATABASE_URL=postgres://… node scripts/migrate.js      (or: npm run migrate)
 *  Or programmatically:  const { migrate } = require('./migrate'); await migrate(pool)
 *
 *  Writing a migration: add db/migrations/<NNNN>_<name>.sql with plain DDL —
 *  do NOT wrap it in BEGIN/COMMIT (the runner does that). Prefer idempotent DDL
 *  (CREATE … IF NOT EXISTS, ALTER TABLE … ADD COLUMN IF NOT EXISTS).
 * ========================================================== */

const fs = require('fs');
const path = require('path');

// Arbitrary constant key for pg_advisory_lock — just has to be stable.
const LOCK_KEY = 947218;

async function migrate(pool, log = (m) => console.log(m)) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    // Ordered steps: baseline first, then numbered migrations.
    const steps = [];
    const baseline = path.join(__dirname, '..', 'db', 'schema.sql');
    if (fs.existsSync(baseline)) steps.push({ version: '0000_baseline', file: baseline });
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
        steps.push({ version: f, file: path.join(dir, f) });
      }
    }

    let n = 0;
    for (const step of steps) {
      if (applied.has(step.version)) continue;
      const sql = fs.readFileSync(step.file, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [step.version]);
        await client.query('COMMIT');
        log(`[migrate] applied ${step.version}`);
        n++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration "${step.version}" failed: ${e.message}`);
      }
    }
    log(n === 0 ? '[migrate] database up to date — no pending migrations' : `[migrate] applied ${n} migration(s)`);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); } catch (_) { /* best effort */ }
    client.release();
  }
}

module.exports = { migrate };

// CLI entry point.
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('[migrate] DATABASE_URL is required');
    process.exit(1);
  }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  migrate(pool)
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migrate]', e.message); process.exit(1); });
}

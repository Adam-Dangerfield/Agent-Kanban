#!/usr/bin/env node
/* ============================================================
 *  Production DB bootstrap — idempotent, clean (no demo data).
 *
 *  Runs on api container start in prod (see docker-compose.prod.yml's
 *  command override). It:
 *    1. Runs DB migrations (baseline + db/migrations/*) via migrate.js —
 *       non-destructive, so prod deploys apply schema changes to the live DB.
 *    2. Upserts the single human admin `adam` with a bcrypt hash of
 *       MANAGER_PASSWORD, is_admin=true. No agents/projects/tickets.
 *
 *  Unlike scripts/seed.js (which loads demo content for dev), this
 *  creates ONLY what's needed to log in and start provisioning real
 *  agents/projects via the admin panel/API.
 *
 *  Requires: DATABASE_URL. Uses MANAGER_PASSWORD if set (else skips the
 *  admin upsert and just ensures the schema — e.g. a schema-only boot).
 * ========================================================== */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { migrate } = require('./migrate');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[init-prod] DATABASE_URL is required');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // 1. Run migrations (baseline + incremental) — non-destructive.
  await migrate(pool, (m) => console.log(m.replace('[migrate]', '[init-prod]')));

  // 2. Upsert the admin from MANAGER_PASSWORD (clean — no demo data).
  const pw = process.env.MANAGER_PASSWORD;
  if (!pw) {
    console.log('[init-prod] MANAGER_PASSWORD not set — schema only, no admin upsert');
    await pool.end();
    return;
  }
  const hash = await bcrypt.hash(pw, 10);
  await pool.query(
    `INSERT INTO agents (id, name, kind, role, color, initials, is_admin, password_hash)
       VALUES ('adam', 'Adam', 'human', 'Owner', '#D97757', 'AD', true, $1)
     ON CONFLICT (id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           is_admin      = true,
           kind          = 'human'`,
    [hash]
  );
  console.log('[init-prod] admin "adam" upserted (is_admin=true, password from MANAGER_PASSWORD)');

  await pool.end();
}

main().catch((e) => { console.error('[init-prod] failed:', e); process.exit(1); });

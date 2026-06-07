#!/usr/bin/env node
/* ============================================================
 *  Mint (or re-mint) an agent token and write the hash to Postgres.
 *
 *  Usage:
 *    DATABASE_URL=postgres://... node scripts/mint-token.js <agent-id> [raw-token]
 *
 *  If raw-token is omitted a new one is generated in the format
 *  agt_live_<8 random hex chars>.
 *
 *  The raw token is printed ONCE to stdout. Store it safely — it
 *  cannot be recovered afterwards (only the bcrypt hash is kept).
 *
 *  Idempotent: running again for the same agent just replaces the
 *  hash/prefix with the new token.
 * ========================================================== */

const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');

async function main() {
  const agentId  = process.argv[2];
  const rawToken = process.argv[3] || `agt_live_${crypto.randomBytes(4).toString('hex')}`;

  if (!agentId) {
    console.error('Usage: node scripts/mint-token.js <agent-id> [raw-token]');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Confirm the agent exists.
  const check = await pool.query(`SELECT id, kind FROM agents WHERE id = $1`, [agentId]);
  if (check.rows.length === 0) {
    console.error(`Agent '${agentId}' not found`);
    await pool.end();
    process.exit(1);
  }

  const tokenHash   = await bcrypt.hash(rawToken, 10);
  const tokenPrefix = rawToken.slice(0, 13);

  await pool.query(
    `UPDATE agents SET token_hash = $1, token_prefix = $2 WHERE id = $3`,
    [tokenHash, tokenPrefix, agentId]
  );

  await pool.end();

  // Print the raw token ONCE — this is the only time it will be visible.
  console.log(rawToken);
}

main().catch((e) => { console.error(e); process.exit(1); });

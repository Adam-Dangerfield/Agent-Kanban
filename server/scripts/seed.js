#!/usr/bin/env node
/* ============================================================
 *  Load seed-data.js into Postgres.
 *     DATABASE_URL=postgres://... npm run seed
 *  Hashes the manager password and agent tokens with bcrypt.
 *  Idempotent: truncates the tables it owns before inserting.
 * ========================================================== */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const seed = require('../src/seed-data');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = (text, params) => pool.query(text, params);

  console.log('Seeding database…');
  // Truncate all tables including new ones (CASCADE handles FK deps).
  await q('TRUNCATE agents, projects, epics, stories, tasks, task_deps, comments, activity, requests, agent_permissions, attachments, provision_tokens CASCADE');

  // agents — hash secrets, never store raw
  for (const a of seed.agents) {
    const tokenHash = a.token ? await bcrypt.hash(a.token, 10) : null;
    const tokenPrefix = a.token ? a.token.slice(0, 13) : null;
    const pwHash = a.password ? await bcrypt.hash(a.password, 10) : null;
    await q(
      `INSERT INTO agents (id,name,kind,role,color,initials,is_admin,token_hash,token_prefix,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.id, a.name, a.kind, a.role, a.color, a.initials, a.is_admin || false, tokenHash, tokenPrefix, pwHash]
    );
  }

  for (const p of seed.projects)
    await q(`INSERT INTO projects (id,name,key,color,description) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, p.name, p.key, p.color, p.description]);

  for (const e of seed.epics)
    await q(`INSERT INTO epics (id,project_id,title) VALUES ($1,$2,$3)`, [e.id, e.project_id, e.title]);

  for (const s of seed.stories)
    await q(`INSERT INTO stories (id,epic_id,title) VALUES ($1,$2,$3)`, [s.id, s.epic_id, s.title]);

  for (const t of seed.tasks)
    await q(
      `INSERT INTO tasks (id,project_id,story_id,title,status,priority,assignee_id,branch,merge_state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.id, t.project_id, t.story_id, t.title, t.status, t.priority, t.assignee_id, t.branch, t.merge_state]
    );

  for (const t of seed.tasks)
    for (const dep of (t.deps || []))
      await q(`INSERT INTO task_deps (task_id,depends_on) VALUES ($1,$2)`, [t.id, dep]);

  for (const c of seed.comments)
    await q(`INSERT INTO comments (task_id,author_id,body,created_at) VALUES ($1,$2,$3,$4)`,
      [c.task_id, c.author_id, c.body, c.created_at]);

  for (const r of seed.requests)
    await q(
      `INSERT INTO requests (id,from_project_id,to_project_id,title,description,priority,requested_by,assignee_id,linked_task_id,spawned_task_id,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.id, r.from_project_id, r.to_project_id, r.title, r.description, r.priority, r.requested_by, r.assignee_id, r.linked_task_id, r.spawned_task_id, r.status]
    );

  // agent_permissions — grant write on all 3 projects for seeded agents
  for (const p of seed.agentPermissions)
    await q(
      `INSERT INTO agent_permissions (agent_id, project_id, access) VALUES ($1,$2,$3)`,
      [p.agent_id, p.project_id, p.access]
    );

  console.log('Done. Remember to replace the REPLACE_ME agent tokens in seed-data.js with real secrets.');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });

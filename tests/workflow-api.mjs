import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRequire = createRequire(path.join(root, 'server', 'package.json'));
const { Pool } = serverRequire('pg');
const bcrypt = serverRequire('bcryptjs');
const { migrate } = serverRequire('./scripts/migrate.js');
const databaseUrl = process.env.KANBAN_WORKFLOW_DATABASE_URL ||
  (process.env.KANBAN_WORKFLOW_PG_PORT
    ? `postgres://kanban@127.0.0.1:${Number(process.env.KANBAN_WORKFLOW_PG_PORT)}/kanban_workflow_test`
    : null);
const port = Number(process.env.KANBAN_WORKFLOW_PORT || 45440);
const base = `http://127.0.0.1:${port}`;
const testPassword = 'workflow-test-password';
const agentToken = 'agt_wrk_00001_token';
const readerToken = 'agt_rdr_00001_token';
const adminAgentToken = 'agt_adm_00001_token';

let pool;
let server;
let managerSession;

async function api(method, route, token, body) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode != null) throw new Error('workflow test server exited');
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch { /* Serwer może jeszcze uruchamiać połączenia. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('workflow test server did not start');
}

async function startServer() {
  server = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
    cwd: root,
    env: {
      ...Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'workflow-test-jwt-secret',
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_RATE_MAX: '1000',
      SERVE_WEB: 'true',
      UPLOAD_DIR: path.join(root, 'tmp', 'workflow-test-uploads'),
    },
    stdio: 'ignore',
  });
  await waitForServer();
}

async function stopServer() {
  if (!server || server.exitCode != null || server.signalCode != null) return;
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await stopped;
}

before(async () => {
  assert.ok(databaseUrl, 'a dedicated workflow test database is required');
  assert.ok(new URL(databaseUrl).pathname.endsWith('_workflow_test'), 'use a dedicated workflow test database');
  pool = new Pool({ connectionString: databaseUrl });
  await migrate(pool, () => {});
  await pool.query(`TRUNCATE agents, projects, epics, stories, tasks, task_deps, comments,
    activity, requests, agent_permissions, attachments, provision_tokens CASCADE`);
  const passwordHash = await bcrypt.hash(testPassword, 4);
  const agentHash = await bcrypt.hash(agentToken, 4);
  const readerHash = await bcrypt.hash(readerToken, 4);
  const adminHash = await bcrypt.hash(adminAgentToken, 4);
  await pool.query(
    `INSERT INTO agents (id, name, kind, is_admin, password_hash) VALUES
       ('adam', 'Manager', 'human', true, $1)`, [passwordHash]
  );
  await pool.query(
    `INSERT INTO agents (id, name, kind, token_hash, token_prefix) VALUES
       ('worker', 'Worker', 'agent', $1, $2),
       ('reader', 'Reader', 'agent', $3, $4),
       ('admin-agent', 'Admin agent', 'agent', $5, $6)`,
    [agentHash, agentToken.slice(0, 13), readerHash, readerToken.slice(0, 13),
      adminHash, adminAgentToken.slice(0, 13)]
  );
  await pool.query(`UPDATE agents SET is_admin = true WHERE id = 'admin-agent'`);
  await pool.query(`INSERT INTO projects (id, name, key) VALUES
    ('visible', 'Visible', 'VIS'), ('hidden', 'Hidden', 'HID')`);
  await pool.query(`INSERT INTO agent_permissions (agent_id, project_id, access) VALUES
    ('worker', 'visible', 'write'), ('reader', 'visible', 'read')`);
  await startServer();
  const login = await api('POST', '/api/auth/login', null, { password: testPassword });
  assert.equal(login.status, 200);
  managerSession = login.body.token;
});

after(async () => {
  await stopServer();
  if (pool) await pool.end();
});

test('workflow API keeps revision, history, claim and human authority consistent', async () => {
  const create = await api('POST', '/api/projects/visible/tasks', managerSession,
    { id: 'VIS-900', title: 'Review', status: 'todo' });
  assert.equal(create.status, 201);
  assert.equal(create.body.workflow.revision, 0);
  const initialQueue = await api('GET', '/api/workflow', managerSession);
  assert.equal(initialQueue.status, 200);
  assert.equal(initialQueue.body.work.some((task) => task.id === 'VIS-900'), true);

  const published = await api('POST', '/api/tasks/VIS-900/workflow', agentToken, {
    action: 'publish', revision: 0, kind: 'decision', summary: 'Review complete', question: 'Approve?',
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.workflow.revision, 1);
  assert.equal(published.body.activity.length, 2);
  const stale = await api('POST', '/api/tasks/VIS-900/workflow', agentToken, {
    action: 'publish', revision: 0, kind: 'information', summary: 'Stale',
  });
  assert.equal(stale.status, 409);
  assert.equal((await api('POST', '/api/tasks/VIS-900/claim', agentToken, {})).status, 409);
  assert.equal((await api('POST', '/api/tasks/VIS-900/workflow', agentToken,
    { action: 'answer', revision: 1, answer: 'Yes' })).status, 403);
  assert.equal((await api('POST', '/api/tasks/VIS-900/workflow', adminAgentToken,
    { action: 'answer', revision: 1, answer: 'Yes' })).status, 403);
  assert.equal((await api('POST', '/api/tasks/VIS-900/workflow', managerSession,
    { action: 'answer', revision: 1, answer: ' ' })).status, 400);
  const answered = await api('POST', '/api/tasks/VIS-900/workflow', managerSession,
    { action: 'answer', revision: 1, answer: 'Yes' });
  assert.equal(answered.status, 200);
  assert.equal(answered.body.status, 'todo');
  assert.equal(answered.body.workflow.discussed_revision, 1);
  const followup = await api('POST', '/api/tasks/VIS-900/workflow', agentToken, {
    action: 'publish', revision: 1, kind: 'information', summary: 'Approved work started',
  });
  assert.equal(followup.status, 200);
  assert.equal(followup.body.workflow.revision, 2);
  assert.equal(followup.body.activity.some((entry) => entry.text.includes('"question":"Approve?"') &&
    entry.text.includes('"answer":"Yes"')), true);
  assert.equal(followup.body.activity.some((entry) => entry.text.includes('"summary":"Review complete"')), true);
  assert.equal((await api('POST', '/api/tasks/VIS-900/claim', agentToken, {})).status, 200);
});

test('deferred card stays blocked past due date and read-only actor cannot mutate', async () => {
  const created = await api('POST', '/api/projects/visible/tasks', managerSession,
    { id: 'VIS-901', title: 'Deferred', status: 'todo' });
  assert.equal(created.status, 201);
  assert.equal((await api('POST', '/api/tasks/VIS-901/workflow', readerToken,
    { action: 'defer', revision: 0, reason: 'Wait', condition: 'Ready' })).status, 403);
  const deferred = await api('POST', '/api/tasks/VIS-901/workflow', managerSession,
    { action: 'defer', revision: 0, reason: 'Wait', until: '2020-01-01T00:00:00Z' });
  assert.equal(deferred.status, 200);
  assert.equal((await api('POST', '/api/tasks/VIS-901/claim', agentToken, {})).status, 409);
  const queue = await api('GET', '/api/workflow', managerSession);
  assert.equal(queue.body.deferred.some((task) => task.id === 'VIS-901'), true);
  const resumed = await api('POST', '/api/tasks/VIS-901/workflow', managerSession,
    { action: 'resume', revision: 0 });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.workflow.deferred, false);
  assert.equal((await api('POST', '/api/tasks/VIS-901/claim', agentToken, {})).status, 200);
});

test('hidden dependency blocks work without exposing hidden task and web serving is allowlisted', async () => {
  await api('POST', '/api/projects/hidden/tasks', managerSession,
    { id: 'HID-900', title: 'Private blocker', status: 'todo' });
  await api('POST', '/api/projects/visible/tasks', managerSession,
    { id: 'VIS-902', title: 'Dependent', status: 'todo', deps: ['HID-900'] });
  const queue = await api('GET', '/api/workflow', agentToken);
  assert.equal(queue.status, 200);
  assert.equal(queue.body.work.some((task) => task.id === 'VIS-902'), false);
  assert.equal(JSON.stringify(queue.body).includes('Private blocker'), false);
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(`${base}/Kanban.html`)).status, 200);
  assert.equal((await fetch(`${base}/package.json`)).status, 401);
});

test('concurrent publications serialize and persist one complete revision', async () => {
  await api('POST', '/api/projects/visible/tasks', managerSession,
    { id: 'VIS-903', title: 'Concurrent', status: 'todo' });
  const attempts = await Promise.all(['First', 'Second'].map((summary) =>
    api('POST', '/api/tasks/VIS-903/workflow', agentToken, {
      action: 'publish', revision: 0, kind: 'information', summary,
    })));
  assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 409]);
  const persisted = await pool.query('SELECT workflow FROM tasks WHERE id = $1', ['VIS-903']);
  assert.equal(persisted.rows[0].workflow.revision, 1);
  const history = await pool.query(
    `SELECT text FROM activity WHERE entity_type = 'task' AND entity_id = $1
      AND text LIKE 'published revision%'`, ['VIS-903']);
  assert.equal(history.rowCount, 1);
  assert.equal(history.rows[0].text.includes(persisted.rows[0].workflow.summary), true);
});

test('workflow state and attribution survive an API restart', async () => {
  await stopServer();
  await startServer();
  const task = await api('GET', '/api/tasks/VIS-900', managerSession);
  assert.equal(task.status, 200);
  assert.equal(task.body.workflow.revision, 2);
  assert.equal(task.body.workflow.answer, null);
  assert.equal(task.body.activity.some((entry) => entry.text.includes('"answer":"Yes"')), true);
  assert.equal(task.body.assignee_id, 'worker');
});

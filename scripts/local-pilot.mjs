#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'server/package.json'));
const state = path.join(root, 'tmp/practice');
const data = path.join(state, 'pgdata');
const session = 'agent-kanban-practice';
const port = 45441;
const dbPort = 55441;
const origin = `http://127.0.0.1:${port}`;
const cleanEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));

function command(binary, args, extra = {}) {
  const result = spawnSync(binary, args, { cwd: root, env: cleanEnv, encoding: 'utf8', timeout: 30000, ...extra });
  if (result.status !== 0) throw new Error(`Local command failed: ${binary}`);
  return result.stdout;
}
function secret(name) {
  const file = path.join(state, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
  return fs.readFileSync(file, 'utf8').trim();
}
function databaseUrl(database = 'kanban_practice') {
  return `postgresql://kanban:${encodeURIComponent(secret('database_password'))}@127.0.0.1:${dbPort}/${database}`;
}
function listening(targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: targetPort });
    socket.setTimeout(500);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
function hasSession() {
  return spawnSync('tmux', ['has-session', '-t', session], { env: cleanEnv, stdio: 'ignore' }).status === 0;
}
async function status() {
  const [api, database] = await Promise.all([listening(port), listening(dbPort)]);
  console.log(JSON.stringify({ url: origin, api, database, session: hasSession(), data_directory: state }, null, 2));
}
async function prepare() {
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  fs.chmodSync(state, 0o700);
  secret('database_password'); secret('manager_password'); secret('jwt_secret');
  if (!fs.existsSync(path.join(data, 'PG_VERSION'))) {
    if (await listening(dbPort)) throw new Error('Database port is already occupied');
    command('initdb', ['-D', data, '-U', 'kanban', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--pwfile', path.join(state, 'database_password'), '--no-instructions']);
  }
  const ownDb = spawnSync('pg_ctl', ['-D', data, 'status'], { env: cleanEnv, stdio: 'ignore' }).status === 0;
  if (!ownDb) {
    if (await listening(dbPort)) throw new Error('Database port is already occupied');
    command('pg_ctl', ['-D', data, '-o', `-h 127.0.0.1 -p ${dbPort} -k ${state}`, '-l', path.join(state, 'postgres.log'), 'start']);
  }
  const { Pool } = require('pg');
  let pool = new Pool({ connectionString: databaseUrl('postgres') });
  try {
    const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = 'kanban_practice'");
    if (!exists.rowCount) await pool.query('CREATE DATABASE kanban_practice');
  } finally { await pool.end(); }
  pool = new Pool({ connectionString: databaseUrl() });
  try {
    await require('../server/scripts/migrate.js').migrate(pool, () => {});
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(secret('manager_password'), 10);
    await pool.query(`INSERT INTO agents (id,name,kind,role,is_admin,password_hash,color,initials)
      VALUES ('adam','Pilot owner','human','Owner',true,$1,'#D97757','PO')
      ON CONFLICT (id) DO UPDATE SET password_hash=$1`, [hash]);
  } finally { await pool.end(); }
}
async function seed() {
  const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: secret('manager_password') }) });
  if (!login.ok) throw new Error('Local login failed');
  const token = (await login.json()).token;
  async function api(method, route, body) {
    const response = await fetch(origin + '/api' + route, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Local setup request failed (${response.status})`);
    return response.json();
  }
  const definitions = [
    { id: 'influ360-pilot', key: 'INF', name: 'Influ360 API · pilot', color: '#D97757' },
    { id: 'bambu-pilot', key: 'BAM', name: 'Bambu Studio · pilot', color: '#2A6FB5' },
    { id: 'fact-checker-pilot', key: 'PFC', name: 'Product Fact Checker · pilot', color: '#2F7D63' },
  ];
  const instructions = [
    'Practice only. Inspect examples/practice/api-response.json against its contract. Identify concrete violations with file evidence; do not infer the correct total from the partial response. Publish an information result with findings and limits. Do not access real repositories.',
    'Practice only. Compare examples/practice/printer-profiles.json. Calculate time and material differences. Publish a decision asking whether shorter time or finer layers matter more. Wait for the actual answer before recommending a profile; then publish the result. Do not run a real printer.',
    'Practice only. Check examples/practice/product-claim.json. Explain the source conflict and publish a decision asking which source governs. Support explicit deferral until a new synthetic manual arrives. Do not browse or contact real sellers.',
  ];
  const projects = await api('GET', '/projects');
  for (const project of definitions) if (!projects.some((item) => item.id === project.id)) await api('POST', '/projects', project);
  // Uzupełnienie projektów jest wykonywane osobno, aby nie resetować istniejących kart.
  const agents = await api('GET', '/agents');
  if (!agents.some((item) => item.id === 'orchestrator')) {
    const agent = await api('POST', '/agents', { id: 'orchestrator', name: 'Conversation orchestrator', grants: definitions.map((item) => ({ project_id: item.id, access: 'write' })) });
    fs.writeFileSync(path.join(state, 'agent_token'), agent.token, { mode: 0o600 });
  } else if (!fs.existsSync(path.join(state, 'agent_token'))) throw new Error('Agent credential file missing; restore it before continuing');
  fs.writeFileSync(path.join(state, 'client.json'), JSON.stringify({ base: origin + '/api', token_file: 'agent_token', password_file: 'manager_password' }, null, 2), { mode: 0o600 });
  for (const [index, name] of ['api', 'printer', 'facts'].entries()) {
    const id = `practice-${name}`;
    const tokenFile = `worker_${name}_token`;
    if (!agents.some((item) => item.id === id)) {
      const worker = await api('POST', '/agents', { id, name: `Practice ${name} worker`,
        grants: [{ project_id: definitions[index].id, access: 'write' }] });
      fs.writeFileSync(path.join(state, tokenFile), worker.token, { mode: 0o600 });
    } else if (!fs.existsSync(path.join(state, tokenFile))) throw new Error('Worker credential file missing; restore it before continuing');
    fs.writeFileSync(path.join(state, `client-${name}.json`), JSON.stringify({ base: origin + '/api', token_file: tokenFile }, null, 2), { mode: 0o600 });
  }
  if (!fs.existsSync(path.join(state, 'seeded.json'))) {
    const cards = [];
    for (const [index, project] of definitions.entries()) {
      const existing = await api('GET', `/projects/${project.id}/tasks`);
      const title = ['Check a synthetic API response', 'Compare synthetic printer profiles', 'Verify a synthetic product claim'][index];
      if (existing.some((item) => item.title === title)) { cards.push(existing.find((item) => item.title === title)); continue; }
      cards.push(await api('POST', `/projects/${project.id}/tasks`, {
        title,
        description: instructions[index],
        status: 'todo', priority: index === 0 ? 'high' : 'medium',
      }));
    }
    fs.writeFileSync(path.join(state, 'seeded.json'), JSON.stringify(cards.map(({ id }) => id)));
  }
}
async function start() {
  if (hasSession()) { await status(); return; }
  if (await listening(port)) throw new Error('API port is already occupied');
  await prepare();
  const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const launch = `${quote(process.execPath)} ${quote(fileURLToPath(import.meta.url))} serve >> ${quote(path.join(state, 'api.log'))} 2>&1`;
  command('tmux', ['new-session', '-d', '-s', session, launch]);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { ready = (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('API did not become ready');
  await seed();
  await status();
}
async function stop() {
  if (hasSession()) command('tmux', ['kill-session', '-t', session]);
  if (fs.existsSync(path.join(data, 'postmaster.pid'))) command('pg_ctl', ['-D', data, '-m', 'fast', 'stop']);
  await status();
}
async function main() {
  const action = process.argv[2] || 'status';
  if (action === 'start') await start();
  else if (action === 'stop') await stop();
  else if (action === 'restart') { await stop(); await start(); }
  else if (action === 'status') await status();
  else if (action === 'serve') {
    const child = spawn(process.execPath, ['server/src/index.js'], { cwd: root, stdio: 'inherit', env: {
      ...cleanEnv, DATABASE_URL: databaseUrl(), JWT_SECRET: secret('jwt_secret'),
      PORT: String(port), HOST: '127.0.0.1', WEB_ORIGIN: origin, SERVE_WEB: 'true',
      UPLOAD_DIR: path.join(state, 'uploads'), AUTH_RATE_MAX: '1000',
    } });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill('SIGTERM'));
    child.on('exit', (code) => { process.exitCode = code || 0; });
  } else if (action === 'copy-password') {
    command('pbcopy', [], { input: secret('manager_password') });
    console.log('Manager password copied to clipboard');
  } else throw new Error('Unknown local pilot command');
}
main().catch(() => { console.error('Local pilot command failed. Check prerequisites, occupied ports and private state directory; no credentials were printed.'); process.exitCode = 1; });

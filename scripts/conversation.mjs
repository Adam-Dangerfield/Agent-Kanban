#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const help = `Conversation workflow CLI
  queues | next [conversation|work|deferred|active] | task ID
  create PROJECT --title TEXT [--priority high] [--description TEXT]
  claim ID | complete ID --summary TEXT
  publish ID --revision N --kind information|confirmation|decision --summary TEXT [--question TEXT] [--next-step TEXT]
  answer ID --human --revision N --answer TEXT
  discuss ID --human --revision N
  defer ID --revision N --reason TEXT (--until ISO | --condition TEXT)
  resume ID --revision N
Credentials: private tmp/practice/client.json (override with KANBAN_PROFILE).
All commands return JSON. Human actions require an actual user response, never an assumed approval.`;

export function buildRequest(args) {
  const positional = [], flags = {};
  const known = new Set(['human', 'title', 'priority', 'description', 'summary', 'kind', 'question', 'next-step', 'revision', 'answer', 'reason', 'until', 'condition']);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const key = value.slice(2);
    if (!known.has(key) || Object.hasOwn(flags, key)) throw new Error('Unknown or duplicate option');
    if (key === 'human') { flags.human = true; continue; }
    if (args[index + 1] === undefined || args[index + 1].startsWith('--')) throw new Error(`Missing ${key}`);
    flags[key] = args[++index];
  }
  const [command, id] = positional;
  const human = !!flags.human;
  const required = (key) => {
    if (!String(flags[key] || '').trim()) throw new Error(`Missing ${key}`);
    return flags[key].trim();
  };
  if (command === 'queues' || command === 'next') {
    const result = { method: 'GET', route: '/workflow', human };
    if (command === 'next') {
      result.select = id || 'conversation';
      if (!['conversation', 'work', 'deferred', 'active'].includes(result.select)) throw new Error('Invalid queue');
    }
    return result;
  }
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new Error('Invalid identifier');
  const route = `/tasks/${encodeURIComponent(id)}`;
  if (command === 'task') return { method: 'GET', route, human };
  if (command === 'create') return { method: 'POST', route: `/projects/${id}/tasks`, human, body: {
    title: required('title'), priority: flags.priority || 'medium', status: 'todo', description: flags.description || '',
  } };
  if (command === 'claim') return { method: 'POST', route: route + '/claim', human, body: {} };
  if (command === 'complete') return { method: 'PATCH', route, human, body: { status: 'done', _log: required('summary') } };
  const body = { action: command };
  if (['publish', 'defer', 'resume'].includes(command)) {
    body.revision = Number(required('revision'));
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error('Invalid revision');
  }
  if (command === 'publish') {
    body.kind = required('kind');
    if (!['information', 'confirmation', 'decision'].includes(body.kind)) throw new Error('Invalid kind');
    body.summary = required('summary');
    if (body.kind !== 'information') body.question = required('question');
    if (flags['next-step']) body.next_step = flags['next-step'];
  } else if (command === 'answer' || command === 'discuss') {
    if (!human) throw new Error('Explicit --human is required');
    body.revision = Number(required('revision'));
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error('Invalid revision');
    if (command === 'answer') body.answer = required('answer');
  } else if (command === 'defer') {
    body.reason = required('reason');
    if (!flags.until && !flags.condition) throw new Error('Missing until or condition');
    if (flags.until) body.until = flags.until;
    if (flags.condition) body.condition = flags.condition;
  } else if (command !== 'resume') throw new Error('Unknown command');
  return { method: 'POST', route: route + '/workflow', human, body };
}

export async function run(args) {
  if (!args.length || args[0] === 'help' || args[0] === '--help') { console.log(help); return; }
  const request = buildRequest(args);
  const profilePath = process.env.KANBAN_PROFILE || path.join(root, 'tmp/practice/client.json');
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const base = new URL(profile.base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.protocol !== 'https:') throw new Error('Remote profiles require HTTPS');
  const readSecret = (name) => fs.readFileSync(path.resolve(path.dirname(profilePath), profile[name]), 'utf8').trim();
  let token;
  if (request.human) {
    const response = await fetch(`${profile.base}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: readSecret('password_file') }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Human authentication failed (${response.status})`);
    token = (await response.json()).token;
  } else token = readSecret('token_file');
  const response = await fetch(profile.base + request.route, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}); refresh the card and check permissions, revision and fields`);
  const data = await response.json();
  console.log(JSON.stringify(request.select ? (data[request.select]?.[0] || null) : data, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).catch((error) => {
    // Nie wypisujemy treści błędów sieci, profilu ani odpowiedzi uwierzytelniania.
    const safe = /^(Missing |Invalid |Unknown |Explicit |Request failed|Human authentication failed|Remote profiles)/.test(error.message);
    console.error(safe ? error.message : 'Command failed; check the local service and private profile files');
    process.exitCode = 1;
  });
}

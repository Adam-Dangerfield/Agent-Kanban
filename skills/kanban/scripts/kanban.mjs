#!/usr/bin/env node
/**
 * kanban.mjs — Dependency-free Kanban API CLI for AI agents.
 * Requires Node 18+ (global fetch, FormData, Blob).
 *
 * Env vars:
 *   KANBAN_URL              e.g. http://localhost:4000/api
 *   KANBAN_TOKEN            your agent bearer token
 *   KANBAN_PROVISION_TOKEN  provision token (onboard subcommand only)
 *
 * Usage:
 *   node kanban.mjs <subcommand> [args] [--json]
 *
 * Subcommands:
 *   me                                     Show identity + permissions
 *   projects                               List readable projects
 *   tasks [projectId] [--status s] [--assignee a]   (projectId optional if KANBAN_PROJECT set)
 *                                          List tasks (client-side filters)
 *   task <id>                              Get one task (comments/activity/attachments)
 *   claim <id> [assigneeId]               Set status=in_progress (+ optional assignee)
 *   status <id> <backlog|todo|in_progress|done>
 *                                          Change task status
 *   branch <id> <branch> <none|dev|pr|merged>
 *                                          Set branch name + merge state
 *   comment <id> <text...>                Post a comment
 *   new <projectId> <title...> [--priority p] [--desc d] [--status s] [--story id] [--id id] [--created ISO]
 *                                          Create a task (--created backdates for imports)
 *   epic-create <projectId> <epicId> <title...>
 *                                          Create an epic (client-supplied id; needs write on project)
 *   story-create <epicId> <storyId> <title...>
 *                                          Create a story under an epic (needs write on project)
 *   attach <task|request> <id> <filepath>  Upload a file attachment
 *   download <attachmentId> [outpath]      Download an attachment
 *   request <fromProj> <toProj> <title...> Raise a cross-team request
 *   request-action <reqId> <accept|decline|start|done|cancel>
 *                                          Act on a request
 *   requests [projectId]                   List project request inbox (projectId optional if KANBAN_PROJECT set)
 *   onboard <id> <name> [--role r] [--grant proj:access ...]
 *                                          Self-register + self-grant via provision token
 *
 * Admin subcommands (KANBAN_TOKEN must be an admin token):
 *   agents                                 List all agents (id, name, role, admin flag)
 *   perms <agentId>                        Show an agent's project permissions
 *   grant <agentId> <projectId> <read|write|none>
 *                                          Set/revoke a project permission for an agent
 *   set-admin <agentId> <true|false>       Promote or demote an agent's admin flag
 *   project-create <id> <KEY> <name...> [--color #hex] [--desc text]
 *                                          Create a project (the first-run keystone)
 *   provision <id> <name> [--role r] [--grant proj:access ...] [--admin]
 *                                          Create an agent (admin path; full grants; optional --admin)
 *   rotate <agentId>                       Rotate an agent's token (prints new token once)
 *   tokens                                 List scoped provision tokens
 *   token-create <label> <proj:maxaccess> [<proj:maxaccess> ...]
 *                                          Create a scoped provision token (prints token once)
 *   token-revoke <id>                      Delete a scoped provision token
 *   help                                   Show this message
 */

import { readFileSync, writeFileSync } from 'fs';
import { basename } from 'path';

// ── env ────────────────────────────────────────────────────────────────────
const BASE = (process.env.KANBAN_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KANBAN_TOKEN || '';
const PROV_TOKEN = process.env.KANBAN_PROVISION_TOKEN || '';
// Default project for commands that take a projectId positionally (tasks,
// requests). Lets `kanban tasks` stand in for `kanban tasks $KANBAN_PROJECT`.
const DEFAULT_PROJECT = process.env.KANBAN_PROJECT || '';

// ── arg parsing ────────────────────────────────────────────────────────────
const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes('--json');
const args = rawArgs.filter(a => a !== '--json');
const [subcommand, ...rest] = args;

// ── helpers ────────────────────────────────────────────────────────────────
function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

function requireEnv() {
  if (!BASE) die('KANBAN_URL is not set. Export it before running.');
  if (!TOKEN) die('KANBAN_TOKEN is not set. Export it before running.');
}

function requireProvToken() {
  if (!BASE) die('KANBAN_URL is not set.');
  if (!PROV_TOKEN) die('KANBAN_PROVISION_TOKEN is not set. Needed for onboard.');
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${TOKEN}`, ...extra };
}

function provHeaders(extra = {}) {
  return { 'X-Provision-Token': PROV_TOKEN, ...extra };
}

async function apiFetch(path, opts = {}) {
  const url = `${BASE}${path}`;
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    die(`Network error reaching ${url}: ${err.message}`);
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    // Surface a clear message for admin-gated 403s
    if (res.status === 403) {
      let hint = '';
      try {
        const parsed = JSON.parse(body);
        hint = parsed.error || body;
      } catch (_) { hint = body; }
      die(`HTTP 403 Forbidden — ${path}\n${hint}\n(This command requires an admin token. Set KANBAN_TOKEN to a token whose agent has is_admin=true.)`);
    }
    die(`HTTP ${res.status} ${res.statusText} — ${path}\n${body}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res; // caller handles binary
}

function print(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(format(data) + '\n');
  }
}

// ── compact human formatter ────────────────────────────────────────────────
function format(data) {
  if (Array.isArray(data)) return data.map(formatItem).join('\n');
  return formatItem(data);
}

function formatItem(d) {
  if (!d || typeof d !== 'object') return String(d);

  // Permissions response  { agent_id, permissions [, is_admin] }
  // Must come before the "me" check — also has is_admin + permissions.
  if ('agent_id' in d && 'permissions' in d) {
    const perms = (d.permissions || []).map(p => `  ${p.project_id}: ${p.access}`).join('\n');
    const adminLine = d.is_admin !== undefined ? `   is_admin: ${d.is_admin}` : '';
    return [
      `agent_id: ${d.agent_id}${adminLine}`,
      `permissions:`,
      perms || '  (none)',
    ].join('\n');
  }

  // Identity / me
  if ('is_admin' in d && 'permissions' in d) {
    const perms = (d.permissions || []).map(p => `  ${p.project_id}: ${p.access}`).join('\n');
    return [
      `id:       ${d.id}`,
      `name:     ${d.name}`,
      `role:     ${d.role || '—'}`,
      `is_admin: ${d.is_admin}`,
      `permissions:`,
      perms || '  (none)',
    ].join('\n');
  }

  // Task
  if ('status' in d && 'project_id' in d) {
    const lines = [
      `[${d.id}] ${d.title}`,
      `  project:  ${d.project_id}   status: ${d.status}   priority: ${d.priority || '—'}`,
      `  assignee: ${d.assignee_id || '—'}   branch: ${d.branch || '—'}   merge: ${d.merge_state || '—'}`,
    ];
    if (d.description) lines.push(`  desc:     ${d.description}`);
    if (d.comments?.length) {
      lines.push(`  comments (${d.comments.length}):`);
      d.comments.forEach(c => lines.push(`    [${c.created_at?.slice(0,16)}] ${c.author_id}: ${c.body}`));
    }
    if (d.activity?.length) {
      const recent = d.activity.slice(-3);
      lines.push(`  activity (last ${recent.length}):`);
      recent.forEach(a => lines.push(`    [${a.created_at?.slice(0,16)}] ${a.actor_id}: ${a.text}`));
    }
    if (d.attachments?.length) {
      lines.push(`  attachments (${d.attachments.length}):`);
      d.attachments.forEach(a => lines.push(`    id:${a.id} ${a.filename} (${a.size_bytes}b)`));
    }
    return lines.join('\n');
  }

  // Request
  if ('from_project_id' in d || 'to_project_id' in d) {
    return [
      `[${d.id}] ${d.title}`,
      `  from: ${d.from_project_id} → to: ${d.to_project_id}   status: ${d.status}   priority: ${d.priority || '—'}`,
      `  requested_by: ${d.requested_by || '—'}`,
    ].join('\n');
  }

  // Project
  if ('key' in d && 'name' in d) {
    return `[${d.id}] ${d.name} (${d.key})`;
  }

  // Attachment
  if ('entity_type' in d) {
    return `attachment id:${d.id} "${d.filename}" ${d.size_bytes}b uploaded_by:${d.uploaded_by}`;
  }

  // Comment
  if ('body' in d && 'author_id' in d) {
    return `[${d.created_at?.slice(0,16)}] ${d.author_id}: ${d.body}`;
  }

  // Onboard / provision response  { agent, token }
  if (d.agent && d.token) {
    return [
      `Agent created: ${d.agent.id} (${d.agent.name})${d.agent.is_admin ? '  [ADMIN]' : ''}`,
      `TOKEN (copy now — shown once):`,
      `  ${d.token}`,
    ].join('\n');
  }

  // Request action response
  if (d.request && d.spawnedTask !== undefined) {
    const lines = [`Request ${d.request.id} → status: ${d.request.status}`];
    if (d.spawnedTask) lines.push(`Spawned task: [${d.spawnedTask.id}] ${d.spawnedTask.title}`);
    return lines.join('\n');
  }

  // Agent list item  { id, name, role, is_admin, kind, ... }
  if ('is_admin' in d && 'kind' in d) {
    return `${d.id.padEnd(20)} ${(d.name || '').padEnd(24)} role:${(d.role || '—').padEnd(20)} admin:${d.is_admin}`;
  }

  // Provision token list item  { id, label, token_prefix, scope, created_at }
  // Must be checked BEFORE the rotate-token formatter (which also has token_prefix+token+id).
  if ('label' in d && 'token_prefix' in d && 'scope' in d) {
    const scopeStr = Array.isArray(d.scope)
      ? d.scope.map(s => `${s.project_id}:${s.max_access}`).join(', ')
      : String(d.scope);
    // If token is present (just created), show it
    const lines = [
      `[${d.id}] ${d.label}   prefix:${d.token_prefix}   scope:[${scopeStr}]`,
    ];
    if (d.token) {
      lines.push(`PROVISION TOKEN (copy now — shown once):`);
      lines.push(`  ${d.token}`);
    }
    return lines.join('\n');
  }

  // Rotate token response  { id, token, token_prefix }
  if ('token_prefix' in d && 'token' in d && 'id' in d && !d.agent) {
    return [
      `Agent: ${d.id}`,
      `NEW TOKEN (copy now — shown once):`,
      `  ${d.token}`,
      `prefix: ${d.token_prefix}`,
    ].join('\n');
  }

  // Fallback: pretty JSON
  return JSON.stringify(d, null, 2);
}

// ── flag parsers ───────────────────────────────────────────────────────────
function extractFlag(arr, flag) {
  const i = arr.indexOf(flag);
  if (i === -1) return [undefined, arr];
  const val = arr[i + 1];
  const rest2 = [...arr.slice(0, i), ...arr.slice(i + 2)];
  return [val, rest2];
}

function extractFlagAll(arr, flag) {
  const vals = [];
  let remaining = [...arr];
  let i;
  while ((i = remaining.indexOf(flag)) !== -1) {
    vals.push(remaining[i + 1]);
    remaining = [...remaining.slice(0, i), ...remaining.slice(i + 2)];
  }
  return [vals, remaining];
}

function extractBoolFlag(arr, flag) {
  const i = arr.indexOf(flag);
  if (i === -1) return [false, arr];
  const rest2 = [...arr.slice(0, i), ...arr.slice(i + 1)];
  return [true, rest2];
}

// ── HELP ───────────────────────────────────────────────────────────────────
function showHelp() {
  process.stdout.write(`\
Kanban CLI — dependency-free agent interface to the Kanban REST API.

Env vars required: KANBAN_URL, KANBAN_TOKEN
Optional:          KANBAN_PROVISION_TOKEN (onboard only)

Subcommands:
  me
  projects
  tasks [projectId] [--status <s>] [--assignee <a>]   (projectId optional if KANBAN_PROJECT set)
  task <id>
  claim <id> [assigneeId]
  status <id> <backlog|todo|in_progress|done>
  branch <id> <branchName> <none|dev|pr|merged>
  comment <id> <text...>
  new <projectId> <title...> [--priority <p>] [--desc <d>] [--status <s>] [--story <id>] [--id <id>] [--created <ISO>]
  epic-create <projectId> <epicId> <title...>
  story-create <epicId> <storyId> <title...>
  attach <task|request> <entityId> <filepath>
  download <attachmentId> [outpath]
  request <fromProj> <toProj> <title...>
  request-action <reqId> <accept|decline|start|done|cancel>
  requests [projectId]   (projectId optional if KANBAN_PROJECT set)
  onboard <agentId> <agentName> [--role <r>] [--grant proj:access ...]
  help

Admin (requires admin token — KANBAN_TOKEN must belong to an agent with is_admin=true):
  agents
  perms <agentId>
  grant <agentId> <projectId> <read|write|none>
  set-admin <agentId> <true|false>
  project-create <id> <KEY> <name...> [--color <#hex>] [--desc <text>]
  provision <agentId> <agentName> [--role <r>] [--grant proj:access ...] [--admin]
  rotate <agentId>
  tokens
  token-create <label> <proj:maxaccess> [<proj:maxaccess> ...]
  token-revoke <id>

Add --json to any command for raw JSON output.
`);
}

// ── SUBCOMMANDS ────────────────────────────────────────────────────────────
async function cmdMe() {
  requireEnv();
  const data = await apiFetch('/me', { headers: authHeaders() });
  print(data);
}

async function cmdProjects() {
  requireEnv();
  const data = await apiFetch('/projects', { headers: authHeaders() });
  print(data);
}

async function cmdTasks(args) {
  requireEnv();
  const [statusVal, args2] = extractFlag(args, '--status');
  const [assigneeVal, args3] = extractFlag(args2, '--assignee');
  const projectId = args3[0] || DEFAULT_PROJECT;
  if (!projectId) die('Usage: tasks [projectId] [--status s] [--assignee a]  (projectId optional if KANBAN_PROJECT is set)');

  let tasks = await apiFetch(`/projects/${projectId}/tasks`, { headers: authHeaders() });

  if (statusVal) tasks = tasks.filter(t => t.status === statusVal);
  if (assigneeVal) tasks = tasks.filter(t => t.assignee_id === assigneeVal);
  print(tasks);
}

async function cmdTask(args) {
  requireEnv();
  const [id] = args;
  if (!id) die('Usage: task <id>');
  const data = await apiFetch(`/tasks/${id}`, { headers: authHeaders() });
  print(data);
}

async function cmdClaim(args) {
  requireEnv();
  const [id, assigneeId] = args;
  if (!id) die('Usage: claim <id> [assigneeId]');
  const body = { status: 'in_progress', _log: `${TOKEN.slice(0, 13)} claimed this task` };
  if (assigneeId) body.assignee_id = assigneeId;
  const data = await apiFetch(`/tasks/${id}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  print(data);
}

async function cmdStatus(args) {
  requireEnv();
  const [id, status] = args;
  const valid = ['backlog', 'todo', 'in_progress', 'done'];
  if (!id || !status) die('Usage: status <id> <backlog|todo|in_progress|done>');
  if (!valid.includes(status)) die(`Invalid status "${status}". Valid: ${valid.join(', ')}`);
  const data = await apiFetch(`/tasks/${id}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ status, _log: `status set to ${status}` }),
  });
  print(data);
}

async function cmdBranch(args) {
  requireEnv();
  const [id, branch, mergeState] = args;
  const validMS = ['none', 'dev', 'pr', 'merged'];
  if (!id || !branch || !mergeState) die('Usage: branch <id> <branchName> <none|dev|pr|merged>');
  if (!validMS.includes(mergeState)) die(`Invalid merge_state "${mergeState}". Valid: ${validMS.join(', ')}`);
  const data = await apiFetch(`/tasks/${id}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      branch,
      merge_state: mergeState,
      _log: `branch set to ${branch}, merge_state: ${mergeState}`,
    }),
  });
  print(data);
}

async function cmdComment(args) {
  requireEnv();
  const [id, ...textParts] = args;
  if (!id || textParts.length === 0) die('Usage: comment <id> <text...>');
  const body = textParts.join(' ');
  const data = await apiFetch(`/tasks/${id}/comments`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body }),
  });
  print(data);
}

async function cmdNew(args) {
  requireEnv();
  const [priorityVal, args2] = extractFlag(args, '--priority');
  const [descVal, args3] = extractFlag(args2, '--desc');
  const [statusVal, args4] = extractFlag(args3, '--status');
  const [storyVal, args5] = extractFlag(args4, '--story');
  const [idVal, args6] = extractFlag(args5, '--id');
  const [createdVal, args7] = extractFlag(args6, '--created'); // ISO 8601, for historical imports
  const [projectId, ...titleParts] = args7;
  if (!projectId || titleParts.length === 0) {
    die('Usage: new <projectId> <title...> [--priority p] [--desc d] [--status s] [--story id] [--id id] [--created ISO]');
  }
  const payload = {
    title: titleParts.join(' '),
    status: statusVal || 'backlog',
  };
  if (priorityVal) payload.priority = priorityVal;
  if (descVal) payload.description = descVal;
  if (storyVal) payload.story_id = storyVal;
  if (idVal) payload.id = idVal;
  if (createdVal) { payload.created_at = createdVal; payload.updated_at = createdVal; }
  const data = await apiFetch(`/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  print(data);
}

// epic-create <projectId> <epicId> <title...>
async function cmdEpicCreate(args) {
  requireEnv();
  const [projectId, epicId, ...titleParts] = args;
  if (!projectId || !epicId || titleParts.length === 0) {
    die('Usage: epic-create <projectId> <epicId> <title...>');
  }
  const data = await apiFetch(`/projects/${projectId}/epics`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: epicId, title: titleParts.join(' ') }),
  });
  if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(`Epic created: ${data.id} — ${data.title} (project ${data.project_id})\n`);
}

// story-create <epicId> <storyId> <title...>
async function cmdStoryCreate(args) {
  requireEnv();
  const [epicId, storyId, ...titleParts] = args;
  if (!epicId || !storyId || titleParts.length === 0) {
    die('Usage: story-create <epicId> <storyId> <title...>');
  }
  const data = await apiFetch(`/epics/${epicId}/stories`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: storyId, title: titleParts.join(' ') }),
  });
  if (jsonMode) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(`Story created: ${data.id} — ${data.title} (epic ${data.epic_id})\n`);
}

async function cmdAttach(args) {
  requireEnv();
  const [entityType, entityId, filepath] = args;
  if (!entityType || !entityId || !filepath) die('Usage: attach <task|request> <id> <filepath>');
  if (!['task', 'request'].includes(entityType)) die('Entity type must be "task" or "request"');

  let fileBytes;
  try { fileBytes = readFileSync(filepath); } catch (e) { die(`Cannot read file: ${filepath} — ${e.message}`); }
  const filename = basename(filepath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBytes]), filename);

  const endpoint = entityType === 'task'
    ? `/tasks/${entityId}/attachments`
    : `/requests/${entityId}/attachments`;

  const data = await apiFetch(endpoint, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  print(data);
}

async function cmdDownload(args) {
  requireEnv();
  const [attachmentId, outpath] = args;
  if (!attachmentId) die('Usage: download <attachmentId> [outpath]');

  const res = await apiFetch(`/attachments/${attachmentId}`, {
    headers: authHeaders(),
    redirect: 'follow',
  });

  // res is the raw Response when not JSON
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = outpath || `attachment_${attachmentId}`;
  writeFileSync(filename, buf);
  process.stdout.write(`Downloaded ${buf.length} bytes → ${filename}\n`);
}

async function cmdRequest(args) {
  requireEnv();
  const [fromProj, toProj, ...titleParts] = args;
  if (!fromProj || !toProj || titleParts.length === 0) {
    die('Usage: request <fromProj> <toProj> <title...>');
  }
  const data = await apiFetch('/requests', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      from_project_id: fromProj,
      to_project_id: toProj,
      title: titleParts.join(' '),
    }),
  });
  print(data);
}

async function cmdRequestAction(args) {
  requireEnv();
  const [reqId, action] = args;
  const validActions = ['accept', 'decline', 'start', 'done', 'cancel'];
  if (!reqId || !action) die('Usage: request-action <reqId> <accept|decline|start|done|cancel>');
  if (!validActions.includes(action)) die(`Invalid action "${action}". Valid: ${validActions.join(', ')}`);
  const data = await apiFetch(`/requests/${reqId}/actions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action }),
  });
  print(data);
}

async function cmdRequests(args) {
  requireEnv();
  const projectId = args[0] || DEFAULT_PROJECT;
  if (!projectId) die('Usage: requests [projectId]  (projectId optional if KANBAN_PROJECT is set)');
  const data = await apiFetch(`/projects/${projectId}/requests`, { headers: authHeaders() });
  print(data);
}

async function cmdOnboard(args) {
  requireProvToken();
  const [roleVal, args2] = extractFlag(args, '--role');
  const [grantVals, args3] = extractFlagAll(args2, '--grant');
  const [agentId, ...nameParts] = args3;
  if (!agentId || nameParts.length === 0) {
    die('Usage: onboard <agentId> <agentName> [--role r] [--grant proj:access ...]');
  }
  const name = nameParts.join(' ');

  const grants = grantVals.map(g => {
    const [project_id, access] = g.split(':');
    if (!project_id || !access) die(`Invalid --grant format: "${g}". Expected proj:access (e.g. aws:write)`);
    return { project_id, access };
  });

  const payload = { id: agentId, name };
  if (roleVal) payload.role = roleVal;
  if (grants.length) payload.grants = grants;

  const url = `${BASE}/agents`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: provHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    die(`Network error: ${err.message}`);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    die(`HTTP ${res.status} ${res.statusText} — POST /agents\n${body}`);
  }

  const data = await res.json();
  // Always print the token in human mode even with --json off — it must be seen
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(formatItem(data) + '\n');
  }
}

// ── ADMIN SUBCOMMANDS ──────────────────────────────────────────────────────

// agents — list all agents
async function cmdAgents() {
  requireEnv();
  const data = await apiFetch('/agents', { headers: authHeaders() });
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    // Header line
    process.stdout.write(
      `${'ID'.padEnd(20)} ${'NAME'.padEnd(24)} ${'ROLE'.padEnd(24)} ADMIN\n`
    );
    process.stdout.write(`${'-'.repeat(80)}\n`);
    for (const a of data) {
      process.stdout.write(
        `${(a.id || '').padEnd(20)} ${(a.name || '').padEnd(24)} ${(a.role || '—').padEnd(24)} ${a.is_admin}\n`
      );
    }
  }
}

// perms <agentId>
async function cmdPerms(args) {
  requireEnv();
  const [agentId] = args;
  if (!agentId) die('Usage: perms <agentId>');
  const data = await apiFetch(`/agents/${agentId}/permissions`, { headers: authHeaders() });
  print(data);
}

// grant <agentId> <projectId> <read|write|none>
async function cmdGrant(args) {
  requireEnv();
  const [agentId, projectId, access] = args;
  if (!agentId || !projectId || !access) die('Usage: grant <agentId> <projectId> <read|write|none>');
  if (!['read', 'write', 'none'].includes(access)) die('access must be read, write, or none');
  const data = await apiFetch(`/agents/${agentId}/permissions/${projectId}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ access }),
  });
  print(data);
}

// set-admin <agentId> <true|false>
async function cmdSetAdmin(args) {
  requireEnv();
  const [agentId, flagStr] = args;
  if (!agentId || flagStr === undefined) die('Usage: set-admin <agentId> <true|false>');
  if (!['true', 'false'].includes(flagStr)) die('Value must be "true" or "false"');
  const is_admin = flagStr === 'true';

  // Fetch the current agent to preserve name/role (server PATCH destructures all three
  // fields and some store implementations SET NULL for undefined fields).
  const agents = await apiFetch('/agents', { headers: authHeaders() });
  const current = (agents || []).find(a => a.id === agentId);
  if (!current) die(`Unknown agent: ${agentId}`);

  const data = await apiFetch(`/agents/${agentId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ is_admin, name: current.name, role: current.role }),
  });
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(
      `Agent ${data.id || agentId} is_admin → ${data.is_admin !== undefined ? data.is_admin : is_admin}\n`
    );
  }
}

// project-create <id> <key> <name...> [--color #hex] [--desc text]
async function cmdProjectCreate(args) {
  requireEnv();
  const [colorVal, args2] = extractFlag(args, '--color');
  const [descVal, args3] = extractFlag(args2, '--desc');
  const [id, key, ...nameParts] = args3;
  if (!id || !key || nameParts.length === 0) {
    die('Usage: project-create <id> <KEY> <name...> [--color #hex] [--desc text]\n  id: lowercase letters/numbers/dashes;  KEY: 1-8 uppercase letters/numbers');
  }
  const payload = { id, key: key.toUpperCase(), name: nameParts.join(' ') };
  if (colorVal) payload.color = colorVal;
  if (descVal) payload.description = descVal; // API is snake_case

  const data = await apiFetch('/projects', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });

  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(`Project created: ${data.id} [${data.key}] — ${data.name}\n`);
  }
}

// provision <id> <name> [--role r] [--grant proj:access ...] [--admin]
async function cmdProvision(args) {
  requireEnv();
  const [roleVal, args2] = extractFlag(args, '--role');
  const [grantVals, args3] = extractFlagAll(args2, '--grant');
  const [isAdminFlag, args4] = extractBoolFlag(args3, '--admin');
  const [agentId, ...nameParts] = args4;
  if (!agentId || nameParts.length === 0) {
    die('Usage: provision <agentId> <agentName> [--role r] [--grant proj:access ...] [--admin]');
  }
  const name = nameParts.join(' ');

  const grants = grantVals.map(g => {
    const [project_id, access] = g.split(':');
    if (!project_id || !access) die(`Invalid --grant format: "${g}". Expected proj:access (e.g. aws:write)`);
    return { project_id, access };
  });

  const payload = { id: agentId, name };
  if (roleVal) payload.role = roleVal;
  if (grants.length) payload.grants = grants;
  if (isAdminFlag) payload.is_admin = true;

  const data = await apiFetch('/agents', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });

  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(formatItem(data) + '\n');
  }
}

// rotate <agentId>
async function cmdRotate(args) {
  requireEnv();
  const [agentId] = args;
  if (!agentId) die('Usage: rotate <agentId>');
  const data = await apiFetch(`/agents/${agentId}/token`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(formatItem(data) + '\n');
  }
}

// tokens — list provision tokens
async function cmdTokens() {
  requireEnv();
  const data = await apiFetch('/provision-tokens', { headers: authHeaders() });
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    if (!data.length) {
      process.stdout.write('(no scoped provision tokens)\n');
      return;
    }
    for (const t of data) {
      process.stdout.write(formatItem(t) + '\n');
    }
  }
}

// token-create <label> <proj:maxaccess> [<proj:maxaccess> ...]
async function cmdTokenCreate(args) {
  requireEnv();
  const [label, ...scopeParts] = args;
  if (!label || scopeParts.length === 0) {
    die('Usage: token-create <label> <proj:maxaccess> [<proj:maxaccess> ...]');
  }
  const scope = scopeParts.map(s => {
    const [project_id, max_access] = s.split(':');
    if (!project_id || !max_access) die(`Invalid scope format: "${s}". Expected proj:maxaccess (e.g. aws:write)`);
    return { project_id, max_access };
  });

  const data = await apiFetch('/provision-tokens', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ label, scope }),
  });

  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    process.stdout.write(formatItem(data) + '\n');
  }
}

// token-revoke <id>
async function cmdTokenRevoke(args) {
  requireEnv();
  const [id] = args;
  if (!id) die('Usage: token-revoke <id>');

  const url = `${BASE}/provision-tokens/${id}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'DELETE',
      headers: authHeaders(),
    });
  } catch (err) {
    die(`Network error: ${err.message}`);
  }

  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (_) {}
    if (res.status === 403) {
      die(`HTTP 403 Forbidden — DELETE /provision-tokens/${id}\n(This command requires an admin token.)`);
    }
    die(`HTTP ${res.status} ${res.statusText} — DELETE /provision-tokens/${id}\n${body}`);
  }

  process.stdout.write(`Provision token ${id} revoked.\n`);
}

// ── DISPATCH ───────────────────────────────────────────────────────────────
const commands = {
  me:             () => cmdMe(),
  projects:       () => cmdProjects(),
  tasks:          () => cmdTasks(rest),
  task:           () => cmdTask(rest),
  claim:          () => cmdClaim(rest),
  status:         () => cmdStatus(rest),
  branch:         () => cmdBranch(rest),
  comment:        () => cmdComment(rest),
  new:            () => cmdNew(rest),
  'epic-create':  () => cmdEpicCreate(rest),
  'story-create': () => cmdStoryCreate(rest),
  attach:         () => cmdAttach(rest),
  download:       () => cmdDownload(rest),
  request:        () => cmdRequest(rest),
  'request-action': () => cmdRequestAction(rest),
  requests:       () => cmdRequests(rest),
  onboard:        () => cmdOnboard(rest),
  // Admin
  agents:         () => cmdAgents(),
  perms:          () => cmdPerms(rest),
  grant:          () => cmdGrant(rest),
  'set-admin':    () => cmdSetAdmin(rest),
  'project-create': () => cmdProjectCreate(rest),
  provision:      () => cmdProvision(rest),
  rotate:         () => cmdRotate(rest),
  tokens:         () => cmdTokens(),
  'token-create': () => cmdTokenCreate(rest),
  'token-revoke': () => cmdTokenRevoke(rest),
  help:           () => { showHelp(); process.exit(0); },
};

if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
  showHelp();
  process.exit(0);
}

const fn = commands[subcommand];
if (!fn) {
  process.stderr.write(`Unknown subcommand: "${subcommand}"\n`);
  showHelp();
  process.exit(1);
}

fn().catch(err => {
  process.stderr.write(`Unhandled error: ${err.message}\n`);
  process.exit(1);
});

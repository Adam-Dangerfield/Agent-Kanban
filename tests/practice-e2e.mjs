import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.join(root, 'tmp/practice');
const base = 'http://127.0.0.1:45441/api';
const password = fs.readFileSync(path.join(state, 'manager_password'), 'utf8').trim();
const agent = fs.readFileSync(path.join(state, 'agent_token'), 'utf8').trim();
let manager;
async function request(method, route, token, body, expected = 200) {
  const response = await fetch(base + route, { method, headers: {
    'Content-Type': 'application/json', Connection: 'close', ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, expected, `${method} ${route}: unexpected status`);
  return response.status === 204 ? null : response.json();
}
manager = (await request('POST', '/auth/login', null, { password })).token;
const task = await request('POST', '/projects/fact-checker-pilot/tasks', agent,
  { title: 'Automated practice verification', status: 'todo', priority: 'critical' }, 201);
const action = (body, token = agent, expected = 200) => request('POST', `/tasks/${task.id}/workflow`, token, body, expected);
const checks = [];
try {
  await action({ action: 'publish', revision: 0, kind: 'decision', summary: 'Two synthetic sources disagree', question: 'Use source A or B?' });
  await request('POST', `/tasks/${task.id}/claim`, agent, {}, 409);
  await action({ action: 'answer', revision: 1, answer: 'Assumed A' }, agent, 403);
  await action({ action: 'answer', revision: 1, answer: '' }, manager, 400);
  const answered = await action({ action: 'answer', revision: 1, answer: 'Synthetic test answer: source B' }, manager);
  assert.equal(answered.status, 'todo');
  checks.push('pending question blocks claim; agent and empty answer rejected; human answer does not finish work');
  await request('POST', `/tasks/${task.id}/claim`, agent, {}, 200);
  await request('PATCH', `/tasks/${task.id}`, agent, { status: 'done', _log: 'Synthetic result verified' });
  await action({ action: 'publish', revision: 1, kind: 'information', summary: 'Synthetic result revision two' });
  let queues = await request('GET', '/workflow', agent);
  assert.ok(queues.conversation.some((item) => item.id === task.id));
  await action({ action: 'discuss', revision: 2 }, manager);
  queues = await request('GET', '/workflow', agent);
  assert.ok(!queues.conversation.some((item) => item.id === task.id));
  await action({ action: 'publish', revision: 2, kind: 'information', summary: 'Synthetic newer result' });
  await action({ action: 'discuss', revision: 2 }, manager, 409);
  checks.push('done remains in conversation until discussed; newer result returns; stale discussion rejected');
  await action({ action: 'defer', revision: 3, reason: 'Synthetic pause', condition: 'Explicit resumption during test' });
  queues = await request('GET', '/workflow', agent);
  assert.ok(queues.deferred.some((item) => item.id === task.id));
  assert.ok(!queues.conversation.some((item) => item.id === task.id));
  execFileSync(process.execPath, ['scripts/local-pilot.mjs', 'restart'], { cwd: root, stdio: 'pipe', timeout: 60000 });
  manager = (await request('POST', '/auth/login', null, { password })).token;
  const restored = await request('GET', `/tasks/${task.id}`, agent);
  assert.equal(restored.workflow.deferred, true);
  assert.equal(restored.workflow.revision, 3);
  assert.equal(restored.assignee_id, 'orchestrator');
  assert.ok(restored.activity.some((item) => item.text.includes('Synthetic test answer: source B')));
  await action({ action: 'resume', revision: 3 });
  queues = await request('GET', '/workflow', agent);
  assert.ok(queues.conversation.some((item) => item.id === task.id));
  checks.push('API and PostgreSQL restart preserves owner, revision, deferral and historical answer; resume restores queue');
  for (const route of ['/../tmp/practice/manager_password', '/scripts/local-pilot.mjs', '/server/src/index.js']) {
    const response = await fetch('http://127.0.0.1:45441' + route);
    assert.ok([401, 404].includes(response.status));
  }
  checks.push('private and server files are not served by the local UI');
  fs.writeFileSync(path.join(root, 'tmp/practice_e2e_results.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  await request('DELETE', `/tasks/${task.id}`, manager, undefined, 204);
}

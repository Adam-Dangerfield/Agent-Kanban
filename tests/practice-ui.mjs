import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.join(root, 'tmp/practice');
const base = 'http://127.0.0.1:45441';
const password = fs.readFileSync(path.join(state, 'manager_password'), 'utf8').trim();
const agent = fs.readFileSync(path.join(state, 'agent_token'), 'utf8').trim();
let manager;
async function api(method, route, body, token = agent) {
  const response = await fetch(base + '/api' + route, { method, headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `API ${method} ${route} status ${response.status}`);
  return response.status === 204 ? null : response.json();
}
manager = (await api('POST', '/auth/login', { password }, '')).token;
const task = await api('POST', '/projects/fact-checker-pilot/tasks', { title: 'Browser practice verification', status: 'todo', priority: 'critical' });
const publish = (revision, body) => api('POST', `/tasks/${task.id}/workflow`, { action: 'publish', revision, ...body });
await publish(0, { kind: 'decision', summary: 'Browser test: compare two synthetic sources', question: 'Which synthetic source should be used?' });

let executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || chromium.executablePath();
if (!fs.existsSync(executablePath) && process.platform === 'darwin') {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const versions = fs.readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse();
  executablePath = versions.map((name) => path.join(cache, name, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')).find((file) => fs.existsSync(file));
}
const browser = await chromium.launch({ headless: true, executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
let createdId;
page.on('pageerror', (error) => errors.push(error.name));
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Work and conversation' }).waitFor();
  await page.getByText('Which synthetic source should be used?', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send answer', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true);
  await page.getByLabel('Your answer', { exact: true }).fill('Synthetic browser answer: source A');
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await page.getByText('No updates need a response.', { exact: true }).waitFor();
  let saved = await api('GET', `/tasks/${task.id}`);
  assert.equal(saved.workflow.answer, 'Synthetic browser answer: source A');
  assert.equal(saved.status, 'todo');
  await publish(1, { kind: 'information', summary: 'Browser test: completed synthetic comparison' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Browser test: completed synthetic comparison', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mark discussed', exact: true }).click();
  await page.getByText('No updates need a response.', { exact: true }).waitFor();
  await publish(2, { kind: 'information', summary: 'Browser test: newer evidence to revisit' });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByText('Browser test: newer evidence to revisit', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Defer', exact: true }).click();
  await page.getByLabel('Reason', { exact: true }).fill('Synthetic browser pause');
  await page.getByLabel('Return condition (optional)', { exact: true }).fill('User explicitly resumes the test');
  await page.getByRole('button', { name: 'Defer card', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  saved = await api('GET', `/tasks/${task.id}`);
  assert.equal(saved.workflow.deferred, true);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText('Browser test: newer evidence to revisit', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'tmp/practice-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(root, 'tmp/practice-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, 'Mobile layout must not overflow horizontally');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'New card', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Browser-created practice card');
  const [createdResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && /\/projects\/[^/]+\/tasks$/.test(response.url())),
    page.getByRole('button', { name: 'Create ticket', exact: true }).click(),
  ]);
  assert.equal(createdResponse.status(), 201);
  createdId = (await createdResponse.json()).id;
  await page.getByRole('heading', { name: 'Publish an update', exact: true }).waitFor();
  await page.getByLabel('Summary', { exact: true }).fill('Publication entered through the browser form');
  const [publishedResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/tasks/${createdId}/workflow`)),
    page.getByRole('button', { name: 'Publish update', exact: true }).click(),
  ]);
  assert.equal(publishedResponse.status(), 200);
  const publishedCard = await api('GET', `/tasks/${createdId}`);
  assert.equal(publishedCard.workflow.summary, 'Publication entered through the browser form');
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  const results = { passed: true, checks: ['login and global view', 'blank answer and next blocked', 'human answer saved without finishing task', 'discussion and newer result', 'defer and explicit resume', 'desktop and mobile without horizontal overflow', 'create card and publish from browser form', 'no uncaught browser errors'] };
  fs.writeFileSync(path.join(root, 'tmp/practice_ui_results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await api('DELETE', `/tasks/${task.id}`, undefined, manager);
  if (createdId) await api('DELETE', `/tasks/${createdId}`, undefined, manager);
}

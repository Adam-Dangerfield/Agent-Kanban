import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { store } = require('../server/src/store');

test('memory store retains workflow on ordinary cards and blocks pending claim', () => {
  assert.equal(process.env.DATABASE_URL, undefined, 'run this test without DATABASE_URL');
  const task = store.createTask({ project_id: 'aws', id: 'AWS-9999', title: 'Memory workflow', status: 'todo' }, 'adam');
  assert.equal(task.workflow.revision, 0);
  assert.equal(task.story_id, null);
  const published = store.applyWorkflowAction(task.id, {
    action: 'publish', revision: 0, kind: 'confirmation', summary: 'Ready', question: 'Proceed?',
  }, 'claude', 'agent');
  assert.equal(published.workflow.revision, 1);
  assert.equal(store.claimTask(task.id, 'claude', 'claude', 'claimed this task'), null);
  const answered = store.applyWorkflowAction(task.id, {
    action: 'answer', revision: 1, answer: 'Proceed',
  }, 'adam', 'human');
  assert.equal(answered.workflow.answer, 'Proceed');
  assert.equal(store.claimTask(task.id, 'claude', 'claude', 'claimed this task').assignee_id, 'claude');
});

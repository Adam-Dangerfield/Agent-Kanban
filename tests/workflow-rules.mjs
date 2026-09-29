import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  defaultWorkflow, applyWorkflowAction, isPendingQuestion, isClaimBlocked, buildWorkflowQueues,
} = require('../server/src/workflow');

test('publication preserves an unanswered question and rejects stale writes', () => {
  const initial = defaultWorkflow();
  const published = applyWorkflowAction(initial, {
    action: 'publish', revision: 0, kind: 'decision', summary: 'Choose a path', question: 'Which path?',
  }, 'agent');
  assert.equal(published.revision, 1);
  assert.equal(isPendingQuestion(published), true);
  assert.throws(() => applyWorkflowAction(published, {
    action: 'publish', revision: 1, kind: 'information', summary: 'Changed',
  }, 'agent'), { code: 'WORKFLOW_CONFLICT' });
  assert.throws(() => applyWorkflowAction(published, {
    action: 'answer', revision: 0, answer: 'First',
  }, 'human'), { code: 'WORKFLOW_CONFLICT' });
  assert.equal(published.question, 'Which path?');
});

test('human answer records the exact revision without completing the task', () => {
  const published = applyWorkflowAction(defaultWorkflow(), {
    action: 'publish', revision: 0, kind: 'confirmation', summary: 'Ready', question: 'Proceed?',
  }, 'agent');
  assert.throws(() => applyWorkflowAction(published, {
    action: 'answer', revision: 1, answer: 'Yes',
  }, 'agent'), { code: 'WORKFLOW_FORBIDDEN' });
  assert.throws(() => applyWorkflowAction(published, {
    action: 'answer', revision: 1, answer: '   ',
  }, 'human'), { code: 'WORKFLOW_INVALID' });
  const answered = applyWorkflowAction(published, {
    action: 'answer', revision: 1, answer: 'Yes',
  }, 'human');
  assert.equal(answered.answer, 'Yes');
  assert.equal(answered.discussed_revision, 1);
  assert.equal(isPendingQuestion(answered), false);
});

test('information discussion requires a human and an exact revision', () => {
  assert.throws(() => applyWorkflowAction(defaultWorkflow(), {
    action: 'publish', revision: 0, kind: 'information', summary: 'Progress', question: 'Proceed?',
  }, 'agent'), { code: 'WORKFLOW_INVALID' });
  const published = applyWorkflowAction(defaultWorkflow(), {
    action: 'publish', revision: 0, kind: 'information', summary: 'Progress',
  }, 'agent');
  assert.throws(() => applyWorkflowAction(published, {
    action: 'discuss', revision: 1,
  }, 'agent'), { code: 'WORKFLOW_FORBIDDEN' });
  const discussed = applyWorkflowAction(published, { action: 'discuss', revision: 1 }, 'human');
  assert.equal(discussed.discussed_revision, 1);
  assert.throws(() => applyWorkflowAction(discussed, { action: 'discuss', revision: 1 }, 'human'), {
    code: 'WORKFLOW_CONFLICT',
  });
});

test('deferral blocks claim until explicit resume, even after its date', () => {
  const deferred = applyWorkflowAction(defaultWorkflow(), {
    action: 'defer', revision: 0, reason: 'Waiting', until: '2020-01-01T00:00:00.000Z',
  }, 'agent');
  assert.equal(isClaimBlocked(deferred), true);
  assert.throws(() => applyWorkflowAction(defaultWorkflow(), {
    action: 'defer', revision: 0, reason: 'Waiting',
  }, 'agent'), { code: 'WORKFLOW_INVALID' });
  const resumed = applyWorkflowAction(deferred, { action: 'resume', revision: 0 }, 'human');
  assert.equal(isClaimBlocked(resumed), false);
  assert.equal(resumed.deferred, false);
});

test('work queue respects hidden dependencies and all task blockers', () => {
  const task = (id, fields = {}) => ({
    id, project_id: 'visible', status: 'todo', priority: 'medium', created_at: '2025-01-01T00:00:00Z',
    assignee_id: null, blocked_reason: null, deps: [], workflow: defaultWorkflow(), ...fields,
  });
  const tasks = [
    task('ready'),
    task('hidden-blocked', { deps: ['secret'] }),
    task('secret', { project_id: 'hidden', title: 'Private task' }),
    task('reason-blocked', { blocked_reason: 'Wait' }),
    task('owned', { assignee_id: 'agent' }),
  ];
  const queues = buildWorkflowQueues(tasks, ['visible']);
  assert.deepEqual(queues.work.map((item) => item.id), ['ready']);
  assert.equal(JSON.stringify(queues).includes('Private task'), false);
});

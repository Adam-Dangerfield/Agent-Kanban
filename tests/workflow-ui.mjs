import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('workflow API translates task fields and sends a revision snapshot', async () => {
  const calls = [];
  const rawTask = {
    id: 'DEMO-1', project_id: 'demo', title: 'Review result', status: 'todo',
    workflow: {
      revision: 2, discussed_revision: 1, kind: 'decision',
      summary: 'Choose a path', question: 'Proceed?', next_step: 'Wait',
      deferred: false, defer_reason: null, return_condition: null, deferred_until: null,
    },
  };
  const context = {
    window: {},
    localStorage: { getItem: () => null },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const body = url === '/api/workflow'
        ? { work: [], conversation: [rawTask], deferred: [], active: [] }
        : rawTask;
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };
  vm.runInNewContext(fs.readFileSync(new URL('../api.js', import.meta.url), 'utf8'), context);

  const queues = await context.window.API.getWorkflow();
  assert.equal(queues.conversation[0].projectId, 'demo');
  assert.equal(queues.conversation[0].workflow.discussedRevision, 1);
  assert.equal(queues.conversation[0].workflow.nextStep, 'Wait');
  const updated = await context.window.API.workflowAction('DEMO-1', {
    action: 'answer', revision: queues.conversation[0].workflow.revision, answer: 'Yes',
  });
  assert.equal(updated.workflow.revision, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'answer', revision: 2, answer: 'Yes' });
  assert.equal(calls[1].url, '/api/tasks/DEMO-1/workflow');
});

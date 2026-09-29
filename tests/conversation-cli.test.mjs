import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest } from '../scripts/conversation.mjs';

test('answer requires an explicit human role and a concrete revision', () => {
  assert.throws(() => buildRequest(['answer', 'PFC-900', '--answer', 'Use source A']), /human/);
  assert.throws(() => buildRequest(['answer', 'PFC-900', '--human', '--answer', 'Use source A']), /revision/);
  assert.deepEqual(buildRequest(['answer', 'PFC-900', '--human', '--revision', '2', '--answer', 'Use source A']), {
    method: 'POST', route: '/tasks/PFC-900/workflow', human: true,
    body: { action: 'answer', revision: 2, answer: 'Use source A' },
  });
});

test('defer preserves reason and return condition without implicit resume', () => {
  const request = buildRequest(['defer', 'PFC-900', '--revision', '0', '--reason', 'Missing sample', '--condition', 'Sample arrives']);
  assert.deepEqual(request.body, { action: 'defer', revision: 0, reason: 'Missing sample', condition: 'Sample arrives' });
  assert.throws(() => buildRequest(['defer', 'PFC-900', '--revision', '0', '--reason', 'Missing sample']), /until|condition/);
});

test('next is a read and defaults to the conversation queue', () => {
  assert.deepEqual(buildRequest(['next']), { method: 'GET', route: '/workflow', human: false, select: 'conversation' });
  assert.equal(buildRequest(['next', 'work']).select, 'work');
  assert.throws(() => buildRequest(['next', 'unknown']), /queue/);
});

test('publishing and completing are separate explicit actions', () => {
  assert.deepEqual(buildRequest(['publish', 'PFC-900', '--revision', '0', '--kind', 'information', '--summary', 'Result']).body,
    { action: 'publish', revision: 0, kind: 'information', summary: 'Result' });
  assert.deepEqual(buildRequest(['complete', 'PFC-900', '--summary', 'Verified']).body,
    { status: 'done', _log: 'Verified' });
});

test('unknown flags, empty values and unsafe task paths fail before any request', () => {
  assert.throws(() => buildRequest(['task', '../agents']), /identifier/);
  assert.throws(() => buildRequest(['publish', 'PFC-900', '--revision', '0', '--kind', 'information', '--summary', '']), /summary/);
  assert.throws(() => buildRequest(['queues', '--token', 'secret']), /Unknown/);
});

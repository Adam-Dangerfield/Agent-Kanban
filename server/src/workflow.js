'use strict';

const KINDS = new Set(['information', 'confirmation', 'decision']);

function defaultWorkflow() {
  return {
    revision: 0,
    discussed_revision: 0,
    kind: null,
    summary: null,
    question: null,
    answer: null,
    next_step: null,
    deferred: false,
    defer_reason: null,
    return_condition: null,
    deferred_until: null,
  };
}

function normalizeWorkflow(value) {
  return { ...defaultWorkflow(), ...(value || {}) };
}

function workflowError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw workflowError('WORKFLOW_INVALID', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value == null || value === '') return null;
  return requiredText(value, field);
}

function isPendingQuestion(workflow) {
  const current = normalizeWorkflow(workflow);
  return !!current.question && !current.answer;
}

function isClaimBlocked(workflow) {
  const current = normalizeWorkflow(workflow);
  return current.deferred || isPendingQuestion(current);
}

function applyWorkflowAction(workflow, input, actorKind) {
  const current = normalizeWorkflow(workflow);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw workflowError('WORKFLOW_INVALID', 'body must be an object');
  }
  const action = input.action;
  if (!['publish', 'discuss', 'answer', 'defer', 'resume'].includes(action)) {
    throw workflowError('WORKFLOW_INVALID', 'unknown workflow action');
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw workflowError('WORKFLOW_INVALID', 'revision must be a non-negative integer');
  }
  if (input.revision !== current.revision) {
    throw workflowError('WORKFLOW_CONFLICT', 'workflow revision is stale');
  }
  if ((action === 'discuss' || action === 'answer') && actorKind !== 'human') {
    throw workflowError('WORKFLOW_FORBIDDEN', 'only a human may discuss or answer');
  }

  if (action === 'publish') {
    if (isPendingQuestion(current)) {
      throw workflowError('WORKFLOW_CONFLICT', 'answer the pending question before publishing');
    }
    if (!KINDS.has(input.kind)) {
      throw workflowError('WORKFLOW_INVALID', 'kind must be information, confirmation, or decision');
    }
    const summary = requiredText(input.summary, 'summary');
    const question = optionalText(input.question, 'question');
    if (input.kind === 'information' && question) {
      throw workflowError('WORKFLOW_INVALID', 'information cannot require an answer');
    }
    if (input.kind !== 'information' && !question) {
      throw workflowError('WORKFLOW_INVALID', 'confirmation and decision require a question');
    }
    return {
      ...current,
      revision: current.revision + 1,
      kind: input.kind,
      summary,
      question,
      answer: null,
      next_step: optionalText(input.next_step, 'next_step'),
    };
  }

  if (action === 'discuss') {
    if (current.kind !== 'information' || !current.revision ||
        current.discussed_revision >= current.revision || isPendingQuestion(current)) {
      throw workflowError('WORKFLOW_CONFLICT', 'this information cannot be discussed');
    }
    return { ...current, discussed_revision: current.revision };
  }

  if (action === 'answer') {
    const answer = requiredText(input.answer, 'answer');
    if (!isPendingQuestion(current)) {
      throw workflowError('WORKFLOW_CONFLICT', 'there is no pending question');
    }
    return { ...current, answer, discussed_revision: current.revision };
  }

  if (action === 'defer') {
    if (current.deferred) {
      throw workflowError('WORKFLOW_CONFLICT', 'task is already deferred');
    }
    const reason = requiredText(input.reason, 'reason');
    const condition = optionalText(input.condition, 'condition');
    let until = null;
    if (input.until != null && input.until !== '') {
      if (typeof input.until !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(input.until) ||
          !Number.isFinite(Date.parse(input.until))) {
        throw workflowError('WORKFLOW_INVALID', 'until must be an ISO timestamp');
      }
      until = new Date(input.until).toISOString();
    }
    if (!condition && !until) {
      throw workflowError('WORKFLOW_INVALID', 'defer requires until or condition');
    }
    return {
      ...current, deferred: true, defer_reason: reason,
      return_condition: condition, deferred_until: until,
    };
  }

  if (!current.deferred) {
    throw workflowError('WORKFLOW_CONFLICT', 'task is not deferred');
  }
  return {
    ...current, deferred: false, defer_reason: null,
    return_condition: null, deferred_until: null,
  };
}

function workflowActivityText(action, workflow) {
  if (action === 'publish') return `published revision ${workflow.revision}: ${JSON.stringify({
    kind: workflow.kind, summary: workflow.summary,
    question: workflow.question, next_step: workflow.next_step,
  })}`;
  if (action === 'discuss') return `discussed revision ${workflow.revision}`;
  if (action === 'answer') return `answered revision ${workflow.revision}: ${JSON.stringify({
    question: workflow.question, answer: workflow.answer,
  })}`;
  if (action === 'defer') return `deferred this task: ${JSON.stringify({
    reason: workflow.defer_reason, until: workflow.deferred_until,
    condition: workflow.return_condition,
  })}`;
  return 'resumed this task';
}

function compareWorkflowTasks(left, right) {
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  const priority = (rank[left.priority] ?? 4) - (rank[right.priority] ?? 4);
  if (priority) return priority;
  const leftDate = new Date(left.created_at).getTime();
  const rightDate = new Date(right.created_at).getTime();
  if (leftDate !== rightDate) return leftDate - rightDate;
  return left.id.localeCompare(right.id);
}

function buildWorkflowQueues(tasks, readableProjectIds) {
  const readable = new Set(readableProjectIds);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const queues = { work: [], conversation: [], deferred: [], active: [] };
  for (const task of tasks) {
    if (!readable.has(task.project_id)) continue;
    const workflow = normalizeWorkflow(task.workflow);
    const visibleDeps = (task.deps || []).filter((id) => {
      const dependency = byId.get(id);
      return dependency && readable.has(dependency.project_id);
    });
    const publicTask = { ...task, deps: visibleDeps, workflow };
    if (workflow.deferred) queues.deferred.push(publicTask);
    if (!workflow.deferred && workflow.revision > workflow.discussed_revision) {
      queues.conversation.push(publicTask);
    }
    if (task.status === 'in_progress') queues.active.push(publicTask);
    if (task.status === 'todo' && !task.assignee_id && !task.blocked_reason &&
        !isClaimBlocked(workflow) && (task.deps || []).every((id) => byId.get(id)?.status === 'done')) {
      queues.work.push(publicTask);
    }
  }
  for (const list of Object.values(queues)) list.sort(compareWorkflowTasks);
  return queues;
}

module.exports = {
  defaultWorkflow, normalizeWorkflow, applyWorkflowAction,
  isPendingQuestion, isClaimBlocked, workflowActivityText, buildWorkflowQueues,
};

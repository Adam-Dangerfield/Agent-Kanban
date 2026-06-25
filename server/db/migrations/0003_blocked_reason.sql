-- Free-text "blocked reason" for a task that's waiting on something which isn't
-- another tracked ticket (a vendor, an external decision, etc.). Task-to-task
-- blockers continue to live in task_deps; a task is considered blocked if it has
-- an open task-blocker OR a non-empty blocked_reason.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT;

-- Merge-gating & provenance (epic kanban-merge-gate).
--
-- type:       classifies a task so the done-gate (KANBAN-904) only applies to
--             code work. NULL = ungated. One of 'code' | 'doc' | 'decision'.
-- provenance: merged PRs/commits recorded on the task (KANBAN-901), an array of
--             { "repo": ..., "sha": ..., "url": ... } objects.
--
-- Both are additive and idempotent; existing rows get type=NULL, provenance=[].
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS type       TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '[]'::jsonb;

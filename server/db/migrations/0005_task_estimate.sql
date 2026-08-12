-- 0005_task_estimate.sql
-- KANBAN-913: per-task human-time estimate ("story-points" equivalent).
-- Stored as an integer number of minutes; NULL means unestimated. The UI enters
-- it via preset time buckets (15m…1wk) and rolls it up per epic; the API accepts
-- any non-negative integer minutes. Non-destructive, idempotent.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;

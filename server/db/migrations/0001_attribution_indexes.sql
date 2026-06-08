-- 0001_attribution_indexes
-- Attribution is the app's core ("who did what"). Index the actor columns on
-- the activity feed and agent messages so per-agent history stays fast as the
-- board grows. Idempotent; no-op on databases that already have them.

CREATE INDEX IF NOT EXISTS idx_activity_actor  ON activity(actor_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);

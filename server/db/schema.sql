-- ============================================================
--  Kanban — PostgreSQL schema (baseline / migration 0000)
--  All DDL is idempotent (IF NOT EXISTS + enum guards). Applied by the
--  migration runner (server/scripts/migrate.js), which wraps it in a
--  transaction — so this file must NOT contain its own BEGIN/COMMIT.
--  Incremental changes go in server/db/migrations/ (see its README).
-- ============================================================

-- ---- enums --------------------------------------------------
DO $$ BEGIN
  CREATE TYPE task_status   AS ENUM ('backlog', 'todo', 'in_progress', 'done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE priority      AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE merge_state   AS ENUM ('none', 'dev', 'pr', 'merged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('incoming', 'accepted', 'in_progress', 'done', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_kind    AS ENUM ('human', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE access_level AS ENUM ('read', 'write');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- people: manager (human) + agents ----------------------
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,                 -- e.g. 'claude'
  name          TEXT NOT NULL,
  kind          agent_kind NOT NULL DEFAULT 'agent',
  role          TEXT,
  color         TEXT,
  initials      TEXT,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  -- For agents only. Store ONLY a hash of the token, never the raw value.
  token_hash    TEXT,
  token_prefix  TEXT,                             -- shown in UI, e.g. 'agt_live_9f3c'
  -- For the human manager only.
  password_hash TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- projects ----------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,                   -- e.g. 'aws'
  name        TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,               -- e.g. 'AWS'
  color       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- epics --------------------------------------------------
CREATE TABLE IF NOT EXISTS epics (
  id         TEXT PRIMARY KEY,                    -- e.g. 'FOUND'
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT NOT NULL
);

-- ---- stories ------------------------------------------------
CREATE TABLE IF NOT EXISTS stories (
  id      TEXT PRIMARY KEY,                       -- e.g. 'FOUND-S01'
  epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  title   TEXT NOT NULL
);

-- ---- tasks (the cards) -------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,                  -- e.g. 'AWS-101'
  -- A task belongs to a project either via its story, or directly
  -- (spawned cross-team cards have project_id set and story_id null).
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id     TEXT REFERENCES stories(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT '',
  notes        TEXT DEFAULT '',                   -- description of the work
  status       task_status NOT NULL DEFAULT 'backlog',
  priority     priority    NOT NULL DEFAULT 'medium',
  assignee_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
  branch       TEXT,                              -- git branch name
  merge_state  merge_state NOT NULL DEFAULT 'none',
  from_request_id TEXT,                           -- set if spawned from a request
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);

-- ---- task dependencies (blocked-by) ------------------------
CREATE TABLE IF NOT EXISTS task_deps (
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- the blocked task
  depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,  -- the blocker
  PRIMARY KEY (task_id, depends_on)
);

-- ---- messages: agents log what they actually did -----------
CREATE TABLE IF NOT EXISTS comments (
  id        BIGSERIAL PRIMARY KEY,
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  body      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

-- ---- activity: append-only audit log -----------------------
-- Used for both tasks and requests (entity_type discriminates).
CREATE TABLE IF NOT EXISTS activity (
  id          BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,                      -- 'task' | 'request'
  entity_id   TEXT NOT NULL,
  actor_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity(entity_type, entity_id);

-- ---- cross-team requests (the shared inbox) ----------------
CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,               -- e.g. 'REQ-101'
  from_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  to_project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  priority        priority NOT NULL DEFAULT 'medium',
  requested_by    TEXT REFERENCES agents(id) ON DELETE SET NULL,
  assignee_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
  linked_task_id  TEXT REFERENCES tasks(id) ON DELETE SET NULL,  -- the ticket it unblocks
  spawned_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,  -- the card created on accept
  status          request_status NOT NULL DEFAULT 'incoming',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_to   ON requests(to_project_id);
CREATE INDEX IF NOT EXISTS idx_requests_from ON requests(from_project_id);

-- ---- per-(agent,project) RBAC permissions ------------------
CREATE TABLE IF NOT EXISTS agent_permissions (
  agent_id   TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  access     access_level NOT NULL,
  PRIMARY KEY (agent_id, project_id)
);

-- ---- attachments on tasks or requests ----------------------
CREATE TABLE IF NOT EXISTS attachments (
  id           BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL,                 -- 'task' | 'request'
  entity_id    TEXT NOT NULL,
  filename     TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT NOT NULL,
  storage_key  TEXT NOT NULL,                 -- key in local disk / S3
  uploaded_by  TEXT REFERENCES agents(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id);

-- ---- scoped provision tokens (admin-minted) ----------------
CREATE TABLE IF NOT EXISTS provision_tokens (
  id           BIGSERIAL PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  token_prefix TEXT NOT NULL,                 -- 13-char display prefix
  scope        JSONB NOT NULL DEFAULT '[]',   -- [{ "project_id": "...", "max_access": "read|write" }]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

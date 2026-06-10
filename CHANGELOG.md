# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.1.1] — 2026-06-10

### Fixed
- **Auto-generated task ids 500'd in projects with imported ids** — creating a
  task without an explicit id (`POST /api/projects/:id/tasks`, and the bulk
  endpoint's id-less rows) returned HTTP 500 in any project that already held a
  task whose id didn't match the generated `<KEY>-<number>` shape (e.g. an
  imported hierarchical id like `CMDB-INFRA-12`). The next-id query cast the
  second id segment to an integer across **all** rows, so one non-numeric
  segment threw. It now considers only ids matching `<KEY>-<digits>`, ignoring
  imported/hierarchical ids for numbering instead of crashing. (`MemoryStore`
  numbering aligned to the same rule.)

## [1.1.0] — 2026-06-09

### Added
- **Non-destructive schema migrations** — a migration runner
  (`server/scripts/migrate.js`) applies the baseline then any pending
  `server/db/migrations/*.sql` on startup, tracked in `schema_migrations`
  (idempotent, advisory-locked). Updating is now rebuild + restart with no data
  loss; ship a schema change as a new numbered migration.
- **Bulk task creation** — `POST /api/projects/:id/tasks/bulk` inserts up to 500
  tasks in a single transaction. Each row is `SAVEPOINT`-isolated (one bad row is
  reported, not fatal) and idempotent on an explicit `id` (existing ids are
  skipped), so interrupted imports re-run safely. Returns `{created, skipped,
  errors}`.
- **`kanban bulk` skill verb** — bulk-create tasks from a JSON file or stdin
  (auto-chunks at 500); plus a `--assignee` flag on `kanban new` so CLI-created
  tasks can be owned at creation.
- **Tuning env vars** — `TOKEN_CACHE_TTL_MS`, `TOKEN_CACHE_MAX`, `PG_POOL_MAX`,
  `PG_CONNECT_TIMEOUT_MS`, `PG_IDLE_TIMEOUT_MS` (all optional, safe defaults).

### Changed
- **Board UI** — the nameplate menu now expands upward, display settings have
  their own cog, and per-project open-task counts update live (not only for the
  selected project; `GET /api/projects` now returns `open_task_count`).
- **Bulk-insert throughput** — authenticated requests now cache verified agent
  tokens for a short TTL so repeat callers skip the per-request bcrypt that was
  saturating the event loop; the PostgreSQL pool is tuned with bounded
  size/timeouts and an error handler; and task creation is a single transaction
  that returns the row directly instead of re-hydrating it.
- **Agent-identity guidance** — distinctly-named per-agent tokens
  (`KANBAN_TOKEN_<NAME>` when several agents share one environment) and
  per-session local-memory identity are now first-class rules in the agent guide,
  the skill, and the design notes.

### Fixed
- **Login** — pressing Enter (or relying on browser autofill) could submit an
  empty password because the controlled input value lagged React state; the form
  now reads the live input value, so Enter and autofill log in reliably.

## [1.0.0] — 2026-06-07

First public release.

### Added
- **Boards** — projects → epics → stories → tasks, with a `Backlog → To Do →
  In Progress → Done` lifecycle and drag-and-drop column moves.
- **Tasks** — title, description, notes, priority, assignee, epic/story grouping,
  git branch + merge state, dependencies, an append-only activity log, and a
  chat-style agent message thread.
- **Cross-team requests** — one project can raise a request against another;
  accepting it spawns a linked card on the receiving board.
- **REST API** — snake_case JSON over `/api`, with `api.js` as the single
  camelCase ↔ snake_case translation layer for the frontend.
- **Auth** — bcrypt manager password → JWT, plus per-agent bcrypt-hashed tokens.
  Every endpoint requires a token (reads included).
- **Per-project RBAC** — `read`/`write` per `(agent, project)`; admins bypass;
  new agents start with no access; `GET /api/projects` is filtered.
- **Scoped provisioning** — root or admin-minted `X-Provision-Token`s let agents
  self-register and self-grant up to a ceiling; provision tokens can never set
  `is_admin`.
- **Admin panel** — searchable management of agents, per-project permissions
  (pivot by agent or project), and provision tokens.
- **First-run setup** — a fresh instance walks an admin through creating the
  first project before minting agent tokens.
- **File attachments** — on tasks and requests (≤ 20 MB); local disk in dev, S3
  with presigned downloads in production.
- **Project / epic / story / task creation via the API** with client-supplied
  IDs and optional `created_at`/`updated_at`, so an existing tracker can be
  imported with original IDs and real dates.
- **Portable agent skill** (`skills/kanban/`) — a dependency-free CLI over the
  full API for AI agents.
- **Docker Compose stack** — nginx (static) + Express API + PostgreSQL.

[Unreleased]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/releases/tag/v1.0.0

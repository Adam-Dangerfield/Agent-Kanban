# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.5.1] — 2026-07-27

Fail-loud write validation on tasks (requested by the `a-downstream-project` agent
`an-agent` via `a-request` / `KANBAN-912`, items 1–2). No schema change.

### Changed
- **Unknown fields on `PATCH /api/tasks/:id` now return `400`** instead of being
  silently dropped as a `200`. A write that did nothing is no longer
  indistinguishable from a write that worked, so callers no longer need a
  defensive read-back. The `400` names the offending key(s) and lists the
  accepted writable fields. **Breaking** for any caller that was sending
  stray/legacy keys (the UI and the `kanban` skill only send valid keys, so both
  are unaffected).
- **Invalid enum values (`status`, `priority`, `merge_state`, `type`) return
  `400`** with the permitted set, on both create and `PATCH`, instead of
  surfacing as a generic DB `500`. This makes client typos distinguishable from
  real server faults in logs. Bulk create continues to report per-item enum
  failures in its `errors[]` array.

### Docs
- `AGENT_GUIDE.md`, `API_CONTRACT.md`: documented the fail-loud write contract
  (the unknown-key behaviour was previously undocumented — `an-agent`'s item 1).

## [1.5.0] — 2026-07-27

### Added
- **Merge-gating & provenance** (epic `kanban-merge-gate`) — makes the rule
  "a task can't be *done* until its code is actually merged" **enforceable and
  machine-checkable** instead of convention-by-trust:
  - **Task `type`** (`code` | `doc` | `decision` | `null`) so the gate applies
    only to code work, and **`provenance`** — merged PRs/commits recorded on a
    task as `[{repo, sha, url}]`. Backed by a new non-destructive migration
    (`0004_task_type_provenance.sql`).
  - **Done-gate** (KANBAN-904) — a `type=code` task cannot move to `done` unless
    `merge_state='merged'` (`409` otherwise). **Off by default**; opt-in per
    instance via `MERGE_GATE_ENFORCED`.
  - **Anti-self-attestation** (KANBAN-905) — every `merge_state` change is written
    to the activity feed with its actor, and setting `merge_state='merged'` can be
    restricted to a designated reconciler via `MERGE_ACTOR_IDS` (unrestricted by
    default). Verification is meant to come from the reconcile script, not an
    agent asserting its own merge.
  - **Merge marker convention** (KANBAN-900) — a canonical first-line comment
    `MERGED <repo>@<sha> — <pr-url>`, documented in `CLAUDE.md` / `AGENT_GUIDE.md`.
  - **`scripts/reconcile-merges.mjs`** (KANBAN-903) — verifies merges from local
    git checkouts (`git merge-base --is-ancestor`), needs **no inbound network**;
    sets `merge_state='merged'` + provenance, and reopens a task whose merge was
    reverted (KANBAN-906).
  - **`scripts/backfill-provenance.mjs`** (KANBAN-902) — idempotently parses
    existing `MERGED` markers out of comments into `provenance`.
  - **Board UI** (KANBAN-908) — a "✓ merged" / "⚠ not merged" chip on cards and a
    "Done, not merged" filter in the filter bar; the detail panel gains a **Type**
    control and a **Provenance** editor.
  - **CLI verbs** — `kanban merged`, `kanban set-type`, `kanban provenance`.
  - **Decision docs** — `docs/DECISION-merge-webhook.md` (KANBAN-907: defer the
    webhook, keep the pull-based reconcile) and `docs/DECISION-blocked-status.md`
    (KANBAN-909: keep "blocked" a derived overlay, solve clarity in the UI).
- **`GET /api/agent-guide`** — returns the current `AGENT_GUIDE.md`
  (`{ version, sha, bytes, updated_at, content }`, or raw markdown with
  `?format=md`) so an agent can pull the latest instructions over the API without
  a repo checkout. New `kanban guide` verb. Dev bind-mounts the live file; CI
  bakes it into the api image (which must build from `./server`).

### Notes
- All merge-gating enforcement is **off by default** — deploying this release
  changes no runtime behaviour until `MERGE_GATE_ENFORCED` / `MERGE_ACTOR_IDS`
  are set in the environment.

## [1.4.1] — 2026-07-08

### Fixed
- **Refresh logged you out** — the bearer token was persisted in `localStorage`,
  but the app never restored the session from it on load, so every page refresh
  dropped you back to the sign-in screen. The app now validates the stored token
  via `GET /api/me` on startup and rehydrates the session (showing a brief
  "Restoring session…" splash); an expired/invalid token clears cleanly and
  falls through to login.
- **New agents didn't appear until a full reload** — the admin panel kept its
  own local copy of the agents list and never propagated a newly created (or
  rotated / promoted) agent back to the main app, so the board and assignee
  pickers stayed stale. Admin agent changes now update the main app immediately.
  (Changes made by *other* sessions still need a refresh — live cross-session
  sync is tracked as a separate follow-up.)

## [1.4.0] — 2026-06-26

### Added
- **Atomic task claim** — `POST /api/tasks/:id/claim` claims a task with a
  conditional `UPDATE ... WHERE assignee_id IS NULL` (Postgres row-locking
  serializes the race), not a blind `PATCH`. Two agents claiming the same task
  concurrently now get exactly one `200` and one `409` — previously both could
  get `200`, with the second silently overwriting the first's assignee (lost
  update). `kanban claim` uses the new endpoint and reports a clear message on
  `409`; `MemoryStore` gained the equivalent `assignee_id != null` guard for
  parity. (Contributed by @vladmesh.)

### Fixed
- **E2E standalone stack skipped migrations** — `tests/docker-compose.e2e-standalone.yml`
  mounted `db/schema.sql` into Postgres's init dir and ran the API/seed containers
  with no migrate step, so a fresh standalone stack never applied `db/migrations/*`
  (e.g. 0003's `blocked_reason`) and half of `npm run test:api` 500'd. `api` and
  `seed` now run `scripts/migrate.js` before starting, matching `docker-compose.yml`.
  (Contributed by @vladmesh.)

## [1.3.1] — 2026-06-26

### Fixed
- **Slow board load for large projects** — listing a project's tasks
  (`GET /api/projects/:id/tasks`) hydrated each task with 4 separate queries, so
  a board with hundreds/thousands of tickets fired thousands of round-trips
  through the connection pool (up to ~a minute to render on the small prod
  instance). Hydration is now **bulk** — a fixed 5 queries regardless of task
  count — grouped in memory. Same API output; ~4–10× faster on the query path
  in local testing, more on resource-constrained hosts. (Rendering very large
  boards client-side and response compression are tracked as follow-ups.)

## [1.3.0] — 2026-06-15

### Added
- **Blocked tickets** — a ticket is *blocked* when it has an unfinished
  task-blocker or a free-text "blocked reason" (it's a derived overlay, not a
  status). What's new:
  - **Manage blockers in the UI** — the ticket detail panel now lets you **add**
    a blocker (search by id/title) and **remove** one, instead of read-only.
  - **Blocked reason** — a free-text field for blocks that aren't another
    ticket (e.g. "waiting on a vendor"), backed by a new `blocked_reason` column.
  - **Board triage** — blocked cards are visually de-emphasised and sink to the
    bottom of their column, plus a **Blocked / Unblocked** filter.
  - **Cycle protection** — adding a dependency that would create a loop
    (A→B→…→A) is rejected with `400`.
  - **Auto-unblock signal** — when a blocker is marked `done`, an "unblocked"
    line is written to the activity feed of anything it was the last blocker for.
  - **Skill verbs** — `kanban block <id> --on <blockerId> | --reason "…"` and
    `kanban unblock <id> [--on <blockerId>]`.

## [1.2.1] — 2026-06-13

### Fixed
- **Deploys now show up without a hard refresh** — nginx served the static
  files (`Kanban.html`, `*.jsx`, `*.js`, `styles.css`) with no `Cache-Control`,
  so browsers heuristically cached the unversioned assets and kept showing the
  old UI after a deploy. nginx now sends `Cache-Control: no-cache`, so browsers
  revalidate against the ETag (a cheap 304 when unchanged) and pick up a new
  release immediately.

## [1.2.0] — 2026-06-12

### Added
- **Passkeys (WebAuthn)** — a human account can enrol one or more passkeys from
  the new **Account** dialog and then sign in passwordlessly ("Sign in with a
  passkey" on the login screen). Backed by `@simplewebauthn/server`, a new
  `webauthn_credentials` table, and stateless challenge handling (the challenge
  rides in a short-lived signed flow token, so the ceremony survives restarts).
  New env vars: `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_RP_NAME` (all
  default from `WEB_ORIGIN`).
- **Change your password** — the Account dialog has a verify-current-then-set
  password form, backed by `POST /api/me/password`.

### Changed
- **Sidebar stays put** — the project list now scrolls within a pinned sidebar
  so the account/settings footer is always reachable, even with a very tall
  board (previously a long board scrolled the whole page and pushed the footer
  far below the fold).

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

[Unreleased]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Adam-Dangerfield/Agent-Kanban/releases/tag/v1.0.0

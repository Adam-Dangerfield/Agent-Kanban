# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

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

[Unreleased]: https://github.com/your-org/kanban/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/kanban/releases/tag/v1.0.0

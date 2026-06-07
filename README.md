# Kanban — Self-Hosted Agent Task Tracker

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

> **Status: working personal tool.** A self-hosted coordination layer between AI
> agents. The frontend is fully interactive; the backend runs on PostgreSQL in
> Docker with real auth (JWT + per-agent tokens) and per-project access control.
> It targets a single manager plus many agents — not multi-tenant SaaS — so read
> the Auth section before exposing it on the public internet.

A self-hosted **kanban / ticketing system** designed for one specific workflow:
AI agents across multiple projects record and update their tasks here via a
cheap REST API; a human reviews the board in one place.

Agents don't need a UI. They need four calls: create a task, claim it, post a
status message, mark it done. This system is optimised for exactly that, while
still rendering a full interactive board for the human reviewer.

---

## Features

- **Projects and boards** — separate project boards switched from a left
  sidebar. Each project has epics, stories, and tasks.
- **Task lifecycle** — Backlog → To Do → In Progress → Done, with drag-and-drop
  column moves. Tasks carry title, description, notes, priority, assignee,
  epic/story grouping, and git branch + merge state
  (`none → dev → pr → merged`).
- **Agent messages** — tasks have a chat-style message thread where agents post
  what they actually did, separate from the description of the work.
- **Activity log** — every state change is appended to an immutable audit trail
  per task.
- **Cross-team requests** — one project can raise a request against another.
  Accepting a request spawns a linked card on the receiving team's board.
- **Shared inbox** — incoming and outgoing cross-team requests in one view.
- **Search and filters** — global text search; filter by assignee, priority,
  epic; sort by priority.
- **Auth & per-project RBAC** — password-protected manager session (JWT) plus
  per-agent API tokens (bcrypt-hashed, shown once at mint time). **Every endpoint
  requires a token.** Access is granted per `(agent, project)` as `read`/`write`;
  agents see only the projects they're granted.
- **Admin panel** — searchable in-app management of agents, per-project
  permissions (pivot by agent or by project), and provisioning tokens.
- **Scoped provisioning** — a root or admin-minted scoped token lets new agents
  self-register and self-grant access up to a ceiling, so a fleet can onboard
  without the manager hand-minting every token.
- **First-run setup** — a fresh instance walks an admin through creating the
  first project before minting agent tokens.
- **File attachments** — attach files (≤ 20 MB) to tasks and requests; local
  disk in dev, S3 with presigned downloads in production.
- **Zero-build frontend** — React 18 via CDN with in-browser Babel. No build
  step; open `Kanban.html` or serve the folder.
- **Docker Compose stack** — nginx (static) + Express API + PostgreSQL in three
  services, ready to run with one command.

---

## Architecture

```
Browser
  └─ nginx (:8080)
       ├─ static files   ← Kanban.html + *.jsx + api.js + styles.css
       └─ /api/* proxy ──► Express API (:4000)
                                └─► PostgreSQL (:5432)
```

- **Frontend**: plain static files. React 18 via CDN; `.jsx` files are
  transpiled by in-browser Babel at load time. No build step required.
  `api.js` is the single file responsible for camelCase ↔ snake_case
  translation between frontend and API — nothing else does translation.
- **API**: Express (`server/`). Runs against an in-memory store when
  `DATABASE_URL` is unset (useful for frontend development without Postgres),
  or against PostgreSQL in production.
- **Database**: PostgreSQL. Schema in `server/db/schema.sql`. Applied
  automatically on first container start via a Docker init-script mount.

---

## Quick Start

### Full stack (Docker Compose — recommended)

```bash
# 1. Build images and start all three services.
#    The schema is applied automatically to a fresh Postgres volume.
docker compose up --build

# 2. Seed sample data (run once; safe to re-run — TRUNCATEs first).
docker compose --profile seed run --rm seed

# 3. Mint a per-agent API token (repeat for each agent).
#    The raw token is printed once — copy it immediately.
docker compose exec api npm run mint-token <agent-id>
#    e.g.  docker compose exec api npm run mint-token claude
```

URLs after `up`:
- Web board: `http://localhost:8080`
- API health: `http://localhost:4000/api/health`

Copy `server/.env.example` to `server/.env` and set at minimum:

```
JWT_SECRET=<long random string>
DATABASE_URL=postgres://kanban:kanban@db:5432/kanban
WEB_ORIGIN=http://localhost:8080
```

### API-only dev (no Docker, in-memory store)

```bash
cd server && npm install && npm run dev
# DATABASE_URL unset → MemoryStore (resets on restart, no Postgres needed)
curl http://localhost:4000/api/health
```

---

## API

All endpoints are under `/api`. All request and response bodies are
snake_case JSON. See [`API_CONTRACT.md`](API_CONTRACT.md) for the full field
maps and auth contract.

```
# open (no token) ------------------------------------------------------
POST   /api/auth/login            { password }            → { ok, actor, token:<JWT> }
POST   /api/auth/token            { token }               → { ok, actor, token:<raw> }
GET    /api/health                                        → { ok, ts }

# identity, agents, permissions, provisioning --------------------------
GET    /api/me                                            → { id, name, role, is_admin, permissions }
GET    /api/agents
POST   /api/agents                { id, name, ... }       → 201 { agent, token }   [admin / provision token]
PATCH  /api/agents/:id            { is_admin?, ... }      → Agent                  [admin]
GET/PUT /api/agents/:id/permissions[/:projectId]                                   [admin / scoped]
POST   /api/provision-tokens      { label, scope:[] }     → 201 { ..., token }     [admin]

# projects / epics / stories (filtered to readable) --------------------
GET    /api/projects
POST   /api/projects              { id, name, key, ... }  → 201 Project            [admin]
GET    /api/projects/:id/epics  ·  POST → 201 Epic        [write on project]
GET    /api/epics/:id/stories   ·  POST → 201 Story       [write on project]

# tasks ----------------------------------------------------------------
GET    /api/projects/:id/tasks   ·  GET /api/tasks/:id
POST   /api/projects/:id/tasks    { title, ... }          → 201 Task
PATCH  /api/tasks/:id             { ...fields, _log? }    → Task
DELETE /api/tasks/:id                                     → 204
POST   /api/tasks/:id/comments    { body }                → 201 Comment

# attachments (multipart, ≤ 20 MB) ------------------------------------
POST   /api/tasks/:id/attachments   ·  POST /api/requests/:id/attachments
GET    /api/attachments/:id      ·  DELETE /api/attachments/:id

# cross-team requests --------------------------------------------------
GET    /api/projects/:id/requests
POST   /api/requests              { to_project_id, ... }  → 201 Request
POST   /api/requests/:id/actions  { action }              → { request, spawnedTask? }
  action ∈ accept | decline | start | done | cancel
```

`_log` on `PATCH` is an optional human-readable string appended to the task's
activity feed (e.g. `"merged feat/x into main"`).

**Every endpoint requires `Authorization: Bearer <token>` except the three open
ones above.** A missing/invalid token → `401`; a valid token without access to
the project → `403`.

---

## Auth

Two credential types, both sent as `Authorization: Bearer <value>`:

- **Manager JWT** — `POST /api/auth/login { password }` → signed JWT (valid 7
  days), used by the web UI. The password is bcrypt-checked; `JWT_SECRET`
  configures signing.
- **Agent raw token** — each agent gets its own token, so every change is
  attributed by name. Minted via `npm run mint-token <agent-id>` (or the admin
  panel). Stored as a bcrypt hash; only the prefix (e.g. `agt_live_9f3c`) is kept
  in plaintext. The raw value is shown **once** at mint time.

**Every endpoint except `/api/health` and the two auth endpoints requires a
valid token — reads included.** Access is then checked per project: `read` and
`write` per `(agent, project)`; admins bypass project checks; new agents start
with no access; `GET /api/projects` is filtered to what the caller can read.
Missing/invalid token → `401`; valid token without project access → `403`.

**Provisioning** (creating agents, minting tokens, granting permissions) uses a
separate `X-Provision-Token` header — either a root token (env `PROVISION_TOKEN`)
or an admin-minted scoped token whose grants are capped to a project ceiling.
Provision tokens can never set `is_admin`. See
[`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) for the onboarding walkthrough.

---

## Using the Kanban skill in an agent project

The `skills/kanban/` directory contains a portable Claude Code skill that gives
any AI agent a dependency-free CLI over the full API.

**Install:** copy `skills/kanban/` into the agent project's `.claude/skills/kanban/`.

**Set two env vars** in the agent's `.env`:

```
KANBAN_URL=http://localhost:4000/api
KANBAN_TOKEN=agt_live_xxxxxxxxxxxx
```

**Use it:**

```bash
node .claude/skills/kanban/scripts/kanban.mjs me
node .claude/skills/kanban/scripts/kanban.mjs tasks aws --status in_progress
node .claude/skills/kanban/scripts/kanban.mjs claim AWS-101
node .claude/skills/kanban/scripts/kanban.mjs comment AWS-101 "PR merged, marking done"
node .claude/skills/kanban/scripts/kanban.mjs status AWS-101 done
```

The skill (`skills/kanban/SKILL.md`) is loaded into agent context automatically
when Claude Code detects it. See `docs/AGENT_GUIDE.md` for the full curl reference
and onboarding walkthrough.

---

## Documentation

| Document | Purpose |
|---|---|
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Using the web board: sign-in, board, tickets, attachments, cross-team requests, filters |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Admin panel: first-run setup, projects, agents, permissions, provision tokens |
| [`API_CONTRACT.md`](API_CONTRACT.md) | Field maps (camelCase ↔ snake_case), full endpoint list, auth contract — the source of truth for backend/frontend alignment |
| [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) | Practical guide for agents using the REST API (curl recipes, onboarding, import walkthrough) |
| [`skills/kanban/SKILL.md`](skills/kanban/SKILL.md) | Portable Claude Code skill — concise instructions + CLI for AI agents |
| [`docs/SPEC-rbac-attachments.md`](docs/SPEC-rbac-attachments.md) | Feature spec: auth matrix, per-project RBAC, attachments, scoped provisioning |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Self-hosting in production: env vars, first deploy, attachments, backups |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Engineering detail: frontend architecture, backend internals, data model |
| [`docs/DESIGN-NOTES.md`](docs/DESIGN-NOTES.md) | The *why*: agent-identity principles and other transferable design choices |
| [`TEST_PLAN.md`](TEST_PLAN.md) | Test-case matrix (API + UI) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Dev setup, project conventions, how to add an endpoint, PR guidance |
| [`SECURITY.md`](SECURITY.md) | Security model, operator hardening checklist, how to report a vulnerability |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

---

## Repo Layout

```
Kanban/
├── Kanban.html            # frontend entry point
├── styles.css             # all component styles
├── data.js                # prototype mock seed data (window.SEED)
├── api.js                 # camelCase↔snake_case + fetch wrapper
├── app.jsx                # app shell, state, auth, all event handlers
├── board.jsx              # board, columns, drag-and-drop
├── detail.jsx             # ticket detail panel (incl. attachments)
├── requests.jsx           # cross-team inbox
├── components.jsx         # shared UI components
├── setup.jsx              # first-run wizard + project creation
├── admin.jsx              # admin panel (agents, permissions, tokens)
├── tweaks-panel.jsx       # in-app layout/theme tweaks
│
├── server/                # Express API
│   ├── src/
│   │   ├── index.js       # all routes
│   │   ├── store.js       # MemoryStore + PgStore
│   │   ├── storage.js     # attachment storage (local disk / S3)
│   │   └── seed-data.js   # seed content
│   ├── scripts/
│   │   ├── seed.js        # load seed data into Postgres
│   │   ├── mint-token.js  # generate a per-agent token
│   │   └── init-prod.js   # clean schema + admin bootstrap (prod)
│   ├── db/schema.sql      # PostgreSQL schema
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
│
├── skills/kanban/         # portable Claude Code skill (SKILL.md + CLI)
├── backup/                # pg_dump → S3 backup sidecar image
├── tests/                 # api.mjs (node:test) + ui.spec.mjs (Playwright)
├── docs/                  # AGENT_GUIDE, SPEC-rbac-attachments
│
├── web.Dockerfile         # nginx image for the frontend
├── nginx.conf             # serves static + proxies /api → api:4000
├── docker-compose.yml     # full stack: db + api + web (+ seed profile)
├── API_CONTRACT.md        # field maps + endpoint list (source of truth)
└── ARCHITECTURE.md        # engineering internals
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0
(AGPLv3)**. See [`LICENSE`](LICENSE) for the full text.

Key obligation: if you run a **modified** version of this software over a
network, you must make the corresponding source code available to the users of
that network service.

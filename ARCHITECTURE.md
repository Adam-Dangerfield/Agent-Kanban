# Kanban — Engineering Internals

A kanban-style ticketing system for coordinating AI agents across multiple
projects. This doc covers the engineering internals — frontend architecture,
backend structure, the data model, and the remaining future work. For the API
field maps and auth contract, see [`API_CONTRACT.md`](API_CONTRACT.md); for how
agents use the API, see [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md).

> **Status:** fully wired end-to-end. The frontend talks to the Express API,
> which runs on PostgreSQL (Docker) with real auth and per-project RBAC. The one
> deliberate prototype-ism that remains is the **zero-build frontend**
> (in-browser Babel) — see [Frontend](#frontend).

---

## TL;DR — run it

```bash
# Whole stack in Docker (web + api + Postgres):
docker compose up --build
# → web:  http://localhost:8080
# → api:  http://localhost:4000/api/health

# Seed sample data (once; TRUNCATEs first):
docker compose --profile seed run --rm seed

# Just the API, no Docker (in-memory store, resets on restart):
cd server && npm install && npm run dev
```

Login: **Manager** tab → the manager password (bcrypt-checked). **Agent token**
tab → a minted `agt_live_…` token.

---

## Frontend

### How it's built
React 18 via CDN with **in-browser Babel** transpilation of the `.jsx` files —
no build step. State lives in React `useState` in `app.jsx`. `data.js` provides
an initial mock seed (`window.SEED`) that is **replaced at runtime** by real API
data once `api.js` loads; the component files read `window.SEED.*` so they pick
up live data without edits.

This is great for a zero-dependency self-hosted tool but is the main thing to
change before any heavy production use — see the Vite path below.

### The camelCase ↔ snake_case seam
`api.js` is the **only** file that translates between the frontend (camelCase)
and the API/DB (snake_case, always). Two pure functions — `fromApi` on reads,
`toApi` on writes — plus per-type field maps. Components stay pure camelCase; the
server stays pure snake_case. Never add translation anywhere else.

### Where state changes happen (handler → API)
All mutations live in `app.jsx` and call `window.API.*` (in `api.js`):

| UI action | Handler in `app.jsx` | API call |
|---|---|---|
| Move card (drag) | `moveTask` | `PATCH /api/tasks/:id { status, _log }` |
| Edit field / priority / assignee | `patch` | `PATCH /api/tasks/:id` |
| Set branch / merge state | `patch` | `PATCH /api/tasks/:id { branch, merge_state, _log }` |
| Post agent message | `addComment` | `POST /api/tasks/:id/comments` |
| Create ticket | `createTask` | `POST /api/projects/:id/tasks` |
| Delete ticket | `deleteTask` | `DELETE /api/tasks/:id` |
| Create project / epic / story | `createProject` / `createEpic` / `createStory` | `POST /api/projects` · `/projects/:id/epics` · `/epics/:id/stories` |
| Raise request | `createRequest` | `POST /api/requests` |
| Act on request | `requestAction` | `POST /api/requests/:id/actions` |
| Upload / delete attachment | `upload*Attachment` / `delete*Attachment` | `POST`/`DELETE /api/.../attachments` |

`setup.jsx` holds the first-run wizard + project-creation modal; `admin.jsx`
holds the admin panel (agents, per-project permissions, provision tokens).

### Future: Vite migration
The in-browser-Babel approach is the one piece to replace for production:
1. `npm create vite@latest web -- --template react`
2. Move the `.jsx` files into `web/src/`; convert the `window.X = …` /
   `Object.assign(window, …)` globals into real ES module `import`/`export`
   (they were globals only to avoid a bundler).
3. `vite build` → static `dist/`; make `web.Dockerfile` a multi-stage build
   (node build → nginx serving `dist/`). The API and data flow don't change.

---

## Backend

`server/` is an Express app (`src/index.js` = all routes). The data store is
env-selected in `src/store.js`:

- **`DATABASE_URL` set → `PgStore`** (PostgreSQL). This is the production path.
- **`DATABASE_URL` unset → `MemoryStore`** (in-memory; resets on restart, not
  concurrency-safe). Convenient for frontend/API development without Postgres.

Both implement the same method surface, and every route `await`s the store, so
the two are interchangeable. Attachment storage is likewise env-selected in
`src/storage.js`: `S3_BUCKET` set → `S3Storage` (presigned downloads), else
`LocalStorage` under `UPLOAD_DIR`.

The schema is **migration-driven**: `server/scripts/migrate.js` runs on api (and
seed) startup, applying the baseline (`db/schema.sql`) then each
`db/migrations/*.sql` not yet recorded in `schema_migrations` — idempotent,
advisory-locked, one transaction per step. This is the update process: a fresh DB
gets the full schema, an existing one gets only the pending migrations (data
preserved). `server/scripts/`: `migrate.js` (runner), `seed.js` (demo data,
TRUNCATEs first), `mint-token.js` (per-agent token), `init-prod.js` (clean prod
bootstrap — migrate + admin upsert from `MANAGER_PASSWORD`, no demo data).

For the full endpoint list and field maps, see [`API_CONTRACT.md`](API_CONTRACT.md)
— it is the source of truth, kept in sync with the routes.

---

## Auth & RBAC

Real, not stubbed:

- **Manager password** — bcrypt hash in `agents.password_hash`, verified on
  `POST /api/auth/login`, which issues a signed **JWT** (`JWT_SECRET`, 7-day
  expiry). Used by the web UI.
- **Agent tokens** — each agent has its own token so changes are attributed by
  name. Only a bcrypt **hash** (`agents.token_hash`) plus a short non-secret
  `token_prefix` (for display) are stored. The raw value is shown **once** at
  mint time.
- **Global gate** — an `auth` middleware runs after the open routes
  (`/api/health`, `/api/auth/login`, `/api/auth/token`); every other endpoint —
  reads included — requires a valid token (401 otherwise).
- **Per-project RBAC** — `agent_permissions(agent_id, project_id, access)` with
  `read`/`write`; `write` implies `read`; admins bypass; new agents have no
  access; `GET /api/projects` is filtered to readable projects (403 otherwise).
- **Scoped provisioning** — a separate `X-Provision-Token` header (root env
  token or admin-minted scoped token in `provision_tokens`) authorises agent
  creation + capped self-grants; it can never set `is_admin`.
- **CORS** is locked to `WEB_ORIGIN`; the public auth endpoints are
  rate-limited per IP (`express-rate-limit`, `AUTH_RATE_MAX`).

The seed tokens in `seed-data.js` end in `REPLACE_ME` and the seed manager
password is `changeme` — both for local dev only; real secrets come from env
(`JWT_SECRET`, `MANAGER_PASSWORD`, `PROVISION_TOKEN`).

---

## Data model (Postgres)

See `server/db/schema.sql`. Key points:

- **tasks** carry `project_id` directly *and* an optional `story_id`. Normal
  tickets reach their project via the story → epic chain; **spawned cross-team
  cards** set `project_id` directly with `story_id = NULL` (and
  `from_request_id` pointing at the originating request). `created_at` /
  `updated_at` are honoured on create when supplied (so imports keep real dates).
- **projects / epics / stories** — all accept a client-supplied `id` on create,
  so external tracker IDs can be preserved on import.
- **comments** = agent messages; **activity** = append-only audit log shared by
  tasks and requests (discriminated by `entity_type`).
- **task_deps** is the blocked-by graph (`task_id` is blocked by `depends_on`).
- **requests** link `linked_task_id` (the ticket being unblocked) and
  `spawned_task_id` (the card created on accept).
- **agent_permissions** = per-(agent, project) RBAC; **attachments** = files on
  tasks/requests (metadata; bytes in local disk or S3); **provision_tokens** =
  scoped onboarding tokens.

---

## Future work

1. **Vite migration** of the frontend (above) — removes the in-browser-Babel
   dev warning and the CDN dependency.
2. **WebSockets / SSE** for live board updates — the activity log is already
   structured for it.
3. **RFC process** for API breaking changes once other agents depend on it.

---

## Notes / known gaps

- In-browser Babel prints a dev warning in the console — harmless; goes away
  with the Vite migration.
- `MemoryStore` is **dev-only**: not concurrency-safe and resets on restart. Any
  real deployment must set `DATABASE_URL` to use `PgStore`.
- Schema changes are applied by the migration runner on startup (see above), so
  updating is just rebuild + restart — no `down -v`. Add a change as a new
  `server/db/migrations/NNNN_*.sql`.

# Kanban API Contract (internal build spec)

> **This file is the shared source of truth for the backend and frontend work.**
> It exists so the API and the UI agree on field names. The single hardest part
> of this job is that the **frontend speaks camelCase** and the **API/DB speak
> snake_case**. The rule below makes that a non-issue if both sides obey it.

## The golden rule

- The **API and database are snake_case, always.** Every JSON body the API
  accepts and every JSON body it returns uses the snake_case field names in the
  tables below. The backend never emits camelCase.
- The **frontend stays camelCase internally.** `app.jsx` and all components keep
  reading `task.storyId`, `req.fromProject`, etc. — unchanged.
- **`api.js` is the only place the two meet.** It owns two pure functions,
  `fromApi(obj)` (snake → camel, applied to everything read from the API) and
  `toApi(obj)` (camel → snake, applied to everything sent to the API). No
  translation logic lives anywhere else.

This means: backend agent, ignore camelCase entirely. Frontend agent, do the
translation in `api.js` and leave component field names alone.

---

## Authorization

### Token requirement

**Every endpoint requires a valid token** except `GET /api/health`,
`POST /api/auth/login`, and `POST /api/auth/token`. A missing or invalid token
returns `401 Unauthorized`. A valid token that lacks permission for the
requested resource returns `403 Forbidden`.

The two public auth endpoints (`/api/auth/login`, `/api/auth/token`) are
**rate-limited per IP** (default 10 attempts / 15 min → `429`) to throttle
brute-force; tunable via `AUTH_RATE_MAX` (lenient in dev/test, strict in prod).
Token-gated data routes are not rate-limited.

Two token types share the same `Authorization: Bearer <token>` header:
- **Manager JWT** — returned by `POST /api/auth/login`. Used by the web UI.
- **Agent raw token** — minted at provisioning time. Used by agents for all
  day-to-day calls (reads and writes).

A third token type uses a separate header:
- **Provision token** — sent as `X-Provision-Token: <value>`. Used only for
  agent registration and token rotation. Does **not** substitute for a Bearer
  token on data routes.

### Per-project RBAC

Access is controlled per `(agent, project)` pair. Each agent has, for each
project, one of:

| Level | Grants |
|---|---|
| absent (default) | no access — the project is hidden from `GET /api/projects` |
| `read` | read all project data (tasks, epics, stories, requests) |
| `write` | read + create/update/delete tasks, post comments, upload/delete attachments, raise/act on requests |

`write` implies `read`. Admins (`agents.is_admin = true`, or the manager `adam`)
bypass all project checks and have full control. New agents start with **no
access**; an admin grants it, or the agent self-grants via a provision token
up to the token's scope.

### Provision token scope

The root `PROVISION_TOKEN` (env var) has unlimited scope. Admin-minted scoped
tokens (rows in `provision_tokens`) carry a `scope` array of
`{project_id, max_access}` entries that cap what the holder can grant. A
provision token can never set `is_admin` or grant access to projects outside
its scope.

---

## Field maps

### Task  (DB table `tasks` + hydrated `comments`/`activity`/`deps`/`attachments`)
| Frontend (camel) | API/DB (snake) | Notes |
|---|---|---|
| `id` | `id` | e.g. `AWS-101` |
| `projectId` | `project_id` | set directly for spawned cards; otherwise derived via story→epic |
| `storyId` | `story_id` | null for spawned cross-team cards |
| `title` | `title` | |
| `desc` | `description` | **name change, not just casing** |
| `notes` | `notes` | |
| `status` | `status` | `backlog\|todo\|in_progress\|done` |
| `priority` | `priority` | `critical\|high\|medium\|low` |
| `assignee` | `assignee_id` | **name change** |
| `branch` | `branch` | |
| `mergeState` | `merge_state` | `none\|dev\|pr\|merged` |
| `fromRequestId` | `from_request_id` | |
| `deps` | `deps` | array of task ids (blocked-by) |
| `comments` | `comments` | array; see Comment |
| `activity` | `activity` | array; see Activity |
| `attachments` | `attachments` | array; see Attachment — hydrated on all task GETs |

### Comment (agent message)
| Frontend | API/DB | Notes |
|---|---|---|
| `who` | `author_id` | **name change** |
| `text` | `body` | **name change** |
| `ts` | `created_at` | **name change** |

### Activity (append-only log entry)
| Frontend | API/DB | Notes |
|---|---|---|
| `ts` | `created_at` | |
| `who` | `actor_id` | |
| `text` | `text` | |

### Request (cross-team)
| Frontend | API/DB | Notes |
|---|---|---|
| `id` | `id` | e.g. `REQ-101` |
| `fromProject` | `from_project_id` | |
| `toProject` | `to_project_id` | |
| `title` | `title` | |
| `desc` | `description` | |
| `priority` | `priority` | |
| `requestedBy` | `requested_by` | |
| `assignee` | `assignee_id` | |
| `linkedTaskId` | `linked_task_id` | the ticket it unblocks |
| `spawnedTaskId` | `spawned_task_id` | card created on accept |
| `status` | `status` | `incoming\|accepted\|in_progress\|done\|declined` |
| `createdAt` | `created_at` | |
| `activity` | `activity` | array |
| `attachments` | `attachments` | array; see Attachment — hydrated on all request GETs |

### Attachment (on tasks or requests)
| Frontend (camel) | API/DB (snake) | Notes |
|---|---|---|
| `id` | `id` | integer |
| `entityType` | `entity_type` | `'task'` or `'request'` |
| `entityId` | `entity_id` | id of the parent task or request |
| `filename` | `filename` | original filename |
| `contentType` | `content_type` | MIME type (may be null) |
| `sizeBytes` | `size_bytes` | file size in bytes |
| `uploadedBy` | `uploaded_by` | agent id of uploader (may be null) |
| `createdAt` | `created_at` | ISO timestamp |

Note: `storage_key` is internal only and is never exposed to clients.

### Permission (per-agent, per-project)
| Frontend (camel) | API/DB (snake) | Notes |
|---|---|---|
| `projectId` | `project_id` | |
| `access` | `access` | `'read'` or `'write'` |

### Me (`GET /api/me` response)
| Frontend (camel) | API/DB (snake) | Notes |
|---|---|---|
| `id` | `id` | |
| `name` | `name` | |
| `role` | `role` | |
| `isAdmin` | `is_admin` | boolean |
| `permissions` | `permissions` | array of Permission |

### ProvisionToken
| Frontend (camel) | API/DB (snake) | Notes |
|---|---|---|
| `id` | `id` | integer |
| `label` | `label` | human name |
| `tokenPrefix` | `token_prefix` | 13-char display prefix |
| `maxAccess` | `max_access` | per scope entry: `'read'` or `'write'` |
| `scope` | `scope` | `[{project_id, max_access}]` |
| `createdAt` | `created_at` | ISO timestamp |

### Epic / Story / Project / Agent
| Entity | Frontend | API/DB |
|---|---|---|
| Epic | `id`, `projectId`, `title` | `id`, `project_id`, `title` |
| Story | `id`, `epicId`, `title` | `id`, `epic_id`, `title` |
| Project | `id`, `name`, `key`, `color`, `desc` | `id`, `name`, `key`, `color`, `description` |
| Agent | `id`, `name`, `kind`, `role`, `color`, `initials`, `isAdmin`, `token` (prefix only) | `id`, `name`, `kind`, `role`, `color`, `initials`, `is_admin`, `token_prefix` |

> The `fromApi`/`toApi` translator is generic key-renaming by these maps; nested
> `comments`/`activity`/`attachments` arrays are translated element-wise. Static
> UI config (`window.COLUMNS`, `window.PRIORITIES`, `window.MERGE_STATES`,
> `window.REQUEST_STATES`) stays client-side in `data.js` — it is **not** fetched.

---

## Endpoints (all under `/api`, all snake_case JSON)

Endpoints marked **[open]** do not require a token. All others require
`Authorization: Bearer <token>`. Provision-token endpoints additionally accept or
require `X-Provision-Token: <value>` as noted.

```
# ---- Auth (open) -------------------------------------------------------
POST   /api/auth/login            { password }          -> { ok, actor:{id,name,role}, token:<JWT> }
POST   /api/auth/token            { token }             -> { ok, actor:{id,name,role}, token:<raw> }

# ---- Passkey sign-in (open; WebAuthn) ----------------------------------
POST   /api/webauthn/authenticate/options               -> { options, flow }   [open]
POST   /api/webauthn/authenticate/verify  { flow, response }
                                                        -> { ok, actor, token:<JWT> } [open]

# ---- Identity ----------------------------------------------------------
GET    /api/me                                          -> { id, name, role, is_admin,
                                                            permissions:[{project_id,access}] }
POST   /api/me/password  { current_password, new_password }  -> { ok }   [bearer; verifies current]

# ---- Passkeys (enrol + manage; bearer) ---------------------------------
POST   /api/webauthn/register/options                   -> { options, flow }
POST   /api/webauthn/register/verify  { flow, response, label? }  -> 201 { ok, credential:{id} }
GET    /api/webauthn/credentials                        -> [{ id, device_label, created_at,
                                                            last_used_at, transports }]
DELETE /api/webauthn/credentials/:id                    -> 204   (only your own)

# ---- Agents ------------------------------------------------------------
GET    /api/agents                                      -> [Agent]            (no secrets)
POST   /api/agents   { id, name, role?, color?,         -> 201 { agent, token }
                       initials?, grants?:[{project_id,    [admin OR X-Provision-Token;
                       access}], is_admin? }               grants capped by token scope]
POST   /api/agents/:id/token                            -> { id, token, token_prefix }
                                                           [admin OR X-Provision-Token]
PATCH  /api/agents/:id  { is_admin?, name?, role? }     -> Agent              [admin only]

# ---- Permissions -------------------------------------------------------
GET    /api/agents/:id/permissions                      -> { agent_id, is_admin,
                                                            permissions:[{project_id,access}] }
                                                           [admin or the agent itself]
PUT    /api/agents/:id/permissions/:projectId           -> { agent_id, permissions }
       { access: 'read'|'write'|'none' }                   [admin OR X-Provision-Token
                                                            (access ≤ token scope)]

# ---- Provision tokens (admin only) -------------------------------------
POST   /api/provision-tokens                            -> 201 { id, label, token_prefix,
       { label, scope:[{project_id, max_access}] }          scope, created_at, token }
                                                           (token shown once)
GET    /api/provision-tokens                            -> [{ id, label, token_prefix,
                                                            scope, created_at }]
DELETE /api/provision-tokens/:id                        -> 204

# ---- Projects (filtered to readable) -----------------------------------
GET    /api/projects                                    -> [Project]  (admin → all;
                                                            others → readable only)
POST   /api/projects  { id, name, key, color?, description? }  -> 201 Project   [admin or root X-Provision-Token]
                                                            (id: ^[a-z0-9][a-z0-9-]*$ ; key: ^[A-Z0-9]{1,8}$ ;
                                                             409 on duplicate id/key)
GET    /api/projects/:id/epics                          -> [Epic]
POST   /api/projects/:id/epics  { id, title }           -> 201 Epic    [write on project]
                                                            (id: ^[A-Za-z0-9][A-Za-z0-9._-]*$ ; 409 on dup id)
GET    /api/epics/:id/stories                           -> [Story]
POST   /api/epics/:id/stories   { id, title }           -> 201 Story   [write on the epic's project]
                                                            (id: ^[A-Za-z0-9][A-Za-z0-9._-]*$ ; 409 on dup id)

# ---- Tasks -------------------------------------------------------------
GET    /api/projects/:id/tasks                          -> [Task]   (hydrated, incl. attachments[])
GET    /api/tasks/:id                                   -> Task     (hydrated, incl. attachments[]) | 404
POST   /api/projects/:id/tasks    { title, ... }        -> 201 Task
       (optional id, story_id, created_at, updated_at — created_at/updated_at
        are honoured when supplied so historical imports keep real dates;
        else stamped now())
POST   /api/projects/:id/tasks/bulk  { tasks:[ {title,...}, ... ] }
                                                        -> 201 { created:[id], skipped:[id], errors:[{ref,error}] }
       (one transaction; ≤500 tasks/request; each task takes the same optional
        fields as the single create. Idempotent: a task whose explicit id
        already exists is skipped (not an error). A row that fails (e.g. missing
        title) is isolated via SAVEPOINT and reported in errors; the rest commit.
        Use this for tracker imports / bulk ops — far higher throughput than
        N single POSTs, which each pay an auth + multi-query cost.)
PATCH  /api/tasks/:id             { ...fields, _log? }  -> Task | 404
DELETE /api/tasks/:id                                   -> 204
POST   /api/tasks/:id/comments    { body }              -> 201 Comment

# ---- Attachments -------------------------------------------------------
POST   /api/tasks/:id/attachments                       -> 201 Attachment
       (multipart/form-data, field name "file", max 20 MB)
POST   /api/requests/:id/attachments                    -> 201 Attachment
       (multipart/form-data, field name "file", max 20 MB)
GET    /api/attachments/:id                             -> 200 file bytes (local disk)
                                                           | 302 presigned S3 URL (prod)
DELETE /api/attachments/:id                             -> 204

# ---- Cross-team requests -----------------------------------------------
GET    /api/projects/:id/requests                       -> [Request]  (hydrated, incl. attachments[])
POST   /api/requests              { to_project_id, ... }-> 201 Request
POST   /api/requests/:id/actions  { action }            -> { request, spawnedTask? }
   action ∈ accept | decline | start | done | cancel ; 'accept' spawns a card

# ---- Health (open) -----------------------------------------------------
GET    /api/health                                      -> { ok, ts }
```

`_log` on PATCH is an optional human string appended to the task's activity feed.

Exceeding the 20 MB file size limit returns `413 { error: 'file too large (max 20MB)' }`.

## Auth contract (what both sides assume)
- **Login** returns a signed JWT in `token`. Frontend stores it and sends
  `Authorization: Bearer <jwt>` on every call (reads included).
- **Agent token** auth: the frontend sends `Authorization: Bearer <raw-token>`.
  The backend resolves the agent by `token_prefix` then `bcrypt.compare`s the
  rest. Both JWT and raw agent tokens are accepted by the same middleware.
- **All routes after the open trio require auth.** Missing/invalid credentials → 401.
  Valid credentials without permission → 403.
- **`GET /api/projects`** is filtered server-side to projects the caller can read.
  An agent with no permissions receives an empty array.
- **Attachment downloads** (`GET /api/attachments/:id`) require a token even
  though they return binary data; the server checks read permission on the parent
  entity's project before serving or redirecting.
- **Provision token (`X-Provision-Token`)** is a separate credential for
  provisioning operations only. It is not a substitute for a Bearer token on
  data routes. A request with only a provision token (no Bearer) is admitted
  only for provisioning endpoints; data routes see no actor and return 403 or
  empty results.

## Env (names both sides rely on)
```
PORT=4000
DATABASE_URL=postgres://kanban:kanban@db:5432/kanban   # unset -> in-memory store
JWT_SECRET=<long random>
WEB_ORIGIN=http://localhost:8080
PROVISION_TOKEN=<root provision token>                 # full-scope; never grants admin
UPLOAD_DIR=/data/uploads                               # local storage dir (Docker volume)
S3_BUCKET=                                             # set in prod → switches storage to S3
AWS_REGION=                                            # S3 only
```

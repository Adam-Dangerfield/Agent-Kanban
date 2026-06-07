# Build Spec — Attachments, Global Auth, RBAC, Scoped Provisioning

Internal build contract. Backend + frontend code against this; it is the source of
truth for the new subsystems. Field-name rules from `API_CONTRACT.md` still hold
(API/DB snake_case; frontend camelCase; `api.js` is the only translator).

## Decisions (locked)
- **Attachments** on **tasks AND requests**. 20 MB hard cap. Any file type.
- **Storage** is env-selected (like the data store): `S3_BUCKET` set → S3 (presigned
  download); unset → local disk at `UPLOAD_DIR` (default `/data/uploads`, a Docker volume).
- **Every endpoint requires a valid token** except `GET /api/health`,
  `POST /api/auth/login`, `POST /api/auth/token`.
- **RBAC**: per-project access grid. Each agent has, per project, access ∈
  `read | write` (write implies read); absence = no access. Plus `agents.is_admin`
  (full control + admin panel). Manager `adam` is admin.
- **New agents default to NO access**; an admin grants it, OR the agent self-grants
  using a provision token, capped by that token's scope.
- **Scoped provisioning**: a provision token carries a permission ceiling. An agent
  holding it can register itself and grant itself permissions UP TO the token's scope.
  Provision tokens can NEVER grant admin or create admins.

---

## Schema additions (`server/db/schema.sql`)
Schema is init-only (fresh volume); integrator recreates the volume. Add:

```sql
-- agents: admin flag
ALTER ... -- in the CREATE TABLE agents, add:
  is_admin BOOLEAN NOT NULL DEFAULT false

-- access level
CREATE TYPE access_level AS ENUM ('read','write');   -- guard with the DO/EXCEPTION idiom

-- per-(agent,project) access. Absence = no access.
CREATE TABLE agent_permissions (
  agent_id   TEXT NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  access     access_level NOT NULL,
  PRIMARY KEY (agent_id, project_id)
);

-- attachments on tasks or requests (entity_type discriminates)
CREATE TABLE attachments (
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
CREATE INDEX idx_attachments_entity ON attachments(entity_type, entity_id);

-- scoped provision tokens (admin-minted). Root token comes from env, not here.
CREATE TABLE provision_tokens (
  id           BIGSERIAL PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  token_prefix TEXT NOT NULL,                 -- 13-char display prefix
  scope        JSONB NOT NULL DEFAULT '[]',   -- [{ "project_id": "...", "max_access": "read|write" }]
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Seed changes (`seed-data.js` + `seed.js`)
- `adam`: `is_admin = true`.
- Seeded agents `claude, atlas, nova, scout`: grant `write` on all 3 projects (keeps the
  demo board usable and existing tests valid). New agents created later get nothing by default.
- No seeded provision tokens (root env token covers dev).

---

## Roles, permissions, provision-token scope

- **Admin** (`is_admin` true, or manager JWT for `adam`): bypasses all project checks;
  only role that can read/set `is_admin`, manage any permissions, and mint provision tokens.
- **Agent**: access governed by `agent_permissions`. `write` ⇒ may also read.
- **Provision token** (sent as header `X-Provision-Token`):
  - **Root**: equals env `PROVISION_TOKEN`. Scope = unlimited (any project up to `write`).
    Never admin. For dev/bootstrap/Adam.
  - **Scoped**: a row in `provision_tokens`; resolved by 13-char prefix + bcrypt.
    Scope caps what it can grant.
  - A provision token authorises: create agent, (re)mint agent token, and **grant
    permissions to an agent capped at its scope** (root = uncapped). A new agent holding
    the token may target ITS OWN id to self-configure.

---

## Authorization matrix
`actor` = authenticated identity (agent id, with is_admin). `canRead(p)/canWrite(p)` =
admin OR the agent has read/write on project `p`. Helpers live server-side.

| Endpoint | Rule |
|---|---|
| `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/token` | open |
| `GET /api/me` | any valid token → returns `{id,name,role,is_admin,permissions:[{project_id,access}]}` |
| `GET /api/agents` | any valid token (no secrets) |
| `GET /api/projects` | any valid token; **filtered** to readable projects (admin → all) |
| `GET /api/projects/:id/(epics\|tasks\|requests)` | `canRead(:id)` |
| `GET /api/epics/:id/stories` | `canRead(epic→project)` |
| `GET /api/tasks/:id` | `canRead(task.project)` |
| `POST /api/projects/:id/tasks`, `PATCH/DELETE /api/tasks/:id`, `POST /api/tasks/:id/comments` | `canWrite(project)` |
| `POST /api/requests` | `canWrite(from_project_id)` |
| `GET .../requests`, request visible | `canRead(from) OR canRead(to)` |
| `POST /api/requests/:id/actions` | accept/decline/start/done → `canWrite(to_project)`; cancel → `canWrite(from_project)` |
| `POST /api/tasks/:id/attachments` | `canWrite(task.project)` |
| `POST /api/requests/:id/attachments` | `canWrite(from) OR canWrite(to)` |
| `GET /api/attachments/:id` | `canRead(parent entity's project)` |
| `DELETE /api/attachments/:id` | `canWrite(parent project)` OR uploader OR admin |
| `POST /api/agents`, `POST /api/agents/:id/token` | admin OR valid provision token |
| `PUT /api/agents/:id/permissions/:projectId` | admin (any access) OR provision token (access ≤ token scope for that project) |
| `PATCH /api/agents/:id` (is_admin/name/role) | admin only |
| `GET /api/agents/:id/permissions` | admin, or the agent itself |
| `POST /api/provision-tokens`, `GET /api/provision-tokens`, `DELETE /api/provision-tokens/:id` | admin only |

On any failure: 401 if no/invalid token; 403 if authenticated but not permitted.

---

## Storage interface (`server/src/storage.js`)
Export `storage` chosen by env (`S3_BUCKET` set → S3, else Local).
```
put(key, buffer, contentType) -> Promise<void>
getUrl(key, filename)         -> Promise<string|null>   // presigned (S3) | null (local)
getStream(key)                -> ReadableStream          // local only
delete(key)                   -> Promise<void>
```
- **Local**: files under `UPLOAD_DIR`; `key` is a path-safe id; `getUrl` returns null.
- **S3** (`@aws-sdk/client-s3` + `s3-request-presigner`): `put`=PutObject; `getUrl`=presigned
  GET (5 min, `ResponseContentDisposition: attachment; filename="..."`); `getStream` unused.
- **Download route**: `const url = await storage.getUrl(key, filename)`; if url → `res.redirect(url)`;
  else set `Content-Type` + `Content-Disposition: attachment` and pipe `getStream(key)`.
- **Key scheme**: `${entityType}/${entityId}/${crypto.randomUUID()}-${safeFilename}`.
- **Upload**: `multer` memoryStorage, `limits:{fileSize: 20*1024*1024}`, field name `file`.
  On limit exceed multer errors → return 413 `{error:'file too large (max 20MB)'}`.

---

## Endpoints (new) — request/response (snake_case)

```
GET    /api/me                         -> { id, name, role, is_admin, permissions:[{project_id, access}] }

# attachments (multipart field "file")
POST   /api/tasks/:id/attachments      -> 201 Attachment
POST   /api/requests/:id/attachments   -> 201 Attachment
GET    /api/attachments/:id            -> 200 file bytes (local) | 302 presigned (S3)
DELETE /api/attachments/:id            -> 204
# tasks & requests now hydrate an `attachments: [Attachment]` array

# permissions
GET    /api/agents/:id/permissions     -> { agent_id, is_admin, permissions:[{project_id, access}] }
PUT    /api/agents/:id/permissions/:projectId  { access:'read'|'write'|'none' } -> updated permission list
PATCH  /api/agents/:id                 { is_admin?, name?, role? } -> agent           [admin]

# provisioning
POST   /api/agents   { id, name, role?, color?, initials?, grants?:[{project_id,access}] }
                                        -> 201 { agent, token }   [admin or X-Provision-Token; grants capped by token scope]
POST   /api/agents/:id/token           -> { id, token }          [admin or X-Provision-Token]

# scoped provision tokens (admin)
POST   /api/provision-tokens  { label, scope:[{project_id, max_access}] } -> 201 { id, label, scope, token }  (token once)
GET    /api/provision-tokens           -> [{ id, label, token_prefix, scope, created_at }]   (no hashes)
DELETE /api/provision-tokens/:id       -> 204
```

Attachment object: `{ id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at }`.

### Field maps to add to `api.js`
Attachment: `entityType↔entity_type`, `contentType↔content_type`, `sizeBytes↔size_bytes`,
`uploadedBy↔uploaded_by`, `createdAt↔created_at` (id/filename pass through).
Permission: `projectId↔project_id` (access passes through). `/me`: `isAdmin↔is_admin`.
ProvisionToken: `tokenPrefix↔token_prefix`, `maxAccess↔max_access`, `createdAt↔created_at`.

---

## Frontend requirements
- **api.js**: already sends the bearer token on all calls — keep. Add methods:
  `me()`, `uploadTaskAttachment(taskId, file)`, `uploadRequestAttachment(reqId, file)`,
  `downloadAttachment(id)` (fetch WITH auth header → returns Blob; UI makes an object URL and
  triggers save — a plain `<a href>` will NOT work because download needs the token),
  `deleteAttachment(id)`, `getPermissions(agentId)`, `setPermission(agentId, projectId, access)`,
  `patchAgent(agentId, fields)`, provisioning + provision-token methods. Multipart upload uses
  `FormData` (do NOT set Content-Type; let the browser set the boundary) and still attaches the
  bearer header.
- **Auth/me**: after login, call `me()` and keep `{is_admin, permissions}` in app state.
- **Detail panel** (`detail.jsx`): an **Attachments** section — list (filename, human size,
  download, delete), an upload control (client-side 20 MB pre-check; server enforces).
- **Inbox/RequestCard** (`requests.jsx`): attachments on requests (list + download + upload).
- **Admin panel** (new, gated to `is_admin`): reachable from the sidebar/whoami menu. Contains:
  (a) **Agents** list with admin badges; **Provision agent** form (id, name, role, optional
  initial grants) → on success show the raw token ONCE with a copy affordance;
  (b) **Permissions grid**: agents × projects, each cell a `none/read/write` control → `setPermission`;
  optional `is_admin` toggle (`patchAgent`); (c) **Provision tokens**: list + create (label + scope
  picker) showing the raw token once + revoke.
- **Permission-aware UI**: the project sidebar shows only readable projects (the filtered
  `GET /projects` already does this); hide/disable write actions (New, move, delete, upload) when
  the actor lacks write on the current project (use `/me` permissions). Server enforces regardless.
- Keep all existing behaviour, components, and the camelCase field access intact.

## Env (add)
```
UPLOAD_DIR=/data/uploads          # local storage dir (Docker volume)
S3_BUCKET=                        # set in prod → switches storage to S3
AWS_REGION=                       # S3 only
# PROVISION_TOKEN already exists (now treated as the root, full-scope provision token)
```

## Deps (add to server/package.json dependencies)
`multer` (^1.4.5-lts.1), `@aws-sdk/client-s3` (^3), `@aws-sdk/s3-request-presigner` (^3).

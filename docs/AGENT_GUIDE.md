# Agent Guide: Using the Shared Kanban API

This guide is for AI agents (and the humans onboarding them) that need to record
tasks and status on the shared Kanban board. The board is the single place where
Adam can review what every agent across every project is doing — without parsing
markdown files or reading logs.

---

## Using the kanban skill (recommended for agents)

The `skills/kanban/` directory in this repo contains a portable Claude Code skill
that wraps the entire API in a single dependency-free CLI. Instead of hand-writing
curl, agents run:

```bash
node .claude/skills/kanban/scripts/kanban.mjs tasks aws
node .claude/skills/kanban/scripts/kanban.mjs claim AWS-101
node .claude/skills/kanban/scripts/kanban.mjs comment AWS-101 "work complete"
```

**Install:** copy `skills/kanban/` into the agent project's `.claude/skills/kanban/`.

**Configure:** add two env vars to the agent's `.env`:

```
KANBAN_URL=http://localhost:4000/api
KANBAN_TOKEN=agt_live_xxxxxxxxxxxx
```

The skill file (`skills/kanban/SKILL.md`) contains concise operational instructions
for AI agents, including self-onboarding, all subcommand examples, conventions, and
token hygiene rules. The raw curl recipes below remain the authoritative reference.

**Admin operations:** The skill also exposes a full set of admin subcommands (`agents`, `perms`, `grant`, `set-admin`, `provision`, `rotate`, `tokens`, `token-create`, `token-revoke`) that work when `KANBAN_TOKEN` belongs to an agent whose `is_admin` flag is `true`. An admin agent token behaves identically to Adam's manager JWT for all admin-gated endpoints. An agent becomes admin when an existing admin runs `kanban set-admin <id> true` (or Adam uses the web admin panel toggle); provision tokens cannot self-escalate to admin. See the **"Admin operations"** section in `skills/kanban/SKILL.md` for the full command reference.

**Why REST, not markdown?**
Each API call is cheap (one round-trip), attributable (the token identifies the
caller), and queryable (filter by project, assignee, or status). Markdown files
require a reader to parse and correlate. The board turns agent work into a live,
searchable record that scales across many projects without any reader overhead.

---

## Table of contents

1. [The token model — how attribution works](#1-the-token-model--how-attribution-works)
2. [Permissions — what you can see and do](#2-permissions--what-you-can-see-and-do)
3. [Onboarding a new agent](#3-onboarding-a-new-agent)
4. [Authenticating as an agent](#4-authenticating-as-an-agent)
5. [Daily agent operations](#5-daily-agent-operations)
6. [Attachments](#6-attachments)
7. [Cross-team requests](#7-cross-team-requests)
8. [Attribution in practice](#8-attribution-in-practice)
9. [Token hygiene](#9-token-hygiene)
10. [Endpoint reference](#10-endpoint-reference)
11. [Enum values](#11-enum-values)

---

## 1. The token model — how attribution works

Every action on the board is attributed to a named agent. Attribution works because
**each agent has its own API token**. When the server receives a request it looks
up the token and sets the actor to that agent's id. Every status change, comment,
and activity log line is stamped with that actor.

**Every endpoint requires a token** (the only exceptions are `GET /api/health`,
`POST /api/auth/login`, and `POST /api/auth/token`). This includes all read
endpoints — there is no anonymous access to board data.

Three credential types exist:

| Credential | Who holds it | What it is used for |
|---|---|---|
| `PROVISION_TOKEN` (root) | Human (Adam) | Registering new agents, rotating their tokens, and granting project access; never used for board data |
| Scoped provision token | Minted by Adam for a specific agent bootstrap | Same provisioning operations as root, but capped to listed projects and access levels |
| Agent bearer token | Each agent's own `.env` | All calls: reading tasks, creating tickets, updating status, posting comments, uploading attachments |
| Manager JWT | Adam (via browser login) | Web UI access; returned by `POST /api/auth/login` |

The **provision token is not an agent token**. It cannot read or create tasks.
It exists solely to mint agents and grant them project permissions. Once an agent
has its bearer token and permissions, the provision token plays no further role.

The **manager JWT** is for humans using the web UI. Agents do not need it.

Same repo, new agent = new token. There is no shared agent credential.

---

## 2. Permissions — what you can see and do

Access is per-project. An agent can hold one of three states for each project:

| State | Effect |
|---|---|
| absent (default) | The project does not appear in `GET /api/projects`; all project-scoped endpoints return 403 |
| `read` | Can list tasks, epics, stories, and requests for the project; can download attachments |
| `write` | Everything read allows, plus: create/update/delete tasks, create epics and stories, post comments, upload/delete attachments, raise and act on requests |

New agents have **no access to any project** until explicitly granted.

### Checking your own permissions

```bash
curl -s "http://localhost:4000/api/me" \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{
  "id":         "nova",
  "name":       "Nova",
  "role":       "Frontend agent",
  "is_admin":   false,
  "permissions": [
    { "project_id": "aws",    "access": "write" },
    { "project_id": "mobile", "access": "read"  }
  ]
}
```

`GET /api/projects` returns only the projects you can read — if the list is
empty, you have no permissions yet.

### How permissions are granted

An admin (or Adam via the web UI) grants you access:

```bash
# Admin grants nova write access on the aws project
curl -s -X PUT "http://localhost:4000/api/agents/nova/permissions/aws" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access": "write"}'
```

Or, if you hold a scoped provision token that covers the project, you can
self-grant up to the token's ceiling (see §3 below).

---

## 3. Onboarding a new agent

> **Three rules that prevent permanent attribution mess — read first:**
>
> 1. **Read your identity from the environment; never hardcode it.** Your id,
>    name, role, colour, initials, token, and default project come from env vars
>    (e.g. `KANBAN_AGENT_ID`, `KANBAN_AGENT_NAME`, `KANBAN_TOKEN`, `KANBAN_PROJECT`).
>    A name baked into code or a shared doc guarantees a mis-attributed board.
> 2. **Don't re-register if you already have a working token.** If `KANBAN_TOKEN`
>    is set and `GET /me` succeeds, that token *is* your live identity — just use
>    it. Run the onboarding flow below **only** when the token is missing or no
>    longer authenticates (e.g. the board's database was rebuilt).
> 3. **Record who you are in your own per-agent memory, not in a shared doc.**
>    After you mint your token, save a short "I am _X_ on the board" note (id,
>    name, role, when/why registered) to your project's per-agent memory so future
>    sessions start knowing their name. **Never** write a specific agent's identity
>    into a collective/shared doc — every other agent reading it would assume that
>    name is theirs.

### Path A — Admin registers you (no provision token needed)

An admin registers the agent and grants permissions directly. The agent receives
its bearer token and the project access it needs.

### Path B — Self-onboarding with a scoped provision token

If Adam has minted a scoped provision token for you (passed via a secure channel),
you can self-register **and** self-grant permissions — without needing any admin
session. The token's scope caps what you can grant yourself.

> **LOCAL DEV NOTE:** The examples below use `dev-provision-token` as the
> provision token. In production this is replaced by a long random secret set
> via the `PROVISION_TOKEN` environment variable on the server. A scoped token
> looks like `ptk_<24 hex chars>`.

#### Step 1 — Register yourself and mint your bearer token

```bash
curl -s -X POST http://localhost:4000/api/agents \
  -H "Content-Type: application/json" \
  -H "X-Provision-Token: $PROVISION_TOKEN" \
  -d '{
    "id":       "nova",
    "name":     "Nova",
    "role":     "Frontend agent",
    "color":    "#2A6FB5",
    "initials": "NV"
  }'
```

You may optionally include `"grants":[{"project_id":"aws","access":"write"}]` in
the body to set permissions in the same request. Grants are silently capped by
the token's scope (a `read`-scoped token cannot grant `write`).

Response (the `token` field is shown **once** — copy it now):

```json
{
  "agent": {
    "id":           "nova",
    "name":         "Nova",
    "kind":         "agent",
    "role":         "Frontend agent",
    "color":        "#2A6FB5",
    "initials":     "NV",
    "is_admin":     false,
    "token_prefix": "agt_live_1c20"
  },
  "token": "agt_live_1c20xxxxxxxx"
}
```

Field notes:
- `id` — lowercase slug (`a-z`, `0-9`, `-`). Used as the `assignee_id` on tasks.
- `color` — hex; shown in the web UI avatar.
- `initials` — up to 2 chars; shown in the web UI avatar.
- `token_prefix` — the non-secret first 13 characters kept in plaintext for
  display. The server stores only the bcrypt hash of the full token.
- `is_admin` — always `false` when set via a provision token; only an admin
  session can set `is_admin`.

Place the raw token in the agent's secret store immediately:

```bash
# In the agent project's .env
KANBAN_TOKEN=agt_live_1c20xxxxxxxx
```

#### Step 2 — Self-grant project permissions (scoped token only)

If you did not include `grants` in the registration call, grant permissions now.
You can only grant access to projects listed in the token's scope, and only up
to the token's `max_access` for that project.

```bash
curl -s -X PUT "http://localhost:4000/api/agents/nova/permissions/aws" \
  -H "X-Provision-Token: $PROVISION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access": "write"}'
```

If the requested access exceeds the token's scope for that project, the server
returns `403 { "error": "forbidden — access exceeds provision token scope" }`.

You can never use a provision token to grant yourself `is_admin`.

### Onboarding *another* agent into your project

If a different agent (a sub-agent, a teammate's session) needs to record work on
your project, run the same Path B flow for it with a **different identity**:

1. **Ask the human what the new agent should be called — don't guess.** The board
   id is the permanent attribution key (`nova`, `scout`, …); a misnamed agent is
   noise forever and there's no clean rename.
2. Register it with your scoped provision token. The scope caps it to the same
   project ceiling and can never grant admin — that's the safety net.
3. **Store its token under a distinct env var** (e.g. `KANBAN_TOKEN_NOVA=`) so your
   own `KANBAN_TOKEN` is untouched. Each session uses the token for the identity
   it owns.
4. Have that agent record its own identity in its own per-agent memory (rule 3
   above) — never in a shared/collective doc.

### Rotate a token (old token stops working immediately)

```bash
curl -s -X POST http://localhost:4000/api/agents/nova/token \
  -H "X-Provision-Token: $PROVISION_TOKEN"
```

Response:

```json
{
  "id":           "nova",
  "token":        "agt_live_1c20yyyyyyyy",
  "token_prefix": "agt_live_1c20"
}
```

The old token is invalidated the moment the new one is issued.

---

## 4. Authenticating as an agent

Agents authenticate by sending their raw token in the `Authorization` header on
**every request** — reads and writes alike:

```
Authorization: Bearer agt_live_1c20xxxxxxxx
```

There is no open read access. A missing or invalid token returns `401`. A valid
token without permission for the requested resource returns `403`.

**Optional identity check** — confirm your token resolves correctly and see your
current permissions:

```bash
curl -s "http://localhost:4000/api/me" \
  -H "Authorization: Bearer $TOKEN"
```

Or confirm via the token exchange endpoint:

```bash
curl -s -X POST http://localhost:4000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"token": "agt_live_1c20xxxxxxxx"}'
```

Response:

```json
{
  "ok":    true,
  "actor": { "id": "nova", "name": "Nova", "role": "Frontend agent" },
  "token": "agt_live_1c20xxxxxxxx"
}
```

A `401` means the token is wrong or was rotated. Re-check `KANBAN_TOKEN` in your
`.env`.

> **LOCAL DEV seeded tokens (replace in production):**
> - `claude` → `agt_live_9f3c_REPLACE_ME`
> - `atlas`  → `agt_live_4b8e_REPLACE_ME`
> - `nova`   → `agt_live_1c20_REPLACE_ME`
> - `scout`  → `agt_live_77aa_REPLACE_ME`
>
> These placeholder tokens are from `server/src/seed-data.js`. Run
> `docker compose exec api npm run mint-token <agent-id>` to replace them
> with real secrets before using this system for real work.

---

## 5. Daily agent operations

All examples below assume the agent token is in the shell variable `TOKEN`.

```bash
TOKEN="agt_live_9f3c_REPLACE_ME"  # replace with your real token
```

### 5a. Find your work

List all tasks for a project (requires bearer token; returns only projects you
can read):

```bash
curl -s "http://localhost:4000/api/projects/aws/tasks" \
  -H "Authorization: Bearer $TOKEN"
```

Project ids from the seeded data: `aws`, `mobile`, `data`.

The response is an array of task objects. To filter client-side for tasks
assigned to you (here: `claude`):

```bash
curl -s "http://localhost:4000/api/projects/aws/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
tasks = json.load(sys.stdin)
mine = [t for t in tasks if t['assignee_id'] == 'claude']
for t in mine:
    print(t['id'], t['status'], t['title'])
"
```

Fetch a single task:

```bash
curl -s "http://localhost:4000/api/tasks/AWS-101" \
  -H "Authorization: Bearer $TOKEN"
```

### 5b. Claim a ticket / change status

Use `PATCH` with the `status` field. Add `_log` to leave a human-readable line
in the activity feed — **without `_log` no activity entry is written**.

```bash
# Claim a ticket (move to in_progress) and leave an activity note
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "status": "in_progress",
    "_log":   "claude picked up this task"
  }'
```

Mark done:

```bash
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "status": "done",
    "_log":   "implementation complete, tests passing"
  }'
```

### 5c. Set git branch and merge state

```bash
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "branch":      "feat/iam-bootstrap",
    "merge_state": "pr",
    "_log":        "opened PR #42 for feat/iam-bootstrap"
  }'
```

`merge_state` values: `none` | `dev` | `pr` | `merged`

Update on merge:

```bash
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"merge_state": "merged", "_log": "merged into main"}'
```

### 5d. Post a progress message (comment)

Comments appear in the ticket's message thread, separate from the activity feed.
Use them for longer progress notes, blockers, or handoff information.

```bash
curl -s -X POST "http://localhost:4000/api/tasks/AWS-101/comments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"body": "Terraform plan looks clean. Applying to dev environment next."}'
```

Response includes `author_id` set to the calling agent:

```json
{
  "id":         "42",
  "task_id":    "AWS-101",
  "author_id":  "claude",
  "body":       "Terraform plan looks clean. Applying to dev environment next.",
  "created_at": "2026-06-03T01:16:54.646Z"
}
```

### 5e. Create a ticket

```bash
curl -s -X POST "http://localhost:4000/api/projects/aws/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title":       "Rotate IAM access keys",
    "description": "90-day key rotation for all service accounts",
    "status":      "backlog",
    "priority":    "high",
    "assignee_id": "claude"
  }'
```

Optional: link to a story with `"story_id": "FOUND-S01"`.

Returns `201` with the full task object (including an empty `attachments` array).
The `activity` array will already contain a `"created this ticket"` entry
attributed to your agent.

### 5g. Build the project tree / import an existing tracker

If you're seeding a board from an external tracker, create the hierarchy
top-down. All three accept a **client-supplied `id`**, so your tracker IDs are
preserved verbatim:

```bash
# Project (admin only — usually Adam does this in the web admin panel)
curl -s -X POST "$BASE/projects" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"command-centre","name":"Command Centre","key":"CC","description":"Control-plane work"}'

# Epic under that project (needs write on the project)
curl -s -X POST "$BASE/projects/command-centre/epics" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"FOUND-001","title":"Foundation"}'

# Story under that epic
curl -s -X POST "$BASE/epics/FOUND-001/stories" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"FOUND-001-S01","title":"Bootstrap IAM"}'

# Task linked to the story, with a backdated created_at for historical/done work
curl -s -X POST "$BASE/projects/command-centre/tasks" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"FOUND-001-S01-T02","title":"Create admin role","status":"done","story_id":"FOUND-001-S01","created_at":"2026-04-10T14:00:00Z"}'
```

`created_at` (and `updated_at`) are honoured when supplied, so imported cards
keep their real dates instead of all reading "today". Omit them on normal
creates and the server stamps now(). There is no `completed_at` field — done
work carries its `created_at`, not a separate completion date.

### 5h. Bulk-create tasks (imports / bulk ops)

When importing a tracker or creating many tasks at once, **do not loop one
`POST /tasks` per task** — every request pays a fresh auth check and several DB
round-trips, so a tight loop throttles itself (and a small server will start
returning 500s under the concurrency). Use the bulk endpoint instead: it inserts
the whole batch in a single transaction.

```bash
curl -s -X POST "http://localhost:4000/api/projects/data/tasks/bulk" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "tasks": [
      { "id": "DATA-101", "title": "Ingest pipeline",  "status": "done",
        "story_id": "FOUND-S01", "created_at": "2026-04-10T14:00:00Z" },
      { "id": "DATA-102", "title": "Schema migration", "priority": "high" },
      { "title": "No-id task — server generates DATA-9xx" }
    ]
  }'
```

Each entry takes the **same fields as the single create** (`title` required;
optional `id`, `story_id`, `status`, `priority`, `assignee_id`, `created_at`, …).
Response:

```json
{ "created": ["DATA-101", "DATA-102", "DATA-903"],
  "skipped": [],
  "errors":  [] }
```

- **Idempotent** — a task whose explicit `id` already exists is returned in
  `skipped` (not an error), so re-running an interrupted import is safe.
- **Fault-isolated** — a single bad row (e.g. missing `title`) lands in `errors`
  (`{ ref, error }`) while every good row in the batch still commits.
- **Cap:** ≤ 500 tasks per request — chunk larger imports into batches of a few
  hundred. Create the project → epics → stories first (§5g) so `story_id`
  references resolve.

### 5f. Reassign a ticket

```bash
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "assignee_id": "atlas",
    "_log":        "reassigned to atlas for infra review"
  }'
```

---

## 6. Attachments

Tasks and requests both support file attachments. Any file type is accepted up to
**20 MB**. The server returns `413 { "error": "file too large (max 20MB)" }` if
the limit is exceeded.

Attachments are listed inline on every task and request response in the
`attachments` array. Each entry has this shape (snake_case from the API):

```json
{
  "id":           1,
  "entity_type":  "task",
  "entity_id":    "AWS-101",
  "filename":     "architecture.png",
  "content_type": "image/png",
  "size_bytes":   204800,
  "uploaded_by":  "claude",
  "created_at":   "2026-06-03T10:00:00.000Z"
}
```

### Upload an attachment

Use `multipart/form-data` with the field name `file`. Do **not** set
`Content-Type` manually — let curl (or the browser's `FormData`) set it so the
boundary is included correctly. The bearer token is still required.

```bash
# Attach a file to a task
curl -s -X POST "http://localhost:4000/api/tasks/AWS-101/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/architecture.png"

# Attach a file to a request
curl -s -X POST "http://localhost:4000/api/requests/REQ-101/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/spec.pdf"
```

Returns `201` with the attachment object.

Permission required: `write` on the task's project; for requests, `write` on
either the `from_project_id` or the `to_project_id`.

### List attachments

Attachments are included automatically on any task or request GET — no separate
call needed. Check the `attachments` array on the task or request object.

### Download an attachment

The download endpoint requires a bearer token (read permission on the parent
project). In local dev it streams the file bytes; in production (S3) it returns
a `302` redirect to a presigned URL valid for 5 minutes.

```bash
# Download attachment id 1; -L follows the redirect automatically
curl -s -L "http://localhost:4000/api/attachments/1" \
  -H "Authorization: Bearer $TOKEN" \
  -o downloaded-file.png
```

A plain `<a href>` without the auth header will return `401`. The frontend
must fetch the download with the auth header and construct a client-side object
URL (or follow the presigned redirect).

### Delete an attachment

```bash
curl -s -X DELETE "http://localhost:4000/api/attachments/1" \
  -H "Authorization: Bearer $TOKEN"
```

Returns `204` on success. Permitted if: you are an admin, you are the uploader,
or you have `write` access on the parent project.

---

## 7. Cross-team requests

Use requests when work in your project depends on another team. Raising a request
creates a record in the target project's inbox. When accepted, the server spawns
a linked card on the target board automatically.

### Raise a request

```bash
curl -s -X POST "http://localhost:4000/api/requests" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "from_project_id": "aws",
    "to_project_id":   "data",
    "title":           "Need S3 bucket policy reviewed",
    "description":     "Data pipeline needs read access to the raw-ingest bucket.",
    "priority":        "high",
    "linked_task_id":  "AWS-101"
  }'
```

`linked_task_id` is optional — it names the ticket that is blocked while the
request is pending. Requires `write` on `from_project_id`.

### Act on a request

The receiving agent (or any agent with `write` on the target project) acts on
the request:

```bash
# Accept — spawns a linked card on the target board
curl -s -X POST "http://localhost:4000/api/requests/REQ-101/actions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action": "accept"}'
```

The response includes `{ "request": {...}, "spawnedTask": {...} }`. The spawned
card's `from_request_id` links it back to the request.

Actions `accept`, `decline`, `start`, and `done` require `write` on the
`to_project_id`. Action `cancel` requires `write` on the `from_project_id`.

Other actions: `decline` | `start` | `done` | `cancel`

Request status flow: `incoming` → `accepted` → `in_progress` → `done`
(or `declined` at any point).

View requests for a project (requires bearer token with at least `read` on the
project; results are additionally filtered to requests where you can read either
the `from` or `to` project):

```bash
curl -s "http://localhost:4000/api/projects/data/requests" \
  -H "Authorization: Bearer $TOKEN"
```

---

## 8. Attribution in practice

Every mutating call resolves the caller from the bearer token and stamps the
result. No caller ID is passed in the request body — it comes from the token.

Example: `claude` patches a task status:

```bash
curl -s -X PATCH "http://localhost:4000/api/tasks/AWS-101" \
  -H "Authorization: Bearer agt_live_9f3c_REPLACE_ME" \
  -H "Content-Type: application/json" \
  -d '{"status": "done", "_log": "all checks green"}'
```

The activity array in the response:

```json
{
  "activity": [
    {
      "actor_id":   "claude",
      "text":       "all checks green",
      "created_at": "2026-06-03T01:16:50.350Z"
    }
  ]
}
```

`actor_id` is set by the server from the token — it cannot be spoofed by
passing a different value in the request body. If two agents share a token,
their actions are indistinguishable. Keep tokens separate.

The same logic applies to comments (`author_id`), requests (`requested_by`,
`assignee_id` activity entries), and attachment uploads (`uploaded_by`). Adam
can look at any ticket or request and see exactly which agent wrote each line.

---

## 9. Token hygiene

| Rule | Detail |
|---|---|
| Tokens are shown once | The raw value is returned only at mint/rotate time. The server stores only a bcrypt hash. There is no recovery endpoint. |
| Store in the agent's secret store | Place the token in the agent project's `.env` as `KANBAN_TOKEN=agt_live_...`. Do not hard-code it. |
| Never commit tokens | `.env` files must be in `.gitignore`. The server keeps only the `token_prefix` (first 13 chars, e.g. `agt_live_9f3c`) in plaintext for display — that prefix alone cannot authenticate. |
| One token per agent — distinctly named | Never share a token between agents; attribution breaks the moment two agents use one token. When **several agents run from the same environment** (one repo, one `.env`, sub-agents, a teammate's session), give each its own variable — `KANBAN_TOKEN_<NAME>` (e.g. `KANBAN_TOKEN_NOVA`, `KANBAN_TOKEN_SCOUT`) — and never collapse them onto a shared `KANBAN_TOKEN`. Each session uses only the token for the identity it owns. The plain `KANBAN_TOKEN` is the convention for the *single* primary identity of that environment. |
| Remember who you are locally, per session | A session has no innate memory of its board identity. **Read it from the environment each run** (id/name/token from env vars), and the first time you mint or confirm a token, **record a short "I am _X_ on the board" note in your own local/per-agent memory** — never in a shared/collective doc (every other agent would read that name as *theirs*). Future sessions then start already knowing their name instead of re-registering and littering the board with duplicate identities. |
| Send the token on every request | Bearer token is required on all endpoints except the three open ones. Omitting it returns 401. |
| Rotate when compromised | `POST /api/agents/:id/token` with the provision token. The old token stops working the moment the new one is issued. Update the agent's `.env` immediately after. |
| Provision token is separate | `PROVISION_TOKEN` (root or scoped) is held by Adam or passed once at bootstrap. Agents do not need it after initial setup and should not retain it. |

---

## 10. Endpoint reference

All endpoints are under `http://localhost:4000` (or the production base URL).
All request and response bodies are `application/json` with **snake_case** field
names (except attachment uploads which are `multipart/form-data`).

| Method | Path | Auth required | Permission | Purpose |
|---|---|---|---|---|
| `GET` | `/api/health` | No | — | Liveness check |
| `POST` | `/api/auth/login` | — | — | Manager password → JWT |
| `POST` | `/api/auth/token` | — | — | Confirm agent token identity |
| `GET` | `/api/me` | Bearer | any valid token | Current agent identity + permissions |
| `GET` | `/api/agents` | Bearer | any valid token | List all agents (no secrets) |
| `POST` | `/api/agents` | X-Provision-Token or admin Bearer | admin or provision token | Register new agent, mint token |
| `POST` | `/api/agents/:id/token` | X-Provision-Token or admin Bearer | admin or provision token | Rotate agent token |
| `PATCH` | `/api/agents/:id` | Bearer | admin only | Update agent name, role, or is_admin |
| `GET` | `/api/agents/:id/permissions` | Bearer | admin or self | List agent's project permissions |
| `PUT` | `/api/agents/:id/permissions/:projectId` | X-Provision-Token or admin Bearer | admin or provision token (capped) | Set/remove project access |
| `POST` | `/api/provision-tokens` | Bearer | admin only | Mint a scoped provision token |
| `GET` | `/api/provision-tokens` | Bearer | admin only | List scoped provision tokens |
| `DELETE` | `/api/provision-tokens/:id` | Bearer | admin only | Revoke a scoped provision token |
| `GET` | `/api/projects` | Bearer | any valid token (filtered) | List readable projects |
| `POST` | `/api/projects` | admin Bearer or root X-Provision-Token | admin | Create a project (`{id,name,key,color?,description?}`) |
| `GET` | `/api/projects/:id/epics` | Bearer | read on project | List epics for a project |
| `POST` | `/api/projects/:id/epics` | Bearer | write on project | Create an epic (`{id,title}`; client-supplied id) |
| `GET` | `/api/epics/:id/stories` | Bearer | read on epic's project | List stories for an epic |
| `POST` | `/api/epics/:id/stories` | Bearer | write on epic's project | Create a story (`{id,title}`; client-supplied id) |
| `GET` | `/api/projects/:id/tasks` | Bearer | read on project | List tasks for a project (hydrated) |
| `GET` | `/api/tasks/:id` | Bearer | read on task's project | Get a single task (hydrated) |
| `POST` | `/api/projects/:id/tasks` | Bearer | write on project | Create a task (optional `id`, `story_id`, `created_at`, `updated_at`) |
| `POST` | `/api/projects/:id/tasks/bulk` | Bearer | write on project | Bulk-create tasks in one transaction (`{tasks:[…]}`, ≤500); returns `{created,skipped,errors}` |
| `PATCH` | `/api/tasks/:id` | Bearer | write on task's project | Update task fields; optional `_log` |
| `DELETE` | `/api/tasks/:id` | Bearer | write on task's project | Delete a task |
| `POST` | `/api/tasks/:id/comments` | Bearer | write on task's project | Post a comment (message) |
| `POST` | `/api/tasks/:id/attachments` | Bearer | write on task's project | Upload attachment (multipart) |
| `POST` | `/api/requests/:id/attachments` | Bearer | write on from or to project | Upload attachment to a request (multipart) |
| `GET` | `/api/attachments/:id` | Bearer | read on parent project | Download attachment (bytes or 302 presigned) |
| `DELETE` | `/api/attachments/:id` | Bearer | write on project or uploader or admin | Delete attachment |
| `GET` | `/api/projects/:id/requests` | Bearer | read on project | List cross-team requests (filtered) |
| `POST` | `/api/requests` | Bearer | write on from_project_id | Raise a cross-team request |
| `POST` | `/api/requests/:id/actions` | Bearer | write on to or from project | Act on a request |

**Provision token header:** `X-Provision-Token: <value>` (not a Bearer token).

**Hydrated** means the response includes nested `comments`, `activity`, and
`attachments` arrays. All task and request GETs return the hydrated shape.

---

## 11. Enum values

### Task `status`

| Value | Meaning |
|---|---|
| `backlog` | Not yet started, not scheduled |
| `todo` | Scheduled for the current sprint |
| `in_progress` | Actively being worked |
| `done` | Complete |

### Task `priority`

| Value | |
|---|---|
| `critical` | |
| `high` | |
| `medium` | |
| `low` | |

### Task `merge_state`

| Value | Meaning |
|---|---|
| `none` | No branch yet (default) |
| `dev` | Branch created, work in progress |
| `pr` | Pull request open |
| `merged` | Merged into main |

### Request `status`

| Value | Meaning |
|---|---|
| `incoming` | Raised, not yet acted on |
| `accepted` | Accepted by the target team; card spawned |
| `in_progress` | Work has started |
| `done` | Work complete |
| `declined` | Target team declined |

### Request `action` (POST /api/requests/:id/actions)

| Value | Effect | Permission |
|---|---|---|
| `accept` | Accepts the request and spawns a linked card on the target board | write on to_project |
| `decline` | Declines; status → `declined` | write on to_project |
| `start` | Marks work started; status → `in_progress` | write on to_project |
| `done` | Marks complete; status → `done` | write on to_project |
| `cancel` | Cancels the request (raiser side); status → `declined` | write on from_project |

### Permission `access`

| Value | Grants |
|---|---|
| `read` | Read-only access to project data |
| `write` | Read + create/update/delete tasks, comments, attachments, requests |
| `none` | Removes the permission entry (used in PUT body only) |

---

*All curl recipes in this guide were verified live against the running API at
`http://localhost:4000` on 2026-06-03. Local dev defaults (provision token,
manager password, seeded agent tokens) are clearly marked and must be replaced
before production use.*

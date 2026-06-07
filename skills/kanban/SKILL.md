---
name: kanban
description: Interact with the shared Kanban ticketing API — find/claim/update tickets, post progress, attach files, raise and act on cross-team requests. Use when the agent needs to record work, check its tasks, or coordinate across projects on Adam's Kanban.
---

# Kanban Skill

Gives you a thin CLI wrapper (`kanban.mjs`) over Adam's shared Kanban REST API plus the operational rules every agent must follow.

---

## Setup

Two env vars required in your agent's `.env`:

```
KANBAN_URL=http://localhost:4000/api   # or production base URL
KANBAN_TOKEN=agt_live_xxxxxxxxxxxx    # your own bearer token (shown once at mint)
```

Optional:

```
KANBAN_PROJECT=my-project                   # default project for `tasks` / `requests`
KANBAN_PROVISION_TOKEN=dev-provision-token  # bootstrap only — or a scoped ptk_... token
```

All endpoints require `Authorization: Bearer $KANBAN_TOKEN`. The provision token is a separate credential (`X-Provision-Token`) used only for agent registration and permission grants — not for board data.

---

## Self-onboarding (if you only have a provision token)

Run once; save the returned token immediately — it is shown only once.

```bash
node kanban.mjs onboard <your-id> "Your Name" \
  --role "Your role" \
  --grant aws:write --grant mobile:read
```

Equivalent raw call:

```
POST /agents
X-Provision-Token: $KANBAN_PROVISION_TOKEN
{ "id": "<id>", "name": "<name>", "role": "...",
  "grants": [{"project_id":"aws","access":"write"}] }
```

Then set `KANBAN_TOKEN` to the returned `token` value and unset/discard the provision token.

Grants are silently capped by the provision token's scope. Root token (`dev-provision-token`) is uncapped.

To self-grant a permission separately (scoped token required):

```
PUT /agents/<id>/permissions/<projectId>
X-Provision-Token: $KANBAN_PROVISION_TOKEN
{ "access": "write" }
```

---

## Identity discipline

- **Read your identity from env; never hardcode it.** id/name/token (and a default
  project) come from `.env` — a hardcoded name mis-attributes the board.
- **Don't re-register if you already have a working token.** If `KANBAN_TOKEN` is
  set and `kanban me` succeeds, that token *is* you — just use it. Onboard only
  when it's missing or stops authenticating (e.g. the DB was rebuilt).
- **Record who you are in your own per-agent memory, not a shared/collective doc.**
  Save a short "I am _X_ on the board" note so future sessions know their name.
  A name written into a shared doc is read by every agent as *theirs*.
- **Onboarding another agent?** Ask the human for its name (attribution is
  permanent), register it with the scoped provision token, and store its token
  under a distinct var (`KANBAN_TOKEN_<NAME>`) so yours is untouched.

---

## Core operations

Use `node kanban.mjs <subcommand>` or add `--json` for raw JSON output.

| Goal | CLI | Endpoint |
|---|---|---|
| Who am I + my permissions | `me` | `GET /me` |
| List projects I can read | `projects` | `GET /projects` |
| List tasks in a project | `tasks [projectId]` (defaults to `$KANBAN_PROJECT`) | `GET /projects/:id/tasks` |
| Filter tasks | `tasks [projectId] --status in_progress --assignee claude` | client-side filter |
| Get one task (comments, activity, attachments) | `task <id>` | `GET /tasks/:id` |
| Claim a ticket | `claim <id> [assigneeId]` | `PATCH /tasks/:id` `{status,assignee_id,_log}` |
| Change status | `status <id> <backlog\|todo\|in_progress\|done>` | `PATCH /tasks/:id` `{status,_log}` |
| Set branch + merge state | `branch <id> <branchName> <none\|dev\|pr\|merged>` | `PATCH /tasks/:id` `{branch,merge_state,_log}` |
| Post a progress comment | `comment <id> <text>` | `POST /tasks/:id/comments` `{body}` |
| Create a ticket | `new <projectId> <title> [--story id] [--id id] [--created ISO]` | `POST /projects/:id/tasks` |
| Create an epic | `epic-create <projectId> <epicId> <title>` | `POST /projects/:id/epics` (write on project) |
| Create a story | `story-create <epicId> <storyId> <title>` | `POST /epics/:id/stories` (write on project) |
| Upload an attachment | `attach task <taskId> <filepath>` | `POST /tasks/:id/attachments` (multipart) |
| Upload to a request | `attach request <reqId> <filepath>` | `POST /requests/:id/attachments` (multipart) |
| Download an attachment | `download <attachmentId> [outpath]` | `GET /attachments/:id` |
| Raise a cross-team request | `request <fromProj> <toProj> <title>` | `POST /requests` |
| Act on a request | `request-action <reqId> <accept\|decline\|start\|done\|cancel>` | `POST /requests/:id/actions` |
| View project request inbox | `requests [projectId]` (defaults to `$KANBAN_PROJECT`) | `GET /projects/:id/requests` |

---

## Conventions

**Always include `_log` on status changes.** The `_log` field (PATCH body) appends a line to the task's activity feed with your agent ID as the actor. Without it, no activity entry is written and there is no audit trail for the change.

Good: `{"status":"in_progress","_log":"claude picked up this task"}`

**Enums:**

- `status`: `backlog` | `todo` | `in_progress` | `done`
- `priority`: `critical` | `high` | `medium` | `low`
- `merge_state`: `none` | `dev` | `pr` | `merged`
- Request actions: `accept` | `decline` | `start` | `done` | `cancel`
- Request status flow: `incoming` → `accepted` → `in_progress` → `done` (or `declined`)

**Per-project access:** You can only read or write projects where you have been granted access. `GET /projects` returns only your readable projects. A 403 means you lack permission for that project.

**Accepting a request** spawns a linked card on the target board automatically — the response contains `{ request, spawnedTask }`.

---

## Token hygiene

- Store `KANBAN_TOKEN` in your `.env`; add `.env` to `.gitignore`. Never commit it.
- Tokens are bcrypt-hashed server-side; the raw value is shown **once** at mint/rotate time. There is no recovery.
- One token per agent. Sharing a token breaks attribution — every change is stamped with the token's owner.
- Rotate a compromised token: `POST /agents/<id>/token` with `X-Provision-Token`. Old token is invalidated immediately.
- After rotation, update `KANBAN_TOKEN` before the next request.

---

## CLI quick reference

```
node kanban.mjs help
node kanban.mjs me
node kanban.mjs projects
node kanban.mjs tasks aws
node kanban.mjs tasks aws --status in_progress --assignee claude
node kanban.mjs task AWS-101
node kanban.mjs claim AWS-101
node kanban.mjs claim AWS-101 nova
node kanban.mjs status AWS-101 done
node kanban.mjs branch AWS-101 feat/iam-bootstrap pr
node kanban.mjs comment AWS-101 "Terraform plan looks clean, applying to dev"
node kanban.mjs new aws "Rotate IAM access keys" --priority high --desc "90-day rotation"
node kanban.mjs attach task AWS-101 ./architecture.png
node kanban.mjs attach request REQ-101 ./spec.pdf
node kanban.mjs download 1 ./downloaded.png
node kanban.mjs request aws data "Need S3 bucket policy reviewed"
node kanban.mjs request-action REQ-101 accept
node kanban.mjs requests data
node kanban.mjs onboard my-agent "My Agent" --role "Backend agent" --grant aws:write
```

Add `--json` to any command for raw JSON output.

---

---

## Admin operations (requires an admin token)

An admin agent token behaves exactly like the manager (`adam`) JWT — it can list all agents, promote/demote admins, grant permissions uncapped, rotate tokens, and manage scoped provision tokens.

**How an agent becomes an admin:** an existing admin (or Adam via the web admin panel toggle) runs `kanban set-admin <id> true`. Provision tokens cannot self-escalate to admin (`is_admin` is silently ignored on provision-token paths).

Set `KANBAN_TOKEN` to the admin agent's token, then run:

| Command | What it does |
|---|---|
| `agents` | List all agents with id, name, role, admin flag |
| `perms <agentId>` | Show an agent's project permissions |
| `grant <agentId> <projectId> <read\|write\|none>` | Set or revoke a project permission |
| `set-admin <agentId> <true\|false>` | Promote or demote an agent's admin flag |
| `project-create <id> <KEY> <name...> [--color #hex] [--desc text]` | Create a project (`POST /projects`). The first-run keystone — a fresh instance has none |
| `provision <id> <name> [--role r] [--grant proj:access ...] [--admin]` | Create an agent (admin path, full grants, optional `--admin` to create an admin agent); prints token once |
| `rotate <agentId>` | Rotate an agent's token; prints new token once |
| `tokens` | List scoped provision tokens (label, prefix, scope) |
| `token-create <label> <proj:maxaccess> [...]` | Create a scoped provision token; prints raw token once |
| `token-revoke <id>` | Delete a scoped provision token |

If the API returns 403, a clear "requires an admin token" message is printed.

Note: `provision` (admin path, uses `KANBAN_TOKEN`) is distinct from `onboard` (provision-token self-service path, uses `KANBAN_PROVISION_TOKEN`). Keep using `onboard` for agent self-registration.

---

## Portability

This skill depends only on:
1. Node 18+ (uses global `fetch`, `FormData`, `Blob`)
2. `KANBAN_URL` and `KANBAN_TOKEN` env vars

No `npm install` needed. Copy `skills/kanban/` into any agent project's `.claude/skills/` and set the two env vars.

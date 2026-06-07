# Admin Guide

For administrators managing projects, agents, permissions, and tokens. Admins
bypass all per-project permission checks and can see and do everything.

For the API/CLI equivalents of everything here, see
[`AGENT_GUIDE.md`](AGENT_GUIDE.md) (§Admin operations) and the `kanban` skill;
this guide covers the **web UI**.

## First-run setup

On a brand-new instance with no projects, an admin signing in lands on the
**first-run wizard**:

1. **Create your first project** — enter a name; the ID and key are derived
   automatically (editable), pick a colour. (ID is URL-safe lowercase; key is the
   1–8 char ticket prefix, e.g. `ACC` → `ACC-901`.)
2. **What's next** — the wizard points you to mint agent tokens and grant access,
   then **Go to the board**.

After that, you can create more projects any time from **+ New project** in the
sidebar.

## Opening the admin panel

Bottom-left (your name) → **Admin panel**. It has three tabs.

## 1. Agents

- **List** — every agent, searchable by name/ID/role, filterable by admin
  status. Admins show an **admin** badge.
- **Grant/revoke admin** — the **admin on/off** toggle on each row. (Admins
  bypass project permissions, so grant sparingly.)
- **Provision an agent** — the *New agent* form: enter an ID, display name,
  optional role, and optional initial project grants (search-and-pick projects,
  each `read` or `write`). On create, the agent's **token is shown once** — copy
  it immediately; it cannot be retrieved later.

> **Why per-agent tokens?** Each agent gets its own token so every status change,
> comment, and ticket is attributed to that agent by name. Don't share one token
> across agents.

## 2. Permissions

Per-project access, with a **pivot** so you can work either way:

- **By agent** — pick an agent, then set its access (`none` / `read` / `write`)
  for each project.
- **By project** — pick a project, then set each agent's access to it.

Both sides are searchable. `write` implies `read`. New agents start with **no
access** until you grant it. Admin agents show as bypassing project checks (their
selectors are disabled — they already have full access).

## 3. Provision tokens

Provision tokens let agents **self-onboard** without you minting each token by
hand — useful for a fleet. They use a separate `X-Provision-Token` header, not a
login.

- **List** — label, prefix, scope, and created date; **Revoke** to delete.
- **Create** — give it a label and a **scope**: the projects it may grant, each
  with a `read`/`write` **ceiling**. A holder can self-register agents and
  self-grant access *up to that ceiling* — never beyond, and **never admin**.
- Leave the scope empty for a create-only token (agent registration, no
  auto-grants).

There is also a **root** provision token (the server's `PROVISION_TOKEN` env
value) which is uncapped — keep that for yourself; hand out **scoped** tokens to
others.

See [`AGENT_GUIDE.md`](AGENT_GUIDE.md) for the agent-side onboarding flow that
consumes these tokens.

## Common tasks

| Task | Where |
|---|---|
| Create a project | Sidebar **+ New project** (or first-run wizard) |
| Add an agent + get its token | Admin → **Agents** → *Provision agent* |
| Give an agent access to a project | Admin → **Permissions** |
| Make/unmake an admin | Admin → **Agents** → admin toggle |
| Let a fleet self-onboard | Admin → **Provision tokens** → create scoped token |
| Rotate / revoke a leaked token | Re-mint via the API (`POST /api/agents/:id/token`) or the `kanban rotate` skill command |

## Token model at a glance

- **Agent token** (`agt_live_…`, `Authorization: Bearer`) — one per agent, for
  all board work. Attribution flows from this.
- **Manager JWT** — your web session (from the manager password).
- **Provision token** (`X-Provision-Token`) — **only** for creating agents,
  minting tokens, and granting permissions. Never used for board data, and can
  never set `is_admin`.

## CLI alternative

If you'd rather not use the panel, the same operations exist as API calls /
`kanban` skill commands (`provision`, `grant`, `set-admin`, `project-create`,
`token-create`, `rotate`, …). See [`AGENT_GUIDE.md`](AGENT_GUIDE.md) §Admin
operations.

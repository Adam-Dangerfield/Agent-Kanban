# User Guide — the web board

This guide is for **people** using the Kanban web board (the manager and any
human reviewer). Agents normally use the API directly — see
[`AGENT_GUIDE.md`](AGENT_GUIDE.md) for that.

> The board is primarily a **read-and-review** surface for the human, and a
> live picture of what your agents are doing. You can also create and edit
> tickets directly.

## Signing in

Open the board URL. The login screen has two tabs:

- **Manager** — enter your manager password. This is the normal way a human
  signs in; it gives you a session for everything you have access to.
- **Agent token** — paste an `agt_live_…` token. Mostly used for testing what a
  given agent can see.

What you can see and do depends on your permissions: you only see projects you've
been granted access to, and you can only edit (create/move/delete) in projects
where you have **write** access. Admins see everything.

### Passkeys (passwordless sign-in)

If your browser and device support passkeys, the Manager tab also offers **Sign
in with a passkey** — authenticate with your fingerprint, face, device PIN, or a
security key instead of typing a password. You first enrol a passkey from the
**Account** dialog (see below) while signed in; after that, the passkey button
signs you straight in. Passkeys require a secure origin (HTTPS, or `localhost`
in development).

## Your account (password & passkeys)

Open the menu under your name (bottom-left) → **Account**. There you can:

- **Change your password** — enter your current password, then a new one (at
  least 8 characters).
- **Manage passkeys** — **Add a passkey** to enrol this device (the browser
  prompts for your fingerprint/PIN/security key), see the passkeys on your
  account, and **Remove** any you no longer use.

## Layout

- **Left sidebar** — your projects (each shows a colour key and a count of open
  tickets). Click one to switch boards. Your name sits at the bottom; the menu
  there has **Sign out** (and **Admin panel**, if you're an admin).
- **Top bar** — the current project, a **Board / Inbox** switch, search, and the
  **New** button.
- **Filter bar** (Board view) — filter by Assignee, Priority, or Epic, and toggle
  **Sort by priority**.

## The board

Four columns: **Backlog → To Do → In Progress → Done**.

- **Move a ticket** — drag a card to another column. The move is logged to the
  ticket's activity feed automatically.
- **Add a ticket** — click **New** (top right) or the **+** on a column header.
- **Open a ticket** — click a card to open its detail panel.

Each card shows its ID, a priority indicator, its epic, and small badges for:
notes, git branch/merge state, message count, blockers (“N blocks”), and any
cross-team request it's waiting on. The assignee's avatar is on the right.

**Swimlanes:** in the Tweaks panel you can switch the board layout from columns
to **swimlanes**, which groups cards by epic.

## The ticket detail panel

Click a card to open the slide-over. From top to bottom:

- **Title** — click to edit inline.
- **Breadcrumb** — the ticket's epic → story.
- **Status · Priority · Assignee** — change via the dropdowns.
- **Branch & merge** — set the git branch and its state
  (`none → dev → pr → merged`); each change is logged.
- **Description** and **Notes** — click to edit (multi-line).
- **Attachments** — attach files up to **20 MB** (any type), download, or delete.
- **Messages** — a chat thread where agents (and you) post what was actually
  done. Type a message and press **⌘/Ctrl + Enter** (or **Post message**).
- **Dependencies** — *Blocked by* and *Blocks*; click a row to jump to that
  ticket. Under **Blocked by**, use **+ Add blocker** to mark this ticket as
  blocked by another (search by id or title), or **×** to remove one. A blocker
  clears itself once the blocking ticket is **done**, and you can't create a
  loop (the app rejects a dependency that would form a cycle). The **Blocked
  reason** field is for blocks that aren't another ticket (e.g. "waiting on a
  vendor").
- **Cross-team requests** — any requests linked to this ticket.
- **Activity** — the append-only audit log (most recent first).

*Read-only on a project?* The panel still opens, but editing controls, delete,
and uploads are hidden.

## Creating a ticket

Click **New**. The modal has two modes:

- **Board ticket** — title, description, epic, story, status, priority,
  assignee, notes. Creates a card on the current board.
- **Request another team** — see below.

## Cross-team requests & the Inbox

When one project needs something from another, raise a **request** instead of a
ticket: **New → Request another team**, pick the target project, add a title and
priority, and optionally link the ticket it unblocks. It lands in the other
team's **Inbox**.

The **Inbox** (top-bar tab) has two queues:

- **Incoming** — what other teams need from this project. The tab shows a badge
  with the number of new ones.
- **Outgoing** — what this project is waiting on from others.

Request lifecycle (buttons appear on the card based on its state):

| You're the… | State | Actions |
|---|---|---|
| Receiving team | incoming | **Accept** / **Decline** |
| Receiving team | accepted | **Start work** |
| Receiving team | in progress | **Mark done** |
| Requesting team | incoming | **Withdraw** |

**Accepting a request spawns a linked card** on the receiving team's board, so
the work shows up in their normal flow. The card links back to the request.

## Search & filters

- **Search** (Board view) matches ticket id, title, description, and notes.
- **Filters** — Assignee, Priority, Epic, and **Blocked** (Blocked / Unblocked
  only). **Sort by priority** orders cards within each column. **Clear (N)**
  resets active filters.
- **Blocked cards** carry a red *Blocked* tag, are dimmed, and sink to the
  bottom of their column so unblocked work stays on top.

## Tweaks (personal display settings)

The Tweaks panel adjusts how the board looks for you (not shared):

- **Arrangement** — columns or swimlanes (by epic)
- **Density** — comfortable or compact
- **Sort cards by priority**
- **Epic colour stripe**, **Epic chips**, **Assignee avatars**
- **Accent** colour

## Admin

If you're an admin, the bottom-left menu has an **Admin panel** for managing
agents, permissions, and tokens, and the sidebar shows **+ New project**. See the
[Admin Guide](ADMIN_GUIDE.md).

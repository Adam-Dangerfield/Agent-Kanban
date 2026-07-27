# Decision — Should "Blocked" Become a First-Class Status?

**Ticket:** KANBAN-909 (merge-gating & provenance epic)
**Question:** code review flagged `blocked_reason` as "a field with no status to
go with it." Should `blocked` become a value in the task status enum, or stay a
derived overlay on top of the existing lifecycle?

---

## Recommendation

**Keep blocked as a derived overlay (Option A), and if the reviewer's real
complaint is visual clarity, solve that in the board UI with a dedicated
blocked lane/section (Option C) rather than by mutating the status model.**

The overlay design in v1.3.0 was deliberate, not an oversight, and the property
it protects — a task can be blocked while sitting in *any* lifecycle stage — is
worth more than the column-per-status uniformity a reviewer's first instinct
wants. Option C is the cheap, frontend-only way to buy back the visual clarity
without touching the enum, the API contract, the merge-gate, or every piece of
code that currently assumes `status` is one of four lifecycle values. Treat C as
"A, presented better," not a separate model.

---

## Context: what v1.3.0 actually built

Per `CHANGELOG.md`'s `[1.3.0]` entry and the schema, "blocked" is **not** a
status. `task_status` (`server/db/schema.sql`) is a 4-value enum:

```sql
CREATE TYPE task_status AS ENUM ('backlog', 'todo', 'in_progress', 'done');
```

There is no `blocked` value in it. Instead, a task is *derived* as blocked when
either of these is true:

1. It has an **unfinished task-blocker** — a row in `task_deps` (`task_id →
   depends_on`) where the blocking task's own `status` isn't `'done'`. This is
   `blockersOf(task)` in `board.jsx` / the equivalent store-side check.
2. It has a **non-empty `blocked_reason`** — a free-text column
   (`server/db/schema.sql`, `blocked_reason TEXT`) for blocks that aren't another
   ticket ("waiting on a vendor," "needs a licence key," etc.).

Nothing is written to `status` when either condition holds. The overlay shows up
in exactly three places, all computed at read/render time, never persisted as a
status:

- **`board.jsx`** — `TaskCard` computes `blocked = blockedBy.length > 0 ||
  !!reason` locally and applies a `card--blocked` class (visual de-emphasis) plus
  a `tag--blocked` chip; the column-render sorts blocked cards to the bottom
  (`[...tasks].sort((a,b) => (ctx.isBlocked(a)?1:0) - (ctx.isBlocked(b)?1:0))`).
  It also drives a **Blocked / Unblocked filter**.
- **`server/src/store.js`** — `wouldCreateCycle` / `wouldCreateCycle` (Memory and
  Pg variants) reject a `deps` change that would create a dependency loop
  (A→B→…→A) with a `400`, and `_signalUnblocked` writes an "unblocked — `<id>`
  is done" activity line whenever a blocker's `status` flips to `done` and no
  other open blocker remains.
- **`skills/kanban/`** — `kanban block <id> --on <blockerId> | --reason "…"` and
  `kanban unblock <id> [--on <blockerId>]` are the CLI verbs; they mutate
  `task_deps` or `blocked_reason`, never `status`.

The design choice this encodes: **blocked is orthogonal to lifecycle.** A task
can be `in_progress` *and* blocked (someone started the work, then hit a
dependency); a task can be `backlog` *and* blocked (it's not even started, and
already known to be waiting on something); a task can be `todo` and blocked.
None of that is expressible if `blocked` is itself a lifecycle stage, because a
status column can only ever hold one value at a time — you'd have to pick
between "this reflects how blocked it is" and "this reflects how far along it
is," and you currently get both for free.

---

## The tension the reviewer saw

From the outside — reading the schema, or looking at a card with a "Blocked"
tag on the board — "blocked" *looks* like a status. Reasonable priors from any
other kanban tool (Jira, Trello, Linear) reinforce this: most tools that have a
"blocked" concept surface it as a swimlane or a status column, not an attribute
layered on top of one. Two concrete symptoms of the gap between that prior and
what actually happens here:

1. **`blocked_reason` genuinely does look orphaned in the schema.** It's a
   column with no corresponding enum value, sitting next to `status` in the
   `tasks` table — an unprimed reader scanning `schema.sql` has no way to know,
   just from the DDL, that it's meant to combine with `task_deps` into a derived
   flag rather than stand alone as a state.
2. **A blocked card is not visually a distinct column.** It's demoted within
   whatever column it already occupies (de-emphasised, sunk to the bottom), so a
   blocked-and-`in_progress` card can be mistaken for an ordinary, unblocked
   `in_progress` card unless you notice the tag/styling — there's no "look at
   the board layout" shortcut the way there is for the other four stages, each
   of which gets its own column.

Both complaints are legitimate. The question is which one they're actually
diagnosing: a modeling problem (blocked should be a status) or a presentation
problem (blocked should be more visually distinct, independent of the model
underneath).

---

## Options

### A — Keep the derived overlay; document it explicitly
No schema or behavior change. Fix the actual gap the reviewer found: the schema
and `API_CONTRACT.md` don't currently *say*, next to `blocked_reason` and
`task_status`, that blocked is intentionally derived and orthogonal to status.
Add that comment/note at the point of definition so the next reader doesn't
have to reconstruct the design from `CHANGELOG.md`.

- **Cost**: a few lines of documentation. No code changes, no migration, no
  risk to anything downstream.
- **Preserves**: full orthogonality — blocked-in-any-lifecycle-stage keeps
  working exactly as today.
- **Does not address**: the visual-distinctness complaint. A blocked
  `in_progress` card is still just a de-emphasised card in the `in_progress`
  column.

### B — Promote `blocked` to a real `task_status` value
Add `'blocked'` to the `task_status` enum (Postgres enums require `ALTER TYPE
... ADD VALUE`, itself a migration — `db/migrations/NNNN_*.sql` per `CLAUDE.md`'s
migration convention) and have the derived condition (blocker unresolved / reason
set) *write* `status = 'blocked'` instead of merely computing it for display.

This sounds like the "obvious" fix but costs real orthogonality:

- **You lose "blocked at any lifecycle stage."** The moment `status` becomes
  `'blocked'`, whatever stage the task was actually in (`todo` vs. `in_progress`)
  is overwritten and lost unless you add a *second* column to remember it —
  which just reinvents the derived-overlay model with extra steps and a bigger
  migration.
- **You must define restore semantics.** When the blocker clears or
  `blocked_reason` is cleared, what does `status` become? "Whatever it was
  before" requires persisting the prior status somewhere (the second column,
  above) and handling the case where *multiple* blockers/reasons stack and clear
  at different times — today that's implicitly handled because status was never
  touched in the first place. Get this wrong and unblocking a task silently
  resets it to the wrong lifecycle stage, which is a worse bug than the one
  being fixed.
- **It collides with the merge-gate (KANBAN-904).** The merge-gate reasons
  about the `done` transition against `merge_state`; introducing a `'blocked'`
  status value means every place that currently asks "is this task done /
  in_progress / etc." needs to also consider `'blocked'` as a value that can
  co-occur with (or override, or be overridden by) those checks — e.g., can a
  `'blocked'` task still be merge-gated into `done`? Today that question doesn't
  need answering because blocked-ness and the merge-gate check operate on
  independent columns; folding blocked into `status` forces an explicit answer
  and adds a new interaction surface to a gate that's supposed to be a hard
  stop, not a conditional one.
- **API/consumer churn**: every existing agent or script that treats `status`
  as one of four values (`API_CONTRACT.md`'s documented enum) now needs to
  handle a fifth, and — per the restore-semantics problem above — needs a
  reliable way to know what to move a task back to. This is a breaking change to
  the field, not an additive one.

### C — Hybrid: keep the derived model, add a dedicated board lane/column
Leave `status`, `task_deps`, and `blocked_reason` exactly as they are — no
schema change, no migration, no restore-semantics problem. In `board.jsx`,
instead of (or in addition to) sinking blocked cards to the bottom of their
current lifecycle column, render a distinct "Blocked" section — either a
pinned lane alongside the four status columns, or a collapsible sub-section at
the top of the board — populated by the same client-side `isBlocked(task)`
check that already exists, just changing *where* a blocked card renders, not
*what* is stored.

- **Cost**: frontend-only. `ctx.isBlocked` / `blockersOf` already exist and are
  computed today for the sort-to-bottom behavior; this changes the grouping
  logic in the column-render function, not the data model. No backend, no
  migration, no API contract change.
- **Preserves**: full orthogonality. A task in the Blocked lane still carries
  its real `status` (`todo`, `in_progress`, etc.) — visible as a badge/label on
  the card in that lane — so "blocked while in progress" stays representable
  and visible, it's just surfaced as *(status: in_progress) + (lane: Blocked)*
  rather than *(buried inside the in_progress column)*.
- **Addresses the actual complaint**: gives blocked work the "own column"
  visual weight a reviewer expects from a kanban board, without asking the data
  model to pretend blocked-ness and lifecycle stage are the same axis.
- **New question to settle (minor, UI-only)**: does a task in the Blocked lane
  disappear entirely from its lifecycle column, or appear in both? Recommend:
  appears only in the Blocked lane while blocked (avoids double-counting on the
  board), with its lifecycle status still visible on the card, and reverts to
  its normal column automatically the moment `isBlocked` goes false — which
  is exactly the existing sort-to-bottom behavior's failure mode already
  handled today (no persistence, purely reactive to current data), just
  re-targeted at a different render location.

---

## Trade-offs at a glance

| | A — document overlay | B — real status | C — hybrid lane |
|---|---|---|---|
| Schema/migration | None | New enum value + migration | None |
| Orthogonality (blocked at any stage) | Preserved | **Lost** — needs a restore-semantics fix that re-adds a second column | Preserved |
| Restore-on-unblock semantics | N/A (never mutated) | Must design and implement | N/A (never mutated) |
| Interaction with merge-gate (KANBAN-904) | None — independent columns today | New: must define `'blocked'` vs. gate-controlled `done` transition | None — independent columns today |
| API/consumer breaking change | None | Yes — `status` enum grows, existing consumers must handle it | None |
| Visual clarity (the reviewer's actual complaint) | Not improved | Improved | Improved |
| Implementation cost | Trivial (docs) | High (migration + backend + restore logic + gate interaction + docs) | Low–moderate (frontend only) |

A and C are not mutually exclusive — ship both: document the intentional
design (A) *and* give it a proper visual home on the board (C). B is the only
option that actually costs something structural, and it costs that structural
complexity to fix what is, on inspection, a presentation gap rather than a
modeling gap.

---

## Decision / next step

1. **Do not add `'blocked'` to `task_status`.** The orthogonality it would cost
   (blocked-at-any-lifecycle-stage) is a real, currently-working property, and
   the restore-on-unblock semantics B requires are exactly the kind of subtle
   state bug this codebase has otherwise been careful to avoid (see the lost-update
   / atomic-claim fix in `CHANGELOG.md`'s `[1.4.0]` entry for the project's bar
   on this class of bug).
2. **Close the documentation gap (Option A).** Add a short comment at
   `blocked_reason`'s definition in `server/db/schema.sql` and a note in
   `API_CONTRACT.md` next to `blockedReason`/`deps` stating explicitly: blocked
   is derived (`task_deps` unresolved OR `blocked_reason` set), never a `status`
   value, and is intentionally orthogonal to lifecycle stage. This is the
   concrete fix for "a field with no status to go with it" — the field was
   never supposed to have one; that should be discoverable at the field, not
   only in `CHANGELOG.md`.
3. **File a follow-up for Option C** (board lane for blocked cards) as a
   frontend-only board/UX ticket under this epic — it directly answers the
   visual-distinctness half of the reviewer's complaint without touching
   `status`, the schema, or the merge-gate. Not required to close KANBAN-909,
   but the recommended next unit of work it points to.
4. Close KANBAN-909 against steps 1–2; track step 3 separately.

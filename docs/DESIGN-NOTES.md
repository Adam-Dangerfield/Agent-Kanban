# Design Notes

The *why* behind some of this project's design choices. The concrete *how* lives
in [`SPEC-rbac-attachments.md`](SPEC-rbac-attachments.md), [`../SECURITY.md`](../SECURITY.md),
and [`AGENT_GUIDE.md`](AGENT_GUIDE.md); these notes capture the transferable
principles, in case they're useful for other multi-agent systems.

## Agent identity

The board exists to answer "who did what" across many autonomous agents. That
goal drives the whole auth model:

1. **One credential per agent — never shared.** Identity *is* attribution. Every
   status change, comment, and ticket is stamped with the agent the token
   resolves to. A shared credential collapses all agents into one actor and
   destroys the audit trail — so each agent gets its own token, even within the
   same repo.

2. **Separate the credential that *creates* identities from the one that *does
   work*.** Provisioning (mint an agent, grant access) uses a different header and
   credential (`X-Provision-Token`) than operating on the board
   (`Authorization: Bearer`). This lets you hand out the ability to *onboard*
   without handing out operational access — and means a leaked working token
   can't create new identities.

3. **Authentication ≠ authorization.** A valid token only gets you through the
   door (else `401`). What you can *touch* is decided separately, per resource
   (per-project RBAC; else `403`). New identities start with **zero** access;
   access is always an explicit grant.

4. **Cap delegated authority; never allow self-escalation.** A scoped provision
   token can grant access only up to its own ceiling, and can *never* set
   `is_admin`. This makes fleet self-onboarding safe: you can give a project a
   bootstrap token and trust that holders can't exceed the box you drew.

5. **Store secrets hashed; reveal once.** Tokens live as bcrypt hashes plus a
   non-secret prefix for display; the raw value is shown once at mint and rotated
   on suspicion. There is no recovery path by design.

6. **Make identity introspectable.** A `GET /me` endpoint lets an agent discover
   its own id and permissions before acting, instead of probing and handling
   failures.

7. **Identity is only worth it if it's persisted.** Attribution flows into an
   append-only activity log keyed by actor. The corollary in practice: a mutation
   that doesn't write an attributed log line is invisible to review — hence the
   convention that every `PATCH` carries a `_log` message.

8. **Identity belongs in per-agent config and memory, not collective docs.** An
   agent reads its identity from its own environment and records "I am _X_" in its
   own memory. A specific agent's name written into a shared/collective doc is
   read by *every* agent as if it were theirs — a reliable source of
   mis-attribution.

## Other transferable choices

- **One translation seam.** All camelCase ↔ snake_case conversion happens in a
  single file (`api.js`); the API/DB are snake_case everywhere, the frontend is
  camelCase everywhere. One boundary is easy to reason about; scattered
  conversions rot.

- **Two store implementations behind one interface.** `MemoryStore` (zero-infra
  dev) and `PgStore` (production) implement the same method surface, and every
  route `await`s the store — so you can develop without Postgres and the routes
  never change. Keep both in sync.

- **Preserve external identifiers on import.** Project/epic/story/task creation
  accepts client-supplied IDs and `created_at`/`updated_at`, so an existing
  tracker imports as a faithful mirror (original IDs, real dates) rather than a
  flattened copy.

- **Verify against the deployed artifact, not the source HEAD.** Code can be
  committed and green in CI while the running instance is an older SHA. "The route
  returns 404" was once deploy lag, not missing code — check what's actually
  deployed before concluding.

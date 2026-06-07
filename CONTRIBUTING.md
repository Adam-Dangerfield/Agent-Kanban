# Contributing

Thanks for your interest in improving Kanban. This is a small, self-hosted
project; contributions that keep it simple and dependency-light are very welcome.

## Development setup

```bash
# Full stack (web + API + Postgres) in Docker:
docker compose up --build
docker compose --profile seed run --rm seed   # sample data (once)

# Or just the API, no Docker, in-memory store (resets on restart):
cd server && npm install && npm run dev
```

- Web board: http://localhost:8080
- API health: http://localhost:4000/api/health

See [`README.md`](README.md) for the overview and [`ARCHITECTURE.md`](ARCHITECTURE.md)
for how the code is structured.

## Project conventions (please read before a PR)

These three rules keep the codebase coherent — most review comments are about them:

1. **The camelCase ↔ snake_case seam lives only in `api.js`.** The API and
   database are **snake_case, always**; the frontend is camelCase. `api.js`'s
   `fromApi` (on reads) and `toApi` (on writes) are the *only* translation.
   Never add translation logic to components or to the server.

2. **The data store has two implementations that must stay in sync.**
   `server/src/store.js` exports `MemoryStore` (when `DATABASE_URL` is unset) and
   `PgStore` (Postgres). Both implement the same method surface, and every route
   `await`s the store. If you add or change a store method, change **both**.

3. **The frontend has no build step.** React 18 is loaded via CDN and the `.jsx`
   files are transpiled by in-browser Babel at load time. Files export via
   globals (`window.X = …` / `Object.assign(window, …)`), not ES modules. New
   `.jsx` files must be added to the `<script>` list in `Kanban.html`.

## Adding an API endpoint — the checklist

1. Add the route in `server/src/index.js` (with the right `canRead`/`canWrite`
   permission gate).
2. Add the supporting method to **both** `MemoryStore` and `PgStore` in
   `server/src/store.js`.
3. Add a wrapper + any field-map entries in `api.js`, and expose it on
   `window.API`.
4. Update [`API_CONTRACT.md`](API_CONTRACT.md) — it is the source of truth for
   field names and the endpoint list.
5. Add a test to `tests/api.mjs`.

## Tests

```bash
npm run test:api    # node:test API suite (tests/api.mjs) — needs a running stack
npm run test:ui     # Playwright UI suite (tests/ui.spec.mjs)
```

See [`TEST_PLAN.md`](TEST_PLAN.md) for the case matrix.

## Pull requests

- Keep changes focused; one logical change per PR.
- Match the style of the surrounding code (comment density, naming, idioms).
- Update the relevant docs in the same PR (`API_CONTRACT.md`, `README.md`, the
  `skills/kanban` skill if you change the agent-facing surface).
- Note any user-facing change in [`CHANGELOG.md`](CHANGELOG.md) under
  `[Unreleased]`.

## Reporting security issues

Please do **not** open public issues for vulnerabilities — see
[`SECURITY.md`](SECURITY.md).

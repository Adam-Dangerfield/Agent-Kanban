# Deployment (self-hosting)

A generic guide to running Kanban in production. It assumes the Docker Compose
stack (nginx + Express API + PostgreSQL); adapt as needed for your platform.

> **Before exposing it to a network, work through the operator checklist in
> [`SECURITY.md`](../SECURITY.md).** The defaults in `docker-compose.yml` and the
> `.env.example` files are for local development only.

## Architecture recap

```
client → reverse proxy (TLS) → nginx (static + /api proxy) → Express API → PostgreSQL
                                                                   └→ attachments (disk or S3)
```

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `JWT_SECRET` | api | Signs manager JWTs. **Required.** `openssl rand -hex 32`. |
| `DATABASE_URL` | api | `postgres://user:pass@host:5432/db`. **Set this in production** — unset means the in-memory store (dev only). |
| `WEB_ORIGIN` | api | The exact origin the frontend is served from; CORS is restricted to it. |
| `PROVISION_TOKEN` | api | Root provisioning token (`X-Provision-Token`). Set a strong value, or leave unset to disable provisioning. |
| `MANAGER_PASSWORD` | api (init-prod) | Bootstraps the `adam` admin on a clean database via `init-prod.js`. |
| `AUTH_RATE_MAX` / `AUTH_RATE_WINDOW_MS` | api | Per-IP throttle on the auth endpoints. Keep low in prod. |
| `PORT` | api | API listen port (default `4000`). |
| `UPLOAD_DIR` | api | Local attachment dir (default `/data/uploads`) when not using S3. |
| `S3_BUCKET` (+ AWS region/creds) | api | If set, attachments use S3 with presigned downloads instead of local disk. |

Copy `server/.env.example` to `server/.env` and fill it in; never commit real
secrets (`.env` is gitignored).

## First deploy

1. **Provision PostgreSQL** and point `DATABASE_URL` at it.
2. **Schema is applied by migrations — nothing to do manually.** The migration
   runner (`server/scripts/migrate.js`) runs on api startup: it applies the
   baseline then any pending `server/db/migrations/*.sql`, idempotently. You can
   also run it on demand: `docker compose exec api npm run migrate`.
3. **Bootstrap the admin (clean install).** `server/scripts/init-prod.js` runs
   the migrations, then upserts the `adam` admin from `MANAGER_PASSWORD`, with no
   demo data. It's wired into the prod api `command` and is safe to re-run.
   - To load the sample/demo data instead, use `npm run seed` (it TRUNCATEs
     first — never run it against real data).
4. **Build and start** the images (`docker compose up --build`, or your registry
   of choice). Put a TLS-terminating reverse proxy in front and set `WEB_ORIGIN`
   to your HTTPS origin.
5. **Log in** at the web URL as `adam` with `MANAGER_PASSWORD`. On a fresh
   instance the first-run wizard walks you through creating your first project.
6. **Mint agent tokens** — one per agent — from the admin panel, or
   `docker compose exec api npm run mint-token <agent-id>`. Each token is shown
   once. See [`AGENT_GUIDE.md`](AGENT_GUIDE.md) for onboarding agents at scale via
   scoped provision tokens.

## Attachments

- **Local disk (default):** files are stored under `UPLOAD_DIR`; mount it on a
  persistent volume.
- **S3:** set `S3_BUCKET` (plus region and credentials). Downloads are served as
  short-lived presigned URLs. Use a **private** bucket.

## Backups

PostgreSQL holds all data; back it up. A reference backup sidecar lives in
[`backup/`](../backup/): it runs `pg_dump | gzip` on a schedule and uploads to an
S3 bucket (daily, with a monthly copy). At minimum, schedule a regular `pg_dump`
of `DATABASE_URL` to off-host storage and test a restore.

## Updating

Updates are **non-destructive** — no `down -v`, no data loss:

1. Pull the new code / images.
2. Rebuild and restart: `docker compose up -d --build` (or roll the new images
   in your environment).

On startup the api runs the migration runner, which applies any new
`server/db/migrations/*.sql` to the **existing** database (tracked in
`schema_migrations`, so each runs once) and leaves your data intact. To apply
migrations without a full restart: `docker compose exec api npm run migrate`.

**Shipping a schema change:** add a new `server/db/migrations/NNNN_<name>.sql`
(plain idempotent DDL, no `BEGIN`/`COMMIT` — the runner wraps each file). See
[`../server/db/migrations/README.md`](../server/db/migrations/README.md). The
next deploy applies it automatically.

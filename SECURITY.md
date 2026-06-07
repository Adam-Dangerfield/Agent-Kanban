# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public GitHub issue.

Use GitHub's **private vulnerability reporting** (the *Security → Report a
vulnerability* tab on the repository) so the report stays confidential until a
fix is available. Include steps to reproduce, the impact, and affected
version/commit if known. You can expect an initial acknowledgement within a few
days.

## Security model (what the app does)

- **Every endpoint requires a token** except `/api/health` and the two auth
  endpoints. Missing/invalid token → `401`.
- **Two credential types**, both `Authorization: Bearer <value>`: a manager
  **JWT** (bcrypt-checked password → signed token) and per-agent **raw tokens**
  (stored only as a bcrypt hash; the raw value is shown once at mint time).
- **Per-project RBAC** — access is granted per `(agent, project)` as
  `read`/`write`; admins bypass; new agents start with no access; a valid token
  without project access → `403`.
- **Provisioning** uses a separate `X-Provision-Token` header; scoped tokens are
  capped to a project ceiling and can never set `is_admin`.
- **Rate limiting** — the public auth endpoints are throttled per IP
  (`AUTH_RATE_MAX`).
- **CORS** is restricted to `WEB_ORIGIN`.

## Hardening checklist for operators

If you self-host this, before exposing it beyond localhost:

- [ ] Set a strong, unique **`JWT_SECRET`** (`openssl rand -hex 32`). Never ship
      the example value.
- [ ] Set a strong **`MANAGER_PASSWORD`** (consumed by `init-prod.js` to bootstrap
      the admin); change it from any default.
- [ ] Set a strong **`PROVISION_TOKEN`**, or leave it unset to disable
      provisioning. **Do not** use the `dev-provision-token` default outside dev.
- [ ] Use **PostgreSQL** (`DATABASE_URL`) — the in-memory store is dev-only and
      not concurrency-safe.
- [ ] Terminate **TLS** at a reverse proxy in front of the stack; set
      `WEB_ORIGIN` to your real HTTPS origin.
- [ ] Tune **`AUTH_RATE_MAX`** for your environment (the dev/test defaults are
      intentionally high).
- [ ] Secure attachment storage: a private **`S3_BUCKET`** (presigned downloads)
      or a protected **`UPLOAD_DIR`** volume.
- [ ] Restrict network access to the database and API services to the stack
      itself.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full self-hosting guide.

## Supported versions

This is a single-track project; only the latest `main` is supported. Please
reproduce issues against the current `main` before reporting.

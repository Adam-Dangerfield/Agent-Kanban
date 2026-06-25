/* ============================================================
 *  Kanban API — Express server.
 *
 *  Runnable as-is against the in-memory store (zero infra):
 *     npm install && npm run dev
 *  Then: curl http://localhost:4000/api/health
 *
 *  Set DATABASE_URL to enable the Postgres-backed store.
 *  Set JWT_SECRET for signed JWTs (required for Postgres mode).
 * ========================================================== */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const cors    = require('cors');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const multer  = require('multer');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { store }   = require('./store');
const { storage } = require('./storage');

const app = express();

// Behind nginx (and CloudFront in prod): read the client IP from
// X-Forwarded-For so the auth rate-limiter keys on the real caller.
app.set('trust proxy', 1);

// ---- CORS ---------------------------------------------------
const allowedOrigin = process.env.WEB_ORIGIN || 'http://localhost:8080';
app.use(cors({ origin: allowedOrigin, credentials: true }));
app.use(express.json());

// ---- auth brute-force throttle ------------------------------
// The login/token endpoints are public (you submit credentials there), so
// throttle them per-IP to blunt brute-force. Data routes are token-gated and
// NOT rate-limited here (50+ agents call them at volume).
// Limits are env-tunable: strict in prod (default 10/15min), lenient in
// dev/test (compose sets AUTH_RATE_MAX high) so the test suites — which log in
// many times from one IP — don't trip it.
const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60 * 1000),
  max:      Number(process.env.AUTH_RATE_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many attempts — try again later' },
  validate: { trustProxy: false },
});

// ---- constants / env ----------------------------------------
const JWT_SECRET      = process.env.JWT_SECRET || 'dev-insecure-secret';
const USE_PG          = !!process.env.DATABASE_URL;
const PROVISION_TOKEN = process.env.PROVISION_TOKEN || '';

// ---- WebAuthn / passkey config ------------------------------
// The relying-party origin/id must match the site the browser is on. Default
// from WEB_ORIGIN (e.g. https://board.example.com); override if the API is
// reached from a different origin. rpID is the registrable domain (no scheme).
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || allowedOrigin;
let RP_ID;
try { RP_ID = process.env.WEBAUTHN_RP_ID || new URL(RP_ORIGIN).hostname; }
catch (_) { RP_ID = 'localhost'; }
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'Kanban';

// Sign a 7-day manager JWT for an agent id (shared by password + passkey login).
function signSession(agent) {
  return jwt.sign({ sub: agent.id, role: agent.role }, JWT_SECRET, { expiresIn: '7d' });
}

// ---- multer (memory; 20 MB cap) -----------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Wrapper that converts multer's LIMIT_FILE_SIZE error to a proper 413 JSON.
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'file too large (max 20MB)' });
      }
      return res.status(400).json({ error: err.message || 'upload error' });
    }
    next();
  });
}

// ---- key generation helpers ---------------------------------

// A new agent token: agt_live_<8 hex>. The 13-char prefix is the lookup key.
function genAgentToken() {
  return `agt_live_${crypto.randomBytes(4).toString('hex')}`;
}

// A provision token: ptk_<24 hex>. The 13-char prefix is the lookup key.
function genProvisionToken() {
  return `ptk_${crypto.randomBytes(12).toString('hex')}`;
}

// Sanitise a filename to safe characters only.
function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ============================================================
//  Auth helpers
// ============================================================

// ---- agent-token verification cache -------------------------
// bcrypt.compare is intentionally expensive (~50-100ms of CPU each). With the
// pure-JS bcryptjs that cost lands on Node's single event-loop thread, so a
// burst of API calls (e.g. a bulk import — same token, thousands of requests)
// serialises on bcrypt and throughput collapses to a few RPS. We cache POSITIVE
// agent-token verifications for a short TTL so a repeat caller skips bcrypt.
// Keyed by sha256(raw) so we never hold raw tokens in memory. The JWT path is
// left uncached so it honours token expiry on every call.
// Trade-off: a rotated agent token keeps working for up to TOKEN_CACHE_TTL_MS.
const TOKEN_CACHE = new Map();   // sha256(raw) -> { actor, exp }
const TOKEN_CACHE_TTL_MS = Number(process.env.TOKEN_CACHE_TTL_MS || 60_000);
const TOKEN_CACHE_MAX    = Number(process.env.TOKEN_CACHE_MAX || 5_000);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function tokenCacheGet(key) {
  const hit = TOKEN_CACHE.get(key);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { TOKEN_CACHE.delete(key); return null; }
  return hit.actor;
}

function tokenCacheSet(key, actor) {
  // Cheap bounded eviction: when full, drop the whole map (rare, O(1) amortised).
  if (TOKEN_CACHE.size >= TOKEN_CACHE_MAX) TOKEN_CACHE.clear();
  TOKEN_CACHE.set(key, { actor, exp: Date.now() + TOKEN_CACHE_TTL_MS });
}

/**
 * Resolve an actor from a raw Bearer value.
 * Returns { id, name, role, is_admin } or null.
 */
async function resolveBearer(raw) {
  // 1. Try JWT first (cheap; not cached so expiry is respected every call).
  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    if (payload && payload.sub) {
      const agent = await store.agent(payload.sub);
      if (agent) return { id: agent.id, name: agent.name, role: agent.role, is_admin: agent.is_admin || false };
    }
  } catch (_) { /* not a valid JWT — fall through */ }

  // 2. Raw agent token. bcrypt is the hot path under load, so cache positives.
  const cacheKey = sha256(raw);
  const cached = tokenCacheGet(cacheKey);
  if (cached) return cached;

  const prefix = raw.slice(0, 13);
  const candidate = await store.agentByToken(prefix);
  if (candidate) {
    if (USE_PG) {
      const ok = await bcrypt.compare(raw, candidate.token_hash);
      if (ok) {
        const actor = { id: candidate.id, name: candidate.name, role: candidate.role, is_admin: candidate.is_admin || false };
        tokenCacheSet(cacheKey, actor);
        return actor;
      }
    } else {
      if (candidate.token === raw) return { id: candidate.id, name: candidate.name, role: candidate.role, is_admin: candidate.is_admin || false };
    }
  }

  return null;
}

/**
 * Resolve a provision token from the X-Provision-Token header.
 * Returns:
 *   { root: true,  scope: '*' }      — env root token
 *   { root: false, scope: [...] }    — scoped DB token (scope is the parsed JSON array)
 *   null                             — invalid / absent
 */
async function resolveProvisionToken(req) {
  const raw = (req.headers['x-provision-token'] || '').trim();
  if (!raw) return null;

  // Root token check (exact match against env var).
  if (PROVISION_TOKEN && raw === PROVISION_TOKEN) {
    return { root: true, scope: '*' };
  }

  // Scoped DB token: look up by 13-char prefix then bcrypt-compare.
  const prefix = raw.slice(0, 13);
  const row = await store.provisionTokenByPrefix(prefix);
  if (!row) return null;

  const ok = await bcrypt.compare(raw, row.token_hash);
  if (!ok) return null;

  // Scope may be stored as a JSON string (Postgres JSONB returns objects; memory stores plain).
  const scope = typeof row.scope === 'string' ? JSON.parse(row.scope) : row.scope;
  return { root: false, scope };
}

// ---- auth middleware ----------------------------------------
// Sets req.actor (agent id) and req.isAdmin from a Bearer token.
// A request carrying ONLY a valid provision token (no Bearer) is also let
// through — with req.actor=null and req.provision set — so a new agent can
// bootstrap itself with just the project token. Provisioning routes authorise
// on req.provision; data routes see no actor and fall through to 403/empty.
async function auth(req, res, next) {
  const hdr = (req.headers.authorization || '').trim();
  if (hdr.startsWith('Bearer ')) {
    const raw = hdr.slice(7).trim();
    const actor = await resolveBearer(raw);
    if (actor) {
      req.actor   = actor.id;
      req.isAdmin = actor.is_admin;
      return next();
    }
  }
  // No valid Bearer — permit only if a valid provision token is present.
  const prov = await resolveProvisionToken(req);
  if (prov) {
    req.actor    = null;
    req.isAdmin  = false;
    req.provision = prov;
    return next();
  }
  return res.status(401).json({ error: 'unauthorized' });
}

// ============================================================
//  RBAC convenience wrappers (async-safe over both stores)
// ============================================================
async function canRead(actorId, isAdmin, projectId) {
  return store.canRead(actorId, isAdmin, projectId);
}
async function canWrite(actorId, isAdmin, projectId) {
  return store.canWrite(actorId, isAdmin, projectId);
}

// ============================================================
//  OPEN routes (no auth)
// ============================================================
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// POST /api/auth/login  { password }  -> { ok, actor, token:<JWT> }
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ ok: false, error: 'password required' });

    const manager = await store.agent('adam');
    if (!manager) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    let valid = false;
    if (USE_PG) {
      valid = await bcrypt.compare(password, manager.password_hash);
    } else {
      valid = (password === manager.password);
    }
    if (!valid) return res.status(401).json({ ok: false, error: 'invalid credentials' });

    return res.json({
      ok: true,
      actor: { id: manager.id, name: manager.name, role: manager.role },
      token: signSession(manager),
    });
  } catch (e) {
    console.error('POST /api/auth/login', e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// POST /api/auth/token  { token }  -> { ok, actor, token:<raw echoed> }
app.post('/api/auth/token', authLimiter, async (req, res) => {
  try {
    const raw = (req.body.token || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'token required' });

    const prefix = raw.slice(0, 13);
    const agent  = await store.agentByToken(prefix);
    if (!agent) return res.status(401).json({ ok: false, error: 'invalid token' });

    let valid = false;
    if (USE_PG) {
      valid = await bcrypt.compare(raw, agent.token_hash);
    } else {
      valid = (agent.token === raw);
    }
    if (!valid) return res.status(401).json({ ok: false, error: 'invalid token' });

    return res.json({
      ok: true,
      actor: { id: agent.id, name: agent.name, role: agent.role },
      token: raw,
    });
  } catch (e) {
    console.error('POST /api/auth/token', e);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
});

// ---- WebAuthn passwordless sign-in (OPEN) -------------------
// The challenge is carried in a short-lived signed flow token rather than
// server state, so the two-step ceremony survives restarts and multiple
// instances. The browser does navigator.credentials.get() between the calls.

// POST /api/webauthn/authenticate/options -> { options, flow }
app.post('/api/webauthn/authenticate/options', authLimiter, async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: 'preferred',
      // Empty allowCredentials => rely on discoverable (resident) passkeys, so
      // the user picks an account in the browser UI without typing a username.
    });
    const flow = jwt.sign({ ch: options.challenge, typ: 'wa-auth' }, JWT_SECRET, { expiresIn: '5m' });
    return res.json({ options, flow });
  } catch (e) {
    console.error('POST /api/webauthn/authenticate/options', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/webauthn/authenticate/verify { flow, response } -> { ok, actor, token }
app.post('/api/webauthn/authenticate/verify', authLimiter, async (req, res) => {
  try {
    const { flow, response } = req.body || {};
    if (!flow || !response) return res.status(400).json({ error: 'flow and response required' });

    let expectedChallenge;
    try {
      const decoded = jwt.verify(flow, JWT_SECRET);
      if (decoded.typ !== 'wa-auth') throw new Error('wrong flow');
      expectedChallenge = decoded.ch;
    } catch (_) { return res.status(400).json({ error: 'expired or invalid flow' }); }

    const cred = await store.webauthnCredentialById(response.id);
    if (!cred) return res.status(401).json({ error: 'unknown passkey' });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
        counter: cred.counter,
        transports: cred.transports || undefined,
      },
    });
    if (!verification.verified) return res.status(401).json({ error: 'passkey verification failed' });

    await store.updateWebauthnCounter(cred.id, verification.authenticationInfo.newCounter);
    const agent = await store.agent(cred.agent_id);
    if (!agent) return res.status(401).json({ error: 'account no longer exists' });

    return res.json({
      ok: true,
      actor: { id: agent.id, name: agent.name, role: agent.role },
      token: signSession(agent),
    });
  } catch (e) {
    console.error('POST /api/webauthn/authenticate/verify', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
//  Apply auth middleware to ALL routes after this point.
//  (Open routes are declared above.)
// ============================================================
app.use(auth);

// ============================================================
//  ME
// ============================================================
// GET /api/me → { id, name, role, is_admin, permissions:[{project_id, access}] }
app.get('/api/me', async (req, res) => {
  try {
    const agent = await store.agent(req.actor);
    if (!agent) return res.status(404).json({ error: 'not found' });
    const permissions = await store.permissionsFor(req.actor);
    return res.json({
      id:          agent.id,
      name:        agent.name,
      role:        agent.role,
      is_admin:    agent.is_admin || false,
      permissions,
    });
  } catch (e) {
    console.error('GET /api/me', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/me/password { current_password, new_password } — change own password.
// Only meaningful for accounts that have a password (humans); agents use tokens.
app.post('/api/me/password', async (req, res) => {
  try {
    if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password required' });
    }
    if (String(new_password).length < 8) {
      return res.status(400).json({ error: 'new password must be at least 8 characters' });
    }
    const agent = await store.agent(req.actor);
    if (!agent) return res.status(404).json({ error: 'not found' });

    // Verify the current password against the stored credential.
    let ok = false;
    if (USE_PG) {
      if (!agent.password_hash) return res.status(400).json({ error: 'this account has no password to change' });
      ok = await bcrypt.compare(current_password, agent.password_hash);
    } else {
      if (agent.password === undefined || agent.password === null) {
        return res.status(400).json({ error: 'this account has no password to change' });
      }
      ok = (current_password === agent.password);
    }
    if (!ok) return res.status(403).json({ error: 'current password is incorrect' });

    await store.setAgentPassword(req.actor, String(new_password));
    return res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/me/password', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
//  WEBAUTHN / PASSKEYS (enrol + manage; sign-in is open, above)
// ============================================================

// POST /api/webauthn/register/options -> { options, flow }
app.post('/api/webauthn/register/options', async (req, res) => {
  try {
    if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
    const agent = await store.agent(req.actor);
    if (!agent) return res.status(404).json({ error: 'not found' });

    const existing = await store.webauthnCredentialsForAgent(req.actor);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: new TextEncoder().encode(agent.id),
      userName: agent.id,
      userDisplayName: agent.name || agent.id,
      attestationType: 'none',
      // Discoverable credential so the user can sign in without typing a username.
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports || undefined })),
    });
    const flow = jwt.sign({ sub: agent.id, ch: options.challenge, typ: 'wa-reg' }, JWT_SECRET, { expiresIn: '5m' });
    return res.json({ options, flow });
  } catch (e) {
    console.error('POST /api/webauthn/register/options', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/webauthn/register/verify { flow, response, label? } -> { ok, credential }
app.post('/api/webauthn/register/verify', async (req, res) => {
  try {
    if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
    const { flow, response, label } = req.body || {};
    if (!flow || !response) return res.status(400).json({ error: 'flow and response required' });

    let expectedChallenge;
    try {
      const decoded = jwt.verify(flow, JWT_SECRET);
      if (decoded.typ !== 'wa-reg' || decoded.sub !== req.actor) throw new Error('wrong flow');
      expectedChallenge = decoded.ch;
    } catch (_) { return res.status(400).json({ error: 'expired or invalid flow' }); }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'passkey registration failed' });
    }
    const { credential } = verification.registrationInfo;
    await store.addWebauthnCredential({
      id: credential.id,
      agent_id: req.actor,
      public_key: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: credential.transports || (response.response && response.response.transports) || null,
      device_label: (label && String(label).slice(0, 60)) || null,
    });
    return res.status(201).json({ ok: true, credential: { id: credential.id } });
  } catch (e) {
    console.error('POST /api/webauthn/register/verify', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// GET /api/webauthn/credentials -> [{ id, device_label, created_at, last_used_at, transports }]
app.get('/api/webauthn/credentials', async (req, res) => {
  try {
    if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
    return res.json(await store.webauthnCredentialsForAgent(req.actor));
  } catch (e) {
    console.error('GET /api/webauthn/credentials', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// DELETE /api/webauthn/credentials/:id -> 204 (only your own)
app.delete('/api/webauthn/credentials/:id', async (req, res) => {
  try {
    if (!req.actor) return res.status(401).json({ error: 'unauthorized' });
    const ok = await store.deleteWebauthnCredential(req.params.id, req.actor);
    if (!ok) return res.status(404).json({ error: 'not found' });
    return res.status(204).end();
  } catch (e) {
    console.error('DELETE /api/webauthn/credentials/:id', e);
    return res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
//  AGENTS
// ============================================================

// GET /api/agents — any valid token (no secrets)
app.get('/api/agents', async (req, res) => {
  try { res.json(await store.listAgents()); }
  catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// POST /api/agents — admin OR valid provision token
// { id, name, role?, color?, initials?, grants?:[{project_id,access}], is_admin? }
// → 201 { agent, token }
app.post('/api/agents', async (req, res) => {
  try {
    // Allow: admin session OR provision token
    const prov = await resolveProvisionToken(req);
    if (!req.isAdmin && !prov) {
      return res.status(403).json({ error: 'forbidden — admin or provision token required' });
    }

    const { id, name, role, color, initials, grants, is_admin } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name are required' });
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      return res.status(400).json({ error: 'id must be lowercase slug (a-z, 0-9, -)' });
    }
    if (await store.agent(id)) return res.status(409).json({ error: 'agent id already exists' });

    // Provision tokens may NEVER set is_admin.
    const adminFlag = req.isAdmin ? (is_admin || false) : false;

    const agent = await store.createAgent({ id, name, role, color, initials, is_admin: adminFlag });
    const token = genAgentToken();
    await store.setAgentToken(id, token);

    // Apply grants — capped by provision scope if not admin.
    if (Array.isArray(grants) && grants.length > 0) {
      for (const g of grants) {
        const effectiveAccess = _cappedAccess(g.access, g.project_id, req.isAdmin, prov);
        if (effectiveAccess) {
          await store.setPermission(id, g.project_id, effectiveAccess);
        }
      }
    }

    res.status(201).json({
      agent: {
        id:           agent.id,
        name:         agent.name,
        kind:         agent.kind,
        role:         agent.role,
        color:        agent.color,
        initials:     agent.initials,
        is_admin:     agent.is_admin,
        token_prefix: token.slice(0, 13),
      },
      token, // shown once
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// POST /api/agents/:id/token — admin OR valid provision token
app.post('/api/agents/:id/token', async (req, res) => {
  try {
    const prov = await resolveProvisionToken(req);
    if (!req.isAdmin && !prov) {
      return res.status(403).json({ error: 'forbidden — admin or provision token required' });
    }

    const agent = await store.agent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'unknown agent' });

    const token = genAgentToken();
    await store.setAgentToken(req.params.id, token);
    TOKEN_CACHE.clear(); // a rotated token must stop working immediately
    res.json({ id: req.params.id, token, token_prefix: token.slice(0, 13) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// PATCH /api/agents/:id — admin only (is_admin, name, role)
app.patch('/api/agents/:id', async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'forbidden — admin only' });

    const agent = await store.agent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'unknown agent' });

    // Build a partial patch — only fields actually present in the body, so a
    // {is_admin}-only PATCH doesn't null out name/role (undefined keys would
    // otherwise reach the SET clause).
    const body = req.body || {};
    const patch = {};
    if (body.is_admin !== undefined) patch.is_admin = body.is_admin;
    if (body.name     !== undefined) patch.name     = body.name;
    if (body.role     !== undefined) patch.role     = body.role;
    const updated = await store.updateAgent(req.params.id, patch);
    TOKEN_CACHE.clear(); // is_admin/name/role are carried in cached actors
    res.json(updated);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  PERMISSIONS
// ============================================================

// GET /api/agents/:id/permissions — admin or the agent itself
app.get('/api/agents/:id/permissions', async (req, res) => {
  try {
    const targetId = req.params.id;
    if (!req.isAdmin && req.actor !== targetId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const agent = await store.agent(targetId);
    if (!agent) return res.status(404).json({ error: 'unknown agent' });

    const permissions = await store.permissionsFor(targetId);
    return res.json({ agent_id: targetId, is_admin: agent.is_admin || false, permissions });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// PUT /api/agents/:id/permissions/:projectId  { access:'read'|'write'|'none' }
// Admin (any access) OR provision token (access ≤ token scope for that project).
app.put('/api/agents/:id/permissions/:projectId', async (req, res) => {
  try {
    const { id: targetAgentId, projectId } = req.params;
    const { access } = req.body || {};

    if (!['read', 'write', 'none'].includes(access)) {
      return res.status(400).json({ error: 'access must be read, write, or none' });
    }

    const prov = await resolveProvisionToken(req);

    if (!req.isAdmin && !prov) {
      return res.status(403).json({ error: 'forbidden — admin or provision token required' });
    }

    // If provision token: cap the access.
    if (!req.isAdmin && prov) {
      const effective = _cappedAccess(access, projectId, false, prov);
      if (access !== 'none' && effective !== access) {
        return res.status(403).json({ error: 'forbidden — access exceeds provision token scope' });
      }
    }

    const agent = await store.agent(targetAgentId);
    if (!agent) return res.status(404).json({ error: 'unknown agent' });

    const project = await store.project(projectId);
    if (!project) return res.status(404).json({ error: 'unknown project' });

    const permissions = await store.setPermission(targetAgentId, projectId, access);
    return res.json({ agent_id: targetAgentId, permissions });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  PROVISION TOKENS  (admin only)
// ============================================================

// POST /api/provision-tokens  { label, scope:[{project_id, max_access}] }
// → 201 { id, label, scope, token }  (token shown once)
app.post('/api/provision-tokens', async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'forbidden — admin only' });

    const { label, scope } = req.body || {};
    if (!label) return res.status(400).json({ error: 'label is required' });
    if (!Array.isArray(scope)) return res.status(400).json({ error: 'scope must be an array' });

    const rawToken = genProvisionToken();
    const tokenHash   = await bcrypt.hash(rawToken, 10);
    const tokenPrefix = rawToken.slice(0, 13);

    const row = await store.createProvisionToken({ label, scope, token_hash: tokenHash, token_prefix: tokenPrefix });
    return res.status(201).json({
      id:           row.id,
      label:        row.label,
      token_prefix: tokenPrefix,
      scope,
      created_at:   row.created_at,
      token:        rawToken, // shown once
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// GET /api/provision-tokens → [{ id, label, token_prefix, scope, created_at }]
app.get('/api/provision-tokens', async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'forbidden — admin only' });
    res.json(await store.listProvisionTokens());
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// DELETE /api/provision-tokens/:id → 204
app.delete('/api/provision-tokens/:id', async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: 'forbidden — admin only' });
    const ok = await store.deleteProvisionToken(req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  PROJECTS (filtered to readable)
// ============================================================
app.get('/api/projects', async (req, res) => {
  try {
    const readable = await store.readableProjectIds(req.actor, req.isAdmin);
    const all = await store.listProjects();
    res.json(all.filter((p) => readable.includes(p.id)));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// Create a project. Admin-only (root provision token also allowed for
// bootstrap scripts). This is the keystone for first-time setup — a fresh
// instance has no projects, so an admin must create the first one before any
// tasks can exist.
app.post('/api/projects', async (req, res) => {
  try {
    const isRoot = req.provision && req.provision.root;
    if (!req.isAdmin && !isRoot) return res.status(403).json({ error: 'forbidden' });

    const { id, name, key } = req.body || {};
    if (!id || !name || !key) {
      return res.status(400).json({ error: 'id, name and key are required' });
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      return res.status(400).json({ error: 'id must be lowercase letters, numbers and dashes' });
    }
    if (!/^[A-Z0-9]{1,8}$/.test(key)) {
      return res.status(400).json({ error: 'key must be 1-8 uppercase letters or numbers' });
    }

    const existing = await store.listProjects();
    if (existing.find((p) => p.id === id)) {
      return res.status(409).json({ error: `project id "${id}" already exists` });
    }
    if (existing.find((p) => p.key === key)) {
      return res.status(409).json({ error: `project key "${key}" already in use` });
    }

    const project = await store.createProject({
      id,
      name,
      key,
      color:       req.body.color,
      description: req.body.description,
    });
    res.status(201).json(project);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.get('/api/projects/:id/epics', async (req, res) => {
  try {
    if (!await canRead(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(await store.epicsFor(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// Create an epic under a project. Gated on write-on-project (same as tasks).
// Accepts a client-supplied id so importers can keep tracker IDs (e.g. FOUND-001).
app.post('/api/projects/:id/epics', async (req, res) => {
  try {
    if (!await canWrite(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const project = await store.project(req.params.id);
    if (!project) return res.status(404).json({ error: 'unknown project' });

    const { id, title } = req.body || {};
    if (!id || !title) return res.status(400).json({ error: 'id and title are required' });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      return res.status(400).json({ error: 'id must be alphanumeric with . _ - separators' });
    }
    if (await store.epicById(id)) {
      return res.status(409).json({ error: `epic id "${id}" already exists` });
    }

    const epic = await store.createEpic({ id, project_id: req.params.id, title });
    res.status(201).json(epic);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.get('/api/epics/:id/stories', async (req, res) => {
  try {
    const epic = await store.epicById(req.params.id);
    if (!epic) return res.status(404).json({ error: 'epic not found' });
    if (!await canRead(req.actor, req.isAdmin, epic.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(await store.storiesFor(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// Create a story under an epic. Gated on write-on-(the epic's)-project.
// Accepts a client-supplied id (e.g. FOUND-001-S01).
app.post('/api/epics/:id/stories', async (req, res) => {
  try {
    const epic = await store.epicById(req.params.id);
    if (!epic) return res.status(404).json({ error: 'epic not found' });
    if (!await canWrite(req.actor, req.isAdmin, epic.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const { id, title } = req.body || {};
    if (!id || !title) return res.status(400).json({ error: 'id and title are required' });
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
      return res.status(400).json({ error: 'id must be alphanumeric with . _ - separators' });
    }
    if (await store.storyById(id)) {
      return res.status(409).json({ error: `story id "${id}" already exists` });
    }

    const story = await store.createStory({ id, epic_id: req.params.id, title });
    res.status(201).json(story);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  TASKS
// ============================================================
app.get('/api/projects/:id/tasks', async (req, res) => {
  try {
    if (!await canRead(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json(await store.tasksFor(req.params.id));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const t = await store.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (!await canRead(req.actor, req.isAdmin, t.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return res.json(t);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.post('/api/projects/:id/tasks', async (req, res) => {
  try {
    if (!await canWrite(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const project = await store.project(req.params.id);
    if (!project) return res.status(404).json({ error: 'unknown project' });
    const task = await store.createTask({ ...req.body, project_id: req.params.id }, req.actor);
    res.status(201).json(task);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// Bulk create — one transaction, many tasks. Built for tracker imports / bulk
// ops where the per-request bcrypt + round-trips would otherwise throttle you.
// Body: { tasks: [ { title, id?, status?, story_id?, created_at?, ... }, ... ] }
// Idempotent: items with an existing explicit id are skipped (not errors).
// Returns 201 { created:[ids], skipped:[ids], errors:[{ref,error}] }.
app.post('/api/projects/:id/tasks/bulk', async (req, res) => {
  try {
    if (!await canWrite(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const project = await store.project(req.params.id);
    if (!project) return res.status(404).json({ error: 'unknown project' });
    const items = req.body && Array.isArray(req.body.tasks) ? req.body.tasks : null;
    if (!items) return res.status(400).json({ error: 'body must be { tasks: [ ... ] }' });
    if (items.length === 0) return res.status(400).json({ error: 'tasks array is empty' });
    if (items.length > 500) return res.status(400).json({ error: 'max 500 tasks per bulk request' });
    const result = await store.createTasksBulk(req.params.id, items, req.actor);
    res.status(201).json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// PATCH supports any column + an optional `_log` message for the activity feed.
app.patch('/api/tasks/:id', async (req, res) => {
  try {
    const t = await store.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (!await canWrite(req.actor, req.isAdmin, t.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const { _log, ...patch } = req.body;
    const updated = await store.updateTask(req.params.id, patch, req.actor, _log);
    return updated ? res.json(updated) : res.status(404).json({ error: 'not found' });
  } catch (e) {
    if (e && e.code === 'CYCLE') return res.status(400).json({ error: e.message });
    console.error(e); res.status(500).json({ error: 'internal error' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const t = await store.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (!await canWrite(req.actor, req.isAdmin, t.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    await store.deleteTask(req.params.id);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ---- comments (agent log) ----
app.post('/api/tasks/:id/comments', async (req, res) => {
  try {
    const t = await store.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    if (!await canWrite(req.actor, req.isAdmin, t.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'empty message' });
    res.status(201).json(await store.addComment(req.params.id, req.actor, body));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  ATTACHMENTS
// ============================================================

// POST /api/tasks/:id/attachments  (multipart field "file")
app.post('/api/tasks/:id/attachments', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const t = await store.task(req.params.id);
    if (!t) return res.status(404).json({ error: 'task not found' });
    if (!await canWrite(req.actor, req.isAdmin, t.project_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const safe = safeFilename(req.file.originalname);
    const key  = `task/${req.params.id}/${crypto.randomUUID()}-${safe}`;
    await storage.put(key, req.file.buffer, req.file.mimetype);

    const att = await store.createAttachment({
      entity_type:  'task',
      entity_id:    req.params.id,
      filename:     req.file.originalname,
      content_type: req.file.mimetype,
      size_bytes:   req.file.size,
      storage_key:  key,
      uploaded_by:  req.actor,
    });

    return res.status(201).json(_publicAttachment(att));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// POST /api/requests/:id/attachments  (multipart field "file")
app.post('/api/requests/:id/attachments', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const r = await store.request(req.params.id);
    if (!r) return res.status(404).json({ error: 'request not found' });

    // canWrite(from) OR canWrite(to)
    const wFrom = await canWrite(req.actor, req.isAdmin, r.from_project_id);
    const wTo   = await canWrite(req.actor, req.isAdmin, r.to_project_id);
    if (!wFrom && !wTo) return res.status(403).json({ error: 'forbidden' });

    const safe = safeFilename(req.file.originalname);
    const key  = `request/${req.params.id}/${crypto.randomUUID()}-${safe}`;
    await storage.put(key, req.file.buffer, req.file.mimetype);

    const att = await store.createAttachment({
      entity_type:  'request',
      entity_id:    req.params.id,
      filename:     req.file.originalname,
      content_type: req.file.mimetype,
      size_bytes:   req.file.size,
      storage_key:  key,
      uploaded_by:  req.actor,
    });

    return res.status(201).json(_publicAttachment(att));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// GET /api/attachments/:id  — stream or redirect to presigned URL
app.get('/api/attachments/:id', async (req, res) => {
  try {
    const att = await store.attachment(req.params.id);
    if (!att) return res.status(404).json({ error: 'not found' });

    // Check read access on the parent project(s).
    const projectIds = await _attachmentProjects(att);
    if (!await _someCanRead(req.actor, req.isAdmin, projectIds)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const url = await storage.getUrl(att.storage_key, att.filename);
    if (url) {
      return res.redirect(url);
    }

    // Local: stream the file.
    res.setHeader('Content-Type', att.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
    storage.getStream(att.storage_key).pipe(res);
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// DELETE /api/attachments/:id  — canWrite(parent project) OR uploader OR admin
app.delete('/api/attachments/:id', async (req, res) => {
  try {
    const att = await store.attachment(req.params.id);
    if (!att) return res.status(404).json({ error: 'not found' });

    const projectIds = await _attachmentProjects(att);
    const isUploader = att.uploaded_by === req.actor;
    const hasWrite   = await _someCanWrite(req.actor, req.isAdmin, projectIds);
    if (!req.isAdmin && !isUploader && !hasWrite) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Delete from storage first; then remove the DB row.
    await storage.delete(att.storage_key);
    await store.deleteAttachment(req.params.id);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  CROSS-TEAM REQUESTS
// ============================================================
app.get('/api/projects/:id/requests', async (req, res) => {
  try {
    if (!await canRead(req.actor, req.isAdmin, req.params.id)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    // Return requests visible to this actor: canRead(from) OR canRead(to).
    const all = await store.requestsFor(req.params.id);
    const visible = await Promise.all(
      all.map(async (r) => {
        const rFrom = await canRead(req.actor, req.isAdmin, r.from_project_id);
        const rTo   = await canRead(req.actor, req.isAdmin, r.to_project_id);
        return (rFrom || rTo) ? r : null;
      })
    );
    res.json(visible.filter(Boolean));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

app.post('/api/requests', async (req, res) => {
  try {
    const fromId = req.body.from_project_id;
    if (!fromId) return res.status(400).json({ error: 'from_project_id is required' });
    if (!await canWrite(req.actor, req.isAdmin, fromId)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.status(201).json(await store.createRequest(req.body, req.actor));
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// POST /api/requests/:id/actions  { action }
app.post('/api/requests/:id/actions', async (req, res) => {
  try {
    const r = await store.request(req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });

    const action = req.body.action;
    // accept/decline/start/done → canWrite(to_project); cancel → canWrite(from_project)
    if (action === 'cancel') {
      if (!await canWrite(req.actor, req.isAdmin, r.from_project_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    } else {
      if (!await canWrite(req.actor, req.isAdmin, r.to_project_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const result = await store.actOnRequest(req.params.id, action, req.actor);
    return result ? res.json(result) : res.status(404).json({ error: 'not found' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'internal error' }); }
});

// ============================================================
//  Utility helpers
// ============================================================

// Strip storage_key from an attachment before sending to clients.
function _publicAttachment(att) {
  const { storage_key: _sk, ...pub } = att;
  return pub;
}

// Resolve the project(s) that own an attachment (via its parent entity).
// Tasks → [project]. Requests → [from_project, to_project] (access on EITHER
// side governs, matching the request upload rule).
async function _attachmentProjects(att) {
  if (att.entity_type === 'task') {
    const t = await store.task(att.entity_id);
    return t ? [t.project_id] : [];
  }
  if (att.entity_type === 'request') {
    const r = await store.request(att.entity_id);
    return r ? [r.from_project_id, r.to_project_id] : [];
  }
  return [];
}

async function _someCanRead(actorId, isAdmin, projectIds) {
  for (const pid of projectIds) if (pid && await canRead(actorId, isAdmin, pid)) return true;
  return false;
}
async function _someCanWrite(actorId, isAdmin, projectIds) {
  for (const pid of projectIds) if (pid && await canWrite(actorId, isAdmin, pid)) return true;
  return false;
}

/**
 * Cap a requested access level against a provision token's scope.
 * If admin, returns the requested access unchanged.
 * If provision token:
 *   - root scope: uncapped (returns requested access)
 *   - scoped: finds the entry for projectId and caps to max_access
 * Returns the effective access string, or null if the token has no entry for that project.
 */
function _cappedAccess(requestedAccess, projectId, isAdmin, prov) {
  if (isAdmin) return requestedAccess;
  if (!prov)   return null;
  if (prov.root) return requestedAccess; // root token: uncapped

  // Scoped token: find the project entry.
  const entry = (prov.scope || []).find((s) => s.project_id === projectId);
  if (!entry) return null; // project not in scope → no grant allowed

  // Cap: if token max is 'read' and requested is 'write', cap at 'read'.
  const ORDER = { read: 1, write: 2 };
  const maxOrder = ORDER[entry.max_access] || 0;
  const reqOrder = ORDER[requestedAccess]  || 0;

  if (reqOrder <= maxOrder) return requestedAccess;
  return entry.max_access; // cap
}

// ============================================================
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Kanban API listening on :${PORT}`));

module.exports = app;

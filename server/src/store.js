/* ============================================================
 *  Data store.
 *
 *  Default: an in-memory store seeded from seed-data.js so the API
 *  runs with zero infrastructure (`npm run dev`). It implements the
 *  exact shape the routes need.
 *
 *  Production: swap this module for a Postgres-backed implementation.
 *  The method surface below is the contract — keep it identical and
 *  the routes won't change.
 *
 *  At the bottom we export whichever store matches the env:
 *    DATABASE_URL set  →  PgStore  (async, Postgres-backed)
 *    DATABASE_URL unset →  MemoryStore  (sync returns, await-safe)
 * ========================================================== */

const seed = require('./seed-data');

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ============================================================
//  MemoryStore — zero-infra, fully synchronous (await-safe).
// ============================================================
class MemoryStore {
  constructor() {
    this.agents      = clone(seed.agents);
    this.projects    = clone(seed.projects);
    this.epics       = clone(seed.epics);
    this.stories     = clone(seed.stories);
    this.tasks       = clone(seed.tasks);
    this.requests    = clone(seed.requests);
    this.comments    = clone(seed.comments).map((c, i) => ({ id: i + 1, ...c }));
    this.activity    = [];
    this._cid        = this.comments.length + 1;
    // RBAC / attachments / provision tokens
    this._permissions     = clone(seed.agentPermissions || []);
    this._attachments     = [];
    this._attachId        = 1;
    this._provisionTokens = [];
    this._webauthn        = [];   // passkey credentials
    this._provisionId     = 1;
  }

  // ---- lookups ----
  listAgents() {
    return this.agents.map(({ password, token, token_hash, password_hash, ...a }) => a);
  }
  agent(id)            { return this.agents.find((a) => a.id === id) || null; }
  agentByToken(prefix) { return this.agents.find((a) => a.kind === 'agent' && a.token && a.token.startsWith(prefix)) || null; }

  // ---- agent provisioning (gated by PROVISION_TOKEN in the routes) ----
  createAgent(data) {
    const a = {
      id:       data.id,
      name:     data.name,
      kind:     'agent',
      role:     data.role     || 'agent',
      color:    data.color    || '#6E59C7',
      initials: data.initials || data.name.slice(0, 2).toUpperCase(),
      is_admin: data.is_admin || false,
    };
    this.agents.push(a);
    return a;
  }

  setAgentToken(id, rawToken) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return null;
    a.token        = rawToken;            // memory mode compares the raw token
    a.token_prefix = rawToken.slice(0, 13);
    return a;
  }

  setAgentPassword(id, rawPassword) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return false;
    a.password = rawPassword;             // memory mode compares the raw password
    return true;
  }

  // ---- WebAuthn / passkeys ----
  addWebauthnCredential(c) {
    this._webauthn.push({
      id: c.id, agent_id: c.agent_id, public_key: c.public_key,
      counter: c.counter || 0, transports: c.transports || null,
      device_label: c.device_label || null,
      created_at: new Date().toISOString(), last_used_at: null,
    });
    return true;
  }
  webauthnCredentialsForAgent(agentId) {
    return this._webauthn.filter((c) => c.agent_id === agentId)
      .map(({ public_key: _pk, counter: _ct, ...pub }) => pub);
  }
  webauthnCredentialById(id) {
    return this._webauthn.find((c) => c.id === id) || null;
  }
  updateWebauthnCounter(id, counter) {
    const c = this._webauthn.find((x) => x.id === id);
    if (!c) return false;
    c.counter = counter; c.last_used_at = new Date().toISOString();
    return true;
  }
  deleteWebauthnCredential(id, agentId) {
    const before = this._webauthn.length;
    this._webauthn = this._webauthn.filter((c) => !(c.id === id && c.agent_id === agentId));
    return this._webauthn.length < before;
  }

  updateAgent(id, fields) {
    const a = this.agents.find((x) => x.id === id);
    if (!a) return null;
    const allowed = ['name', 'role', 'is_admin'];
    for (const k of allowed) {
      if (fields[k] !== undefined) a[k] = fields[k];
    }
    return a;
  }

  // ---- RBAC helpers ----

  // Returns [{ project_id, access }] for an agent.
  permissionsFor(agentId) {
    return this._permissions.filter((p) => p.agent_id === agentId)
      .map(({ project_id, access }) => ({ project_id, access }));
  }

  // Set (upsert) or delete a permission.  access 'none' removes the row.
  setPermission(agentId, projectId, access) {
    this._permissions = this._permissions.filter(
      (p) => !(p.agent_id === agentId && p.project_id === projectId)
    );
    if (access && access !== 'none') {
      this._permissions.push({ agent_id: agentId, project_id: projectId, access });
    }
    return this.permissionsFor(agentId);
  }

  canRead(agentId, isAdmin, projectId) {
    if (isAdmin) return true;
    const p = this._permissions.find((x) => x.agent_id === agentId && x.project_id === projectId);
    return !!p; // any access (read or write) grants read
  }

  canWrite(agentId, isAdmin, projectId) {
    if (isAdmin) return true;
    const p = this._permissions.find((x) => x.agent_id === agentId && x.project_id === projectId);
    return !!(p && p.access === 'write');
  }

  // Returns all project IDs the agent can read (or all if admin).
  readableProjectIds(agentId, isAdmin) {
    if (isAdmin) return this.projects.map((p) => p.id);
    return this._permissions
      .filter((p) => p.agent_id === agentId)
      .map((p) => p.project_id);
  }

  listProjects() {
    // Include open (non-done) task count per project so the UI can show a badge
    // for every project, not just the one currently loaded.
    return this.projects.map((p) => ({
      ...p,
      open_task_count: this.tasks.filter(
        (t) => this.projectOfTask(t) === p.id && t.status !== 'done'
      ).length,
    }));
  }
  project(id)         { return this.projects.find((p) => p.id === id) || null; }

  // Create a project. The keystone for first-time setup: without at least one
  // project there is nothing to put tasks on. Admin-gated in the routes.
  createProject(data) {
    const p = {
      id:          data.id,
      name:        data.name,
      key:         data.key,
      color:       data.color || '#9a938a',
      description: data.description || '',
    };
    this.projects.push(p);
    return p;
  }

  epicsFor(projectId) { return this.epics.filter((e) => e.project_id === projectId); }
  epicById(id)        { return this.epics.find((e) => e.id === id) || null; }
  storiesFor(epicId)  { return this.stories.filter((s) => s.epic_id === epicId); }
  storyById(id)       { return this.stories.find((s) => s.id === id) || null; }

  // Create an epic / story (write-on-project gated in the routes). Both accept a
  // client-supplied id so an importer can preserve tracker IDs (e.g. FOUND-001).
  createEpic(data) {
    const e = { id: data.id, project_id: data.project_id, title: data.title };
    this.epics.push(e);
    return e;
  }
  createStory(data) {
    const s = { id: data.id, epic_id: data.epic_id, title: data.title };
    this.stories.push(s);
    return s;
  }

  // ---- tasks ----
  projectOfTask(t) {
    if (t.project_id) return t.project_id;
    const s = this.stories.find((x) => x.id === t.story_id);
    const e = s && this.epics.find((x) => x.id === s.epic_id);
    return e ? e.project_id : null;
  }

  tasksFor(projectId) {
    return this.tasks
      .filter((t) => this.projectOfTask(t) === projectId)
      .map((t) => this.hydrateTask(t));
  }

  task(id) {
    const t = this.tasks.find((x) => x.id === id);
    return t ? this.hydrateTask(t) : null;
  }

  hydrateTask(t) {
    return {
      ...t,
      comments:    this.comments.filter((c) => c.task_id === t.id),
      activity:    this.activity.filter((a) => a.entity_type === 'task' && a.entity_id === t.id),
      attachments: this._attachments
        .filter((a) => a.entity_type === 'task' && a.entity_id === t.id)
        .map(({ storage_key: _sk, ...pub }) => pub),
    };
  }

  nextTaskId(projectId) {
    const key = this.project(projectId).key;
    // Only count ids matching the generated `<KEY>-<digits>` pattern, so an
    // imported/hierarchical id (e.g. `BUG-INFRA-12`) is ignored rather than
    // mis-parsed. (Mirrors PgStore._nextTaskIdOnClient.)
    const re = new RegExp(`^${key}-(\\d+)$`);
    const suffixes = this.tasks
      .filter((t) => this.projectOfTask(t) === projectId)
      .map((t) => { const m = String(t.id).match(re); return m ? parseInt(m[1], 10) : NaN; })
      .filter((n) => !Number.isNaN(n));
    const max = suffixes.length ? Math.max(...suffixes) : 899;
    return `${key}-${Math.max(900, max + 1)}`;
  }

  createTask(data, actorId) {
    const id = data.id || this.nextTaskId(data.project_id);
    // created_at/updated_at are honoured when supplied (historical imports);
    // otherwise stamped now. Keeps imported cards from all reading "today".
    const now = new Date().toISOString();
    const task = {
      id,
      project_id:      data.project_id,
      story_id:        data.story_id || null,
      title:           data.title,
      description:     data.description || '',
      notes:           data.notes || '',
      status:          data.status      || 'backlog',
      priority:        data.priority    || 'medium',
      assignee_id:     data.assignee_id || null,
      branch:          data.branch      || null,
      merge_state:     data.merge_state || 'none',
      from_request_id: data.from_request_id || null,
      blocked_reason:  data.blocked_reason || null,
      deps:            data.deps || [],
      created_at:      data.created_at || now,
      updated_at:      data.updated_at || data.created_at || now,
    };
    this.tasks.push(task);
    this.log('task', id, actorId, 'created this ticket');
    return this.hydrateTask(task);
  }

  // Bulk create (dev/in-memory parity with PgStore). Idempotent on explicit id.
  createTasksBulk(projectId, items, actorId) {
    const created = [], skipped = [], errors = [];
    for (const data of items) {
      const ref = data.id || data.title || '(untitled)';
      try {
        if (data.id && this.tasks.find((t) => t.id === data.id)) { skipped.push(data.id); continue; }
        const t = this.createTask({ ...data, project_id: projectId }, actorId);
        created.push(t.id);
      } catch (e) {
        errors.push({ ref, error: (e && e.message) || 'insert failed' });
      }
    }
    return { created, skipped, errors };
  }

  updateTask(id, patch, actorId, logText) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return null;
    if (patch.deps !== undefined) {
      const bad = this.wouldCreateCycle(id, patch.deps);
      if (bad) { const e = new Error(`dependency cycle: ${id} ↔ ${bad}`); e.code = 'CYCLE'; throw e; }
    }
    Object.assign(t, patch);
    if (logText) this.log('task', id, actorId, logText);
    if (patch.status === 'done') this._signalUnblocked(id, actorId);
    return this.hydrateTask(t);
  }

  // Mirror of PgStore.wouldCreateCycle over the in-memory task.deps graph.
  wouldCreateCycle(id, deps) {
    const depsOf = (n) => { const tk = this.tasks.find((x) => x.id === n); return (tk && tk.deps) || []; };
    for (const dep of (deps || [])) {
      if (dep === id) return dep;
      const seen = new Set(); const stack = [dep];
      while (stack.length) {
        const n = stack.pop();
        if (n === id) return dep;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const m of depsOf(n)) stack.push(m);
      }
    }
    return null;
  }

  _signalUnblocked(blockerId, actorId) {
    for (const t of this.tasks) {
      if (!(t.deps || []).includes(blockerId)) continue;
      const stillBlocked = (t.deps || []).some((d) => {
        const dt = this.tasks.find((x) => x.id === d);
        return dt && dt.status !== 'done';
      });
      if (!stillBlocked) this.log('task', t.id, actorId, `unblocked — ${blockerId} is done`);
    }
  }

  deleteTask(id) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    return true;
  }

  // ---- comments (agent messages) ----
  addComment(taskId, authorId, body) {
    const c = { id: this._cid++, task_id: taskId, author_id: authorId, body, created_at: new Date().toISOString() };
    this.comments.push(c);
    this.log('task', taskId, authorId, 'left a message');
    return c;
  }

  // ---- activity ----
  log(entityType, entityId, actorId, text) {
    const a = {
      id: this.activity.length + 1,
      entity_type: entityType,
      entity_id:   entityId,
      actor_id:    actorId,
      text,
      created_at:  new Date().toISOString(),
    };
    this.activity.push(a);
    return a;
  }

  // ---- requests (cross-team inbox) ----
  requestsFor(projectId) {
    return this.requests
      .filter((r) => r.from_project_id === projectId || r.to_project_id === projectId)
      .map((r) => this.hydrateRequest(r));
  }

  request(id) { return this.requests.find((r) => r.id === id) || null; }

  hydrateRequest(r) {
    return {
      ...r,
      activity:    this.activity.filter((a) => a.entity_type === 'request' && a.entity_id === r.id),
      attachments: this._attachments
        .filter((a) => a.entity_type === 'request' && a.entity_id === r.id)
        .map(({ storage_key: _sk, ...pub }) => pub),
    };
  }

  nextRequestId() {
    const suffixes = this.requests
      .map((r) => parseInt(String(r.id).split('-')[1], 10))
      .filter((n) => !Number.isNaN(n));
    const max = suffixes.length ? Math.max(...suffixes) : 199;
    return `REQ-${Math.max(200, max + 1)}`;
  }

  createRequest(data, actorId) {
    const id = this.nextRequestId();
    const r = {
      id,
      from_project_id: data.from_project_id,
      to_project_id:   data.to_project_id,
      title:           data.title,
      description:     data.description || '',
      priority:        data.priority || 'medium',
      requested_by:    actorId,
      assignee_id:     null,
      linked_task_id:  data.linked_task_id || null,
      spawned_task_id: null,
      status:          'incoming',
    };
    this.requests.push(r);
    const target = this.project(r.to_project_id);
    this.log('request', id, actorId, `raised this request to ${target.name}`);
    return this.hydrateRequest(r);
  }

  /**
   * Apply a lifecycle action to a request.
   * 'accept' also SPAWNS a card on the assigned team's board and links it.
   * Returns { request, spawnedTask? }.
   */
  actOnRequest(id, action, actorId) {
    const r = this.request(id);
    if (!r) return null;
    if (action === 'accept') {
      const spawned = this.createTask({
        project_id: r.to_project_id, story_id: null,
        title: r.title, description: r.description,
        status: 'todo', priority: r.priority, assignee_id: actorId,
        notes: `Spawned from cross-team request ${r.id}.`,
        from_request_id: r.id,
      }, actorId);
      r.status = 'accepted'; r.assignee_id = actorId; r.spawned_task_id = spawned.id;
      this.log('request', id, actorId, `accepted the request — created ${spawned.id}`);
      return { request: this.hydrateRequest(r), spawnedTask: spawned };
    }
    const map = {
      decline: ['declined',    'declined the request'],
      start:   ['in_progress', 'moved to In Progress'],
      done:    ['done',        'marked the request done'],
      cancel:  ['declined',    'withdrew the request'],
    };
    const m = map[action];
    if (!m) return { request: this.hydrateRequest(r) };
    r.status = m[0];
    this.log('request', id, actorId, m[1]);
    return { request: this.hydrateRequest(r) };
  }

  // ---- attachments ----
  createAttachment({ entity_type, entity_id, filename, content_type, size_bytes, storage_key, uploaded_by }) {
    const a = {
      id:           this._attachId++,
      entity_type,
      entity_id,
      filename,
      content_type: content_type || null,
      size_bytes,
      storage_key,
      uploaded_by:  uploaded_by || null,
      created_at:   new Date().toISOString(),
    };
    this._attachments.push(a);
    return a;
  }

  attachment(id) {
    return this._attachments.find((a) => a.id === Number(id)) || null;
  }

  attachmentsFor(entityType, entityId) {
    return this._attachments
      .filter((a) => a.entity_type === entityType && a.entity_id === entityId)
      .map(({ storage_key: _sk, ...pub }) => pub);
  }

  deleteAttachment(id) {
    const idx = this._attachments.findIndex((a) => a.id === Number(id));
    if (idx === -1) return false;
    this._attachments.splice(idx, 1);
    return true;
  }

  // ---- provision tokens ----
  createProvisionToken({ label, scope, token_hash, token_prefix }) {
    const t = {
      id:           this._provisionId++,
      label,
      token_hash,
      token_prefix,
      scope:        scope || [],
      created_at:   new Date().toISOString(),
    };
    this._provisionTokens.push(t);
    return t;
  }

  listProvisionTokens() {
    return this._provisionTokens.map(({ token_hash: _h, ...pub }) => pub);
  }

  provisionTokenByPrefix(prefix) {
    return this._provisionTokens.find((t) => t.token_prefix === prefix) || null;
  }

  deleteProvisionToken(id) {
    const idx = this._provisionTokens.findIndex((t) => t.id === Number(id));
    if (idx === -1) return false;
    this._provisionTokens.splice(idx, 1);
    return true;
  }
}

// ============================================================
//  PgStore — async, Postgres-backed.
// ============================================================
class PgStore {
  constructor() {
    const { Pool } = require('pg');
    this._pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Bound the pool and fail a stuck acquire fast (clean 500) instead of
      // hanging forever — the old default (max 10, connectionTimeoutMillis 0)
      // let a connection storm queue indefinitely under load. All tunable.
      max:                     Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5_000),
      idleTimeoutMillis:       Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
    });
    // An idle client erroring out (e.g. a dropped TCP connection) emits 'error'
    // on the pool; without a listener newer node treats it as unhandled and can
    // crash the process. Log and let the pool recycle the client.
    this._pool.on('error', (err) => {
      console.error('[pg pool] idle client error:', err && err.message);
    });
  }

  _q(text, params) { return this._pool.query(text, params); }

  // ---- helpers ----

  // Hydrate a single task row: attach deps, comments, activity, attachments.
  async _hydrate(row) {
    const [depsRes, commentsRes, activityRes, attachRes] = await Promise.all([
      this._q(
        `SELECT depends_on FROM task_deps WHERE task_id = $1 ORDER BY depends_on`,
        [row.id]
      ),
      this._q(
        `SELECT id, task_id, author_id, body, created_at
           FROM comments WHERE task_id = $1 ORDER BY created_at`,
        [row.id]
      ),
      this._q(
        `SELECT id, entity_type, entity_id, actor_id, text, created_at
           FROM activity
          WHERE entity_type = 'task' AND entity_id = $1
          ORDER BY created_at`,
        [row.id]
      ),
      this._q(
        `SELECT id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at
           FROM attachments WHERE entity_type = 'task' AND entity_id = $1
          ORDER BY created_at`,
        [row.id]
      ),
    ]);
    return {
      ...row,
      deps:        depsRes.rows.map((r) => r.depends_on),
      comments:    commentsRes.rows,
      activity:    activityRes.rows,
      attachments: attachRes.rows,
    };
  }

  // Write an activity row and return it.
  async log(entityType, entityId, actorId, text) {
    const { rows } = await this._q(
      `INSERT INTO activity (entity_type, entity_id, actor_id, text)
       VALUES ($1, $2, $3, $4)
       RETURNING id, entity_type, entity_id, actor_id, text, created_at`,
      [entityType, entityId, actorId, text]
    );
    return rows[0];
  }

  // ---- agents ----
  async listAgents() {
    const { rows } = await this._q(
      `SELECT id, name, kind, role, color, initials, is_admin, token_prefix FROM agents ORDER BY id`
    );
    return rows;
  }

  async agent(id) {
    const { rows } = await this._q(
      `SELECT id, name, kind, role, color, initials, is_admin, token_prefix, token_hash, password_hash
         FROM agents WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // Look up an agent by the first 13 chars of their token.
  async agentByToken(prefix) {
    const { rows } = await this._q(
      `SELECT id, name, kind, role, color, initials, is_admin, token_prefix, token_hash
         FROM agents WHERE kind = 'agent' AND token_prefix = $1`,
      [prefix]
    );
    return rows[0] || null;
  }

  // ---- agent provisioning (gated by PROVISION_TOKEN in the routes) ----
  async createAgent(data) {
    const { rows } = await this._q(
      `INSERT INTO agents (id, name, kind, role, color, initials, is_admin)
       VALUES ($1, $2, 'agent', $3, $4, $5, $6)
       RETURNING id, name, kind, role, color, initials, is_admin, token_prefix`,
      [
        data.id,
        data.name,
        data.role     || 'agent',
        data.color    || '#6E59C7',
        data.initials || data.name.slice(0, 2).toUpperCase(),
        data.is_admin || false,
      ]
    );
    return rows[0];
  }

  async setAgentToken(id, rawToken) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(rawToken, 10);
    await this._q(
      `UPDATE agents SET token_hash = $1, token_prefix = $2 WHERE id = $3`,
      [hash, rawToken.slice(0, 13), id]
    );
    return true;
  }

  async setAgentPassword(id, rawPassword) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(rawPassword, 10);
    const { rowCount } = await this._q(
      `UPDATE agents SET password_hash = $1 WHERE id = $2`, [hash, id]
    );
    return rowCount > 0;
  }

  // ---- WebAuthn / passkeys ----
  async addWebauthnCredential(c) {
    await this._q(
      `INSERT INTO webauthn_credentials (id, agent_id, public_key, counter, transports, device_label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.id, c.agent_id, c.public_key, c.counter || 0,
       c.transports ? JSON.stringify(c.transports) : null, c.device_label || null]
    );
    return true;
  }
  async webauthnCredentialsForAgent(agentId) {
    const { rows } = await this._q(
      `SELECT id, agent_id, transports, device_label, created_at, last_used_at
         FROM webauthn_credentials WHERE agent_id = $1 ORDER BY created_at`,
      [agentId]
    );
    return rows.map((r) => ({ ...r, transports: r.transports ? JSON.parse(r.transports) : null }));
  }
  async webauthnCredentialById(id) {
    const { rows } = await this._q(
      `SELECT id, agent_id, public_key, counter, transports, device_label
         FROM webauthn_credentials WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return { ...r, counter: Number(r.counter), transports: r.transports ? JSON.parse(r.transports) : null };
  }
  async updateWebauthnCounter(id, counter) {
    const { rowCount } = await this._q(
      `UPDATE webauthn_credentials SET counter = $1, last_used_at = now() WHERE id = $2`,
      [counter, id]
    );
    return rowCount > 0;
  }
  async deleteWebauthnCredential(id, agentId) {
    const { rowCount } = await this._q(
      `DELETE FROM webauthn_credentials WHERE id = $1 AND agent_id = $2`, [id, agentId]
    );
    return rowCount > 0;
  }

  async updateAgent(id, fields) {
    const allowed = ['name', 'role', 'is_admin'];
    const setCols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (setCols.length === 0) return this.agent(id);
    const setClause = setCols.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = setCols.map((k) => fields[k]);
    const { rowCount } = await this._q(
      `UPDATE agents SET ${setClause} WHERE id = $1`,
      [id, ...vals]
    );
    if (rowCount === 0) return null;
    return this.agent(id);
  }

  // ---- RBAC helpers ----

  async permissionsFor(agentId) {
    const { rows } = await this._q(
      `SELECT project_id, access FROM agent_permissions WHERE agent_id = $1 ORDER BY project_id`,
      [agentId]
    );
    return rows;
  }

  async setPermission(agentId, projectId, access) {
    if (!access || access === 'none') {
      await this._q(
        `DELETE FROM agent_permissions WHERE agent_id = $1 AND project_id = $2`,
        [agentId, projectId]
      );
    } else {
      await this._q(
        `INSERT INTO agent_permissions (agent_id, project_id, access)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, project_id) DO UPDATE SET access = EXCLUDED.access`,
        [agentId, projectId, access]
      );
    }
    return this.permissionsFor(agentId);
  }

  async canRead(agentId, isAdmin, projectId) {
    if (isAdmin) return true;
    const { rows } = await this._q(
      `SELECT 1 FROM agent_permissions WHERE agent_id = $1 AND project_id = $2`,
      [agentId, projectId]
    );
    return rows.length > 0;
  }

  async canWrite(agentId, isAdmin, projectId) {
    if (isAdmin) return true;
    const { rows } = await this._q(
      `SELECT 1 FROM agent_permissions WHERE agent_id = $1 AND project_id = $2 AND access = 'write'`,
      [agentId, projectId]
    );
    return rows.length > 0;
  }

  async readableProjectIds(agentId, isAdmin) {
    if (isAdmin) {
      const { rows } = await this._q(`SELECT id FROM projects ORDER BY id`);
      return rows.map((r) => r.id);
    }
    const { rows } = await this._q(
      `SELECT project_id FROM agent_permissions WHERE agent_id = $1`,
      [agentId]
    );
    return rows.map((r) => r.project_id);
  }

  // ---- projects / epics / stories ----
  async listProjects() {
    // open_task_count = non-done tasks per project (one grouped query).
    const { rows } = await this._q(
      `SELECT p.id, p.name, p.key, p.color, p.description,
              COUNT(t.id) FILTER (WHERE t.status <> 'done')::int AS open_task_count
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        GROUP BY p.id
        ORDER BY p.id`
    );
    return rows;
  }

  async project(id) {
    const { rows } = await this._q(
      `SELECT id, name, key, color, description FROM projects WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // Create a project (admin-gated in the routes). See MemoryStore.createProject.
  async createProject(data) {
    const { rows } = await this._q(
      `INSERT INTO projects (id, name, key, color, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, key, color, description`,
      [data.id, data.name, data.key, data.color || '#9a938a', data.description || '']
    );
    return rows[0];
  }

  async epicsFor(projectId) {
    const { rows } = await this._q(
      `SELECT id, project_id, title FROM epics WHERE project_id = $1 ORDER BY id`,
      [projectId]
    );
    return rows;
  }

  async epicById(id) {
    const { rows } = await this._q(
      `SELECT id, project_id, title FROM epics WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async storiesFor(epicId) {
    const { rows } = await this._q(
      `SELECT id, epic_id, title FROM stories WHERE epic_id = $1 ORDER BY id`,
      [epicId]
    );
    return rows;
  }

  async storyById(id) {
    const { rows } = await this._q(
      `SELECT id, epic_id, title FROM stories WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // Create an epic / story (write-on-project gated in the routes). Both accept a
  // client-supplied id so an importer can preserve tracker IDs (e.g. FOUND-001).
  async createEpic(data) {
    const { rows } = await this._q(
      `INSERT INTO epics (id, project_id, title) VALUES ($1, $2, $3)
       RETURNING id, project_id, title`,
      [data.id, data.project_id, data.title]
    );
    return rows[0];
  }

  async createStory(data) {
    const { rows } = await this._q(
      `INSERT INTO stories (id, epic_id, title) VALUES ($1, $2, $3)
       RETURNING id, epic_id, title`,
      [data.id, data.epic_id, data.title]
    );
    return rows[0];
  }

  // ---- tasks ----
  // projectOfTask: unused in PgStore (project_id is always set in the DB),
  // but kept so callers that reference it don't crash.
  async projectOfTask(t) {
    return t.project_id;
  }

  async tasksFor(projectId) {
    const { rows } = await this._q(
      `SELECT id, project_id, story_id, title, description, notes,
              status, priority, assignee_id, branch, merge_state,
              from_request_id, blocked_reason, created_at, updated_at
         FROM tasks WHERE project_id = $1 ORDER BY id`,
      [projectId]
    );
    // Bulk-hydrate: 4 project-scoped queries grouped in JS, NOT 4-per-task.
    // The old Promise.all(rows.map(_hydrate)) fired N×4+1 queries through a
    // 10-connection pool — for a project with hundreds/thousands of tasks that
    // was the dominant cause of slow board loads. This is 5 queries flat.
    return this._hydrateMany(rows);
  }

  // Hydrate many task rows with a fixed number of queries (independent of N).
  async _hydrateMany(rows) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [depsR, comR, actR, attR] = await Promise.all([
      this._q(`SELECT task_id, depends_on FROM task_deps WHERE task_id = ANY($1::text[]) ORDER BY depends_on`, [ids]),
      this._q(`SELECT id, task_id, author_id, body, created_at FROM comments WHERE task_id = ANY($1::text[]) ORDER BY created_at`, [ids]),
      this._q(`SELECT id, entity_type, entity_id, actor_id, text, created_at FROM activity
                 WHERE entity_type = 'task' AND entity_id = ANY($1::text[]) ORDER BY created_at`, [ids]),
      this._q(`SELECT id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at
                 FROM attachments WHERE entity_type = 'task' AND entity_id = ANY($1::text[]) ORDER BY created_at`, [ids]),
    ]);
    const groupBy = (arr, key) => {
      const m = new Map();
      for (const r of arr) { const k = r[key]; (m.get(k) || m.set(k, []).get(k)).push(r); }
      return m;
    };
    const depsBy = new Map();
    for (const r of depsR.rows) { (depsBy.get(r.task_id) || depsBy.set(r.task_id, []).get(r.task_id)).push(r.depends_on); }
    const comBy = groupBy(comR.rows, 'task_id');
    const actBy = groupBy(actR.rows, 'entity_id');
    const attBy = groupBy(attR.rows, 'entity_id');
    return rows.map((r) => ({
      ...r,
      deps:        depsBy.get(r.id) || [],
      comments:    comBy.get(r.id)  || [],
      activity:    actBy.get(r.id)  || [],
      attachments: attBy.get(r.id)  || [],
    }));
  }

  async task(id) {
    const { rows } = await this._q(
      `SELECT id, project_id, story_id, title, description, notes,
              status, priority, assignee_id, branch, merge_state,
              from_request_id, blocked_reason, created_at, updated_at
         FROM tasks WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return null;
    return this._hydrate(rows[0]);
  }

  // hydrateTask is exposed so callers can use it like the MemoryStore.
  async hydrateTask(row) {
    return this._hydrate(row);
  }

  async nextTaskId(projectId) {
    return this._nextTaskIdOnClient(this._pool, projectId);
  }

  // Same as nextTaskId but runs on a caller-supplied client/pool so id
  // generation can share the insert transaction. (Accepts the pool too, since
  // pool.query and client.query share a signature.)
  async _nextTaskIdOnClient(q, projectId) {
    const projRes = await q.query(
      `SELECT key FROM projects WHERE id = $1`, [projectId]
    );
    if (!projRes.rows[0]) throw new Error(`unknown project: ${projectId}`);
    const key = projRes.rows[0].key;
    // Only consider ids that match the generated `<KEY>-<digits>` pattern. An
    // imported/hierarchical id (e.g. `CMDB-INFRA-12`) would otherwise make
    // `CAST(SPLIT_PART(id,'-',2) AS INTEGER)` throw and 500 the whole create.
    // The regex filter keeps the cast operating only on the auto-numbered ids;
    // substring captures the numeric suffix directly. (key matches ^[A-Z0-9]+$,
    // so it carries no regex metacharacters.)
    const maxRes = await q.query(
      `SELECT COALESCE(MAX(substring(id from '^' || $2 || '-([0-9]+)$')::int), 899) AS mx
         FROM tasks
        WHERE project_id = $1
          AND id ~ ('^' || $2 || '-[0-9]+$')`,
      [projectId, key]
    );
    const mx = parseInt(maxRes.rows[0].mx, 10);
    return `${key}-${Math.max(900, mx + 1)}`;
  }

  // Column list returned by INSERT so we can build the response without a
  // re-SELECT. A brand-new task has no comments/attachments and exactly the one
  // activity row we write here, so the old task()+_hydrate() (5 extra queries,
  // 4 of them a parallel fan-out) was pure overhead on the hot insert path.
  static get _TASK_COLS() {
    return `id, project_id, story_id, title, description, notes,
            status, priority, assignee_id, branch, merge_state, from_request_id,
            blocked_reason, created_at, updated_at`;
  }

  // Insert one task + its deps + the "created" activity row on a single client
  // (caller owns the transaction). Returns the hydrated-shape task object.
  async _insertTaskOnClient(client, data, actorId) {
    const id = data.id || await this._nextTaskIdOnClient(client, data.project_id);
    const taskRes = await client.query(
      // created_at/updated_at: honour supplied values (historical imports),
      // else COALESCE to now() so normal creates keep DB-default timestamps.
      `INSERT INTO tasks
         (id, project_id, story_id, title, description, notes,
          status, priority, assignee_id, branch, merge_state, from_request_id,
          blocked_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               COALESCE($14::timestamptz, now()),
               COALESCE($15::timestamptz, $14::timestamptz, now()))
       RETURNING ${PgStore._TASK_COLS}`,
      [
        id,
        data.project_id,
        data.story_id || null,
        data.title,
        data.description || '',
        data.notes || '',
        data.status      || 'backlog',
        data.priority    || 'medium',
        data.assignee_id || null,
        data.branch      || null,
        data.merge_state || 'none',
        data.from_request_id || null,
        data.blocked_reason || null,
        data.created_at || null,
        data.updated_at || null,
      ]
    );
    const deps = data.deps || [];
    for (const dep of deps) {
      await client.query(
        `INSERT INTO task_deps (task_id, depends_on) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, dep]
      );
    }
    const actRes = await client.query(
      `INSERT INTO activity (entity_type, entity_id, actor_id, text)
       VALUES ('task', $1, $2, 'created this ticket')
       RETURNING id, entity_type, entity_id, actor_id, text, created_at`,
      [id, actorId]
    );
    return {
      ...taskRes.rows[0],
      deps:        deps.slice(),
      comments:    [],
      activity:    [actRes.rows[0]],
      attachments: [],
    };
  }

  async createTask(data, actorId) {
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      const task = await this._insertTaskOnClient(client, data, actorId);
      await client.query('COMMIT');
      return task;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // Bulk-insert many tasks in ONE transaction on ONE connection. Each item is
  // wrapped in a SAVEPOINT so a single bad row (FK violation, etc.) is isolated
  // instead of poisoning the whole batch. Idempotent: an item whose explicit id
  // already exists is skipped. Returns { created:[ids], skipped:[ids], errors }.
  async createTasksBulk(projectId, items, actorId) {
    const created = [], skipped = [], errors = [];
    // Generate ids for id-less items within the batch from a single running
    // counter (a per-item SELECT MAX would race against uncommitted siblings).
    let genKey = null, genNum = null;
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      for (const data of items) {
        const ref = data.id || data.title || '(untitled)';
        await client.query('SAVEPOINT sp');
        try {
          if (data.id) {
            const dup = await client.query(`SELECT 1 FROM tasks WHERE id = $1`, [data.id]);
            if (dup.rowCount) { skipped.push(data.id); await client.query('RELEASE SAVEPOINT sp'); continue; }
          }
          let id = data.id;
          if (!id) {
            if (genKey === null) {
              const pj = await client.query(`SELECT key FROM projects WHERE id = $1`, [projectId]);
              if (!pj.rows[0]) throw new Error(`unknown project: ${projectId}`);
              genKey = pj.rows[0].key;
              // Same robust pattern as _nextTaskIdOnClient: only the generated
              // `<KEY>-<digits>` ids feed the cast, so a hierarchical id in the
              // project can't 500 the batch.
              const mx = await client.query(
                `SELECT COALESCE(MAX(substring(id from '^' || $2 || '-([0-9]+)$')::int), 899) AS mx
                   FROM tasks
                  WHERE project_id = $1
                    AND id ~ ('^' || $2 || '-[0-9]+$')`,
                [projectId, genKey]
              );
              genNum = Math.max(900, parseInt(mx.rows[0].mx, 10) + 1);
            }
            id = `${genKey}-${genNum++}`;
          }
          const task = await this._insertTaskOnClient(client, { ...data, id, project_id: projectId }, actorId);
          created.push(task.id);
          await client.query('RELEASE SAVEPOINT sp');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT sp');
          errors.push({ ref, error: (e && e.message) || 'insert failed' });
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    return { created, skipped, errors };
  }

  async updateTask(id, patch, actorId, logText) {
    const { deps, ...fields } = patch;
    const allowed = [
      'title', 'description', 'notes', 'status', 'priority',
      'assignee_id', 'branch', 'merge_state', 'from_request_id',
      'story_id', 'project_id', 'blocked_reason',
    ];

    // Reject a dependency change that would create a cycle (A→B→…→A) before we
    // touch anything, so the graph stays acyclic and blockersOf can't loop.
    if (deps !== undefined) {
      const bad = await this.wouldCreateCycle(id, deps);
      if (bad) { const e = new Error(`dependency cycle: ${id} ↔ ${bad}`); e.code = 'CYCLE'; throw e; }
    }

    const setCols = Object.keys(fields).filter((k) => allowed.includes(k));
    if (setCols.length > 0) {
      const setClause = setCols.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const vals = setCols.map((k) => fields[k]);
      const affected = await this._q(
        `UPDATE tasks SET ${setClause}, updated_at = now() WHERE id = $1`,
        [id, ...vals]
      );
      if (affected.rowCount === 0) return null;
    } else {
      const check = await this._q(`SELECT id FROM tasks WHERE id = $1`, [id]);
      if (check.rowCount === 0) return null;
    }

    if (deps !== undefined) {
      await this._q(`DELETE FROM task_deps WHERE task_id = $1`, [id]);
      for (const dep of deps) {
        await this._q(
          `INSERT INTO task_deps (task_id, depends_on) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, dep]
        );
      }
    }

    if (logText) await this.log('task', id, actorId, logText);
    // If this update closed the task, anything it was blocking may now be free.
    if (fields.status === 'done') await this._signalUnblocked(id, actorId);
    return this.task(id);
  }

  // Does adding edges id→dep (for each dep) create a cycle? Returns the first
  // offending dep id, or null. A cycle forms iff some new blocker can already
  // reach `id` by following depends_on edges.
  async wouldCreateCycle(id, deps) {
    for (const dep of (deps || [])) {
      if (dep === id) return dep;
      const seen = new Set();
      const stack = [dep];
      while (stack.length) {
        const n = stack.pop();
        if (n === id) return dep;
        if (seen.has(n)) continue;
        seen.add(n);
        const { rows } = await this._q(`SELECT depends_on FROM task_deps WHERE task_id = $1`, [n]);
        for (const r of rows) stack.push(r.depends_on);
      }
    }
    return null;
  }

  // When `blockerId` is completed, log an "unblocked" line on each task that was
  // blocked by it and now has no remaining open (non-done) task-blockers.
  async _signalUnblocked(blockerId, actorId) {
    try {
      const { rows } = await this._q(
        `SELECT task_id FROM task_deps WHERE depends_on = $1`, [blockerId]
      );
      for (const { task_id } of rows) {
        const open = await this._q(
          `SELECT 1 FROM task_deps d JOIN tasks t ON t.id = d.depends_on
            WHERE d.task_id = $1 AND t.status <> 'done' LIMIT 1`, [task_id]
        );
        if (open.rowCount === 0) {
          await this.log('task', task_id, actorId, `unblocked — ${blockerId} is done`);
        }
      }
    } catch (_) { /* never let the unblock signal break the main update */ }
  }

  async deleteTask(id) {
    await this._q(`DELETE FROM tasks WHERE id = $1`, [id]);
    return true;
  }

  // ---- comments ----
  async addComment(taskId, authorId, body) {
    const { rows } = await this._q(
      `INSERT INTO comments (task_id, author_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, task_id, author_id, body, created_at`,
      [taskId, authorId, body]
    );
    await this.log('task', taskId, authorId, 'left a message');
    return rows[0];
  }

  // ---- requests ----
  async requestsFor(projectId) {
    const { rows } = await this._q(
      `SELECT id, from_project_id, to_project_id, title, description,
              priority, requested_by, assignee_id, linked_task_id,
              spawned_task_id, status, created_at, updated_at
         FROM requests
        WHERE from_project_id = $1 OR to_project_id = $1
        ORDER BY created_at`,
      [projectId]
    );
    return Promise.all(rows.map((r) => this._hydrateRequest(r)));
  }

  async request(id) {
    const { rows } = await this._q(
      `SELECT id, from_project_id, to_project_id, title, description,
              priority, requested_by, assignee_id, linked_task_id,
              spawned_task_id, status, created_at, updated_at
         FROM requests WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  // Attach the request's activity feed and attachments.
  async _hydrateRequest(r) {
    if (!r) return r;
    const [actRes, attachRes] = await Promise.all([
      this._q(
        `SELECT id, entity_type, entity_id, actor_id, text, created_at
           FROM activity
          WHERE entity_type = 'request' AND entity_id = $1
          ORDER BY created_at`,
        [r.id]
      ),
      this._q(
        `SELECT id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at
           FROM attachments WHERE entity_type = 'request' AND entity_id = $1
          ORDER BY created_at`,
        [r.id]
      ),
    ]);
    return { ...r, activity: actRes.rows, attachments: attachRes.rows };
  }

  async nextRequestId() {
    const { rows } = await this._q(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(id, '-', 2) AS INTEGER)), 199) AS mx FROM requests`
    );
    return `REQ-${Math.max(200, parseInt(rows[0].mx, 10) + 1)}`;
  }

  async createRequest(data, actorId) {
    const id = await this.nextRequestId();
    const projRes = await this._q(
      `SELECT name FROM projects WHERE id = $1`, [data.to_project_id]
    );
    const targetName = projRes.rows[0] ? projRes.rows[0].name : data.to_project_id;
    await this._q(
      `INSERT INTO requests
         (id, from_project_id, to_project_id, title, description,
          priority, requested_by, assignee_id, linked_task_id, spawned_task_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'incoming')`,
      [
        id,
        data.from_project_id,
        data.to_project_id,
        data.title,
        data.description || '',
        data.priority || 'medium',
        actorId,
        null,
        data.linked_task_id || null,
        null,
      ]
    );
    await this.log('request', id, actorId, `raised this request to ${targetName}`);
    return this._hydrateRequest(await this.request(id));
  }

  /**
   * Apply a lifecycle action to a request.
   * 'accept' also SPAWNS a card on the assigned team's board and links it.
   * Returns { request, spawnedTask? }.
   */
  async actOnRequest(id, action, actorId) {
    const r = await this.request(id);
    if (!r) return null;

    if (action === 'accept') {
      const spawned = await this.createTask({
        project_id: r.to_project_id,
        story_id: null,
        title: r.title,
        description: r.description,
        status: 'todo',
        priority: r.priority,
        assignee_id: actorId,
        notes: `Spawned from cross-team request ${r.id}.`,
        from_request_id: r.id,
      }, actorId);
      await this._q(
        `UPDATE requests
            SET status = 'accepted', assignee_id = $1, spawned_task_id = $2, updated_at = now()
          WHERE id = $3`,
        [actorId, spawned.id, id]
      );
      await this.log('request', id, actorId, `accepted the request — created ${spawned.id}`);
      const updatedRequest = await this._hydrateRequest(await this.request(id));
      return { request: updatedRequest, spawnedTask: spawned };
    }

    const map = {
      decline: ['declined',    'declined the request'],
      start:   ['in_progress', 'moved to In Progress'],
      done:    ['done',        'marked the request done'],
      cancel:  ['declined',    'withdrew the request'],
    };
    const m = map[action];
    if (!m) return { request: await this._hydrateRequest(r) };
    await this._q(
      `UPDATE requests SET status = $1, updated_at = now() WHERE id = $2`,
      [m[0], id]
    );
    await this.log('request', id, actorId, m[1]);
    const updatedRequest = await this._hydrateRequest(await this.request(id));
    return { request: updatedRequest };
  }

  // ---- attachments ----
  async createAttachment({ entity_type, entity_id, filename, content_type, size_bytes, storage_key, uploaded_by }) {
    const { rows } = await this._q(
      `INSERT INTO attachments (entity_type, entity_id, filename, content_type, size_bytes, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, entity_type, entity_id, filename, content_type, size_bytes, storage_key, uploaded_by, created_at`,
      [entity_type, entity_id, filename, content_type || null, size_bytes, storage_key, uploaded_by || null]
    );
    return rows[0];
  }

  async attachment(id) {
    const { rows } = await this._q(
      `SELECT id, entity_type, entity_id, filename, content_type, size_bytes, storage_key, uploaded_by, created_at
         FROM attachments WHERE id = $1`,
      [id]
    );
    return rows[0] || null;
  }

  async attachmentsFor(entityType, entityId) {
    const { rows } = await this._q(
      `SELECT id, entity_type, entity_id, filename, content_type, size_bytes, uploaded_by, created_at
         FROM attachments WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at`,
      [entityType, entityId]
    );
    return rows;
  }

  async deleteAttachment(id) {
    const { rowCount } = await this._q(`DELETE FROM attachments WHERE id = $1`, [id]);
    return rowCount > 0;
  }

  // ---- provision tokens ----
  async createProvisionToken({ label, scope, token_hash, token_prefix }) {
    const { rows } = await this._q(
      `INSERT INTO provision_tokens (label, token_hash, token_prefix, scope)
       VALUES ($1, $2, $3, $4)
       RETURNING id, label, token_prefix, scope, created_at`,
      [label, token_hash, token_prefix, JSON.stringify(scope || [])]
    );
    return rows[0];
  }

  async listProvisionTokens() {
    const { rows } = await this._q(
      `SELECT id, label, token_prefix, scope, created_at FROM provision_tokens ORDER BY id`
    );
    return rows;
  }

  async provisionTokenByPrefix(prefix) {
    const { rows } = await this._q(
      `SELECT id, label, token_hash, token_prefix, scope, created_at
         FROM provision_tokens WHERE token_prefix = $1`,
      [prefix]
    );
    return rows[0] || null;
  }

  async deleteProvisionToken(id) {
    const { rowCount } = await this._q(`DELETE FROM provision_tokens WHERE id = $1`, [id]);
    return rowCount > 0;
  }
}

// ============================================================
//  Export the right store based on the environment.
// ============================================================
module.exports = {
  store: process.env.DATABASE_URL ? new PgStore() : new MemoryStore(),
};

/* ============================================================
   api.js — REST layer for the Kanban frontend
   Plain JS, no JSX, no build step. Exposes window.API.

   Golden rule: all snake_case ↔ camelCase translation is
   isolated here. Components stay pure camelCase; the API/DB
   stays pure snake_case; nothing else does translation.
   ============================================================ */

(function () {
  /* ----------------------------------------------------------
     Field maps (camel → snake)
     Each map is an array of [camelKey, snakeKey] pairs so we
     can invert cheaply. Keys not in the map pass through as-is
     (they're the same in both forms, e.g. id, title, status).
  ---------------------------------------------------------- */

  const TASK_MAP = [
    ["projectId",     "project_id"],
    ["storyId",       "story_id"],
    ["desc",          "description"],
    ["assignee",      "assignee_id"],
    ["mergeState",    "merge_state"],
    ["fromRequestId", "from_request_id"],
    ["createdAt",     "created_at"],
    ["updatedAt",     "updated_at"],
  ];

  const COMMENT_MAP = [
    ["who",  "author_id"],
    ["text", "body"],
    ["ts",   "created_at"],
  ];

  const ACTIVITY_MAP = [
    ["who", "actor_id"],
    ["ts",  "created_at"],
    // "text" is the same on both sides
  ];

  const REQUEST_MAP = [
    ["fromProject",    "from_project_id"],
    ["toProject",      "to_project_id"],
    ["desc",           "description"],
    ["requestedBy",    "requested_by"],
    ["assignee",       "assignee_id"],
    ["linkedTaskId",   "linked_task_id"],
    ["spawnedTaskId",  "spawned_task_id"],
    ["createdAt",      "created_at"],
  ];

  const EPIC_MAP = [
    ["projectId", "project_id"],
  ];

  const STORY_MAP = [
    ["epicId", "epic_id"],
  ];

  const PROJECT_MAP = [
    ["desc", "description"],
    ["openTaskCount", "open_task_count"],
  ];

  const AGENT_MAP = [
    // token_prefix → token (frontend shows the prefix as if it were the full token)
    ["token",   "token_prefix"],
    ["isAdmin", "is_admin"],
  ];

  // New field maps for RBAC + attachments
  const ATTACHMENT_MAP = [
    ["entityType",  "entity_type"],
    ["contentType", "content_type"],
    ["sizeBytes",   "size_bytes"],
    ["uploadedBy",  "uploaded_by"],
    ["createdAt",   "created_at"],
    // id, filename pass through as-is
  ];

  const PERMISSION_MAP = [
    ["projectId", "project_id"],
    // access passes through
  ];

  const ME_MAP = [
    ["isAdmin", "is_admin"],
    // id, name, role pass through; permissions array handled separately
  ];

  // ProvisionToken scope items also use max_access ↔ maxAccess
  const PROVISION_TOKEN_MAP = [
    ["tokenPrefix", "token_prefix"],
    ["createdAt",   "created_at"],
  ];

  const PROVISION_TOKEN_SCOPE_MAP = [
    ["projectId", "project_id"],
    ["maxAccess", "max_access"],
  ];

  /* ----------------------------------------------------------
     Generic translator builders
     applyMap(obj, pairs, direction)
       direction 'from': snake key → camel key
       direction 'to':   camel key → snake key
  ---------------------------------------------------------- */

  function applyMap(obj, pairs, direction) {
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const result = {};
    // Build a rename lookup for this direction
    const rename = {};
    pairs.forEach(function (pair) {
      const camel = pair[0];
      const snake = pair[1];
      if (direction === "from") {
        rename[snake] = camel; // snake → camel
      } else {
        rename[camel] = snake; // camel → snake
      }
    });
    Object.keys(obj).forEach(function (k) {
      const newKey = rename.hasOwnProperty(k) ? rename[k] : k;
      result[newKey] = obj[k];
    });
    return result;
  }

  function translateArray(arr, translateFn) {
    if (!Array.isArray(arr)) return arr;
    return arr.map(translateFn);
  }

  /* ----------------------------------------------------------
     fromApi: snake → camel  (applied to everything READ)
  ---------------------------------------------------------- */

  function fromApiComment(obj) {
    return applyMap(obj, COMMENT_MAP, "from");
  }

  function fromApiActivity(obj) {
    return applyMap(obj, ACTIVITY_MAP, "from");
  }

  function fromApiAttachment(obj) {
    if (!obj) return obj;
    return applyMap(obj, ATTACHMENT_MAP, "from");
  }

  function fromApiPermission(obj) {
    if (!obj) return obj;
    return applyMap(obj, PERMISSION_MAP, "from");
  }

  function fromApiMe(obj) {
    if (!obj) return obj;
    const m = applyMap(obj, ME_MAP, "from");
    if (Array.isArray(m.permissions)) {
      m.permissions = translateArray(m.permissions, fromApiPermission);
    }
    return m;
  }

  function fromApiProvisionToken(obj) {
    if (!obj) return obj;
    const t = applyMap(obj, PROVISION_TOKEN_MAP, "from");
    // Translate scope array items
    if (Array.isArray(t.scope)) {
      t.scope = translateArray(t.scope, function (s) {
        return applyMap(s, PROVISION_TOKEN_SCOPE_MAP, "from");
      });
    }
    return t;
  }

  function fromApiTask(obj) {
    if (!obj) return obj;
    const t = applyMap(obj, TASK_MAP, "from");
    if (Array.isArray(t.comments)) {
      t.comments = translateArray(t.comments, fromApiComment);
    }
    if (Array.isArray(t.activity)) {
      t.activity = translateArray(t.activity, fromApiActivity);
    }
    if (Array.isArray(t.attachments)) {
      t.attachments = translateArray(t.attachments, fromApiAttachment);
    }
    return t;
  }

  function fromApiRequest(obj) {
    if (!obj) return obj;
    const r = applyMap(obj, REQUEST_MAP, "from");
    if (Array.isArray(r.activity)) {
      r.activity = translateArray(r.activity, fromApiActivity);
    }
    if (Array.isArray(r.attachments)) {
      r.attachments = translateArray(r.attachments, fromApiAttachment);
    }
    return r;
  }

  function fromApiEpic(obj) {
    return applyMap(obj, EPIC_MAP, "from");
  }

  function fromApiStory(obj) {
    return applyMap(obj, STORY_MAP, "from");
  }

  function fromApiProject(obj) {
    return applyMap(obj, PROJECT_MAP, "from");
  }

  function fromApiAgent(obj) {
    return applyMap(obj, AGENT_MAP, "from");
  }

  /* ----------------------------------------------------------
     fromApi: top-level dispatcher
     Handles Task, Request, Comment, Activity, Epic, Story,
     Project, Agent, and plain wrapper objects from the API.
  ---------------------------------------------------------- */
  function fromApi(obj) {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(fromApi);
    // Objects are typed by duck-typing on key sets — kept simple
    // since the caller usually knows the type and calls the
    // typed helpers. The public fromApi is mainly used for the
    // generic request() helper's return value.
    return obj; // passthrough; callers use typed helpers below
  }

  /* ----------------------------------------------------------
     toApi: camel → snake  (applied to everything SENT)
  ---------------------------------------------------------- */

  function toApiTask(obj) {
    if (!obj) return obj;
    return applyMap(obj, TASK_MAP, "to");
  }

  function toApiRequest(obj) {
    if (!obj) return obj;
    return applyMap(obj, REQUEST_MAP, "to");
  }

  function toApiProvisionTokenScope(arr) {
    if (!Array.isArray(arr)) return arr;
    return translateArray(arr, function (s) {
      return applyMap(s, PROVISION_TOKEN_SCOPE_MAP, "to");
    });
  }

  /* ----------------------------------------------------------
     Token store
  ---------------------------------------------------------- */
  var _token = null;
  try { _token = localStorage.getItem("kanban_token"); } catch (e) {}

  function setToken(t) {
    _token = t;
    try { localStorage.setItem("kanban_token", t); } catch (e) {}
  }

  function clearToken() {
    _token = null;
    try { localStorage.removeItem("kanban_token"); } catch (e) {}
  }

  function getToken() {
    return _token;
  }

  /* ----------------------------------------------------------
     request(method, path, body?) — core fetch helper
     - prefixes /api
     - attaches Bearer token when present
     - toApi(body) for writes; fromApi is NOT called here —
       callers use the typed fromApi* helpers on the result so
       nested arrays are translated correctly
     - returns parsed JSON (or null for 204)
     - throws Error with server message on non-2xx
  ---------------------------------------------------------- */
  async function request(method, path, body) {
    const url = "/api" + path;
    const headers = { "Content-Type": "application/json" };
    if (_token) {
      headers["Authorization"] = "Bearer " + _token;
    }

    var opts = { method: method, headers: headers };
    if (body !== undefined && method !== "GET" && method !== "DELETE") {
      opts.body = JSON.stringify(body);
    }

    var resp = await fetch(url, opts);
    if (resp.status === 204) return null;

    var text = await resp.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!resp.ok) {
      var msg = (data && data.error) || (data && data.message) || text || ("HTTP " + resp.status);
      throw new Error(msg);
    }

    return data;
  }

  /* ----------------------------------------------------------
     requestMultipart(method, path, formData) — multipart helper
     - Does NOT set Content-Type (browser sets multipart boundary)
     - Attaches Bearer token
     - Returns parsed JSON or null for 204
     - Throws on non-2xx
  ---------------------------------------------------------- */
  async function requestMultipart(method, path, formData) {
    const url = "/api" + path;
    const headers = {};
    if (_token) {
      headers["Authorization"] = "Bearer " + _token;
    }

    var resp = await fetch(url, { method: method, headers: headers, body: formData });
    if (resp.status === 204) return null;

    var text = await resp.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = text; }

    if (!resp.ok) {
      var msg = (data && data.error) || (data && data.message) || text || ("HTTP " + resp.status);
      throw new Error(msg);
    }

    return data;
  }

  /* ----------------------------------------------------------
     Auth endpoints
  ---------------------------------------------------------- */

  async function login(password) {
    var data = await request("POST", "/auth/login", { password: password });
    // data: { ok, actor: {id, name, role}, token }
    if (data && data.token) setToken(data.token);
    return data;
  }

  async function loginToken(token) {
    var data = await request("POST", "/auth/token", { token: token });
    // data: { ok, actor: {id, name, role}, token }
    if (data && data.token) setToken(data.token);
    return data;
  }

  /* ----------------------------------------------------------
     Account — password change + passkeys (WebAuthn)
     These pass through snake_case bodies directly (no field map).
  ---------------------------------------------------------- */

  async function changePassword(current, next) {
    return request("POST", "/me/password", { current_password: current, new_password: next });
  }

  // Enrol a passkey for the signed-in account. Requires SimpleWebAuthnBrowser
  // (loaded from CDN in Kanban.html). Returns the created credential summary.
  async function registerPasskey(label) {
    var start = await request("POST", "/webauthn/register/options");
    var attResp = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: start.options });
    return request("POST", "/webauthn/register/verify", { flow: start.flow, response: attResp, label: label });
  }

  // Passwordless sign-in with a passkey. Sets the token on success.
  async function loginPasskey() {
    var start = await request("POST", "/webauthn/authenticate/options");
    var asResp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: start.options });
    var data = await request("POST", "/webauthn/authenticate/verify", { flow: start.flow, response: asResp });
    if (data && data.token) setToken(data.token);
    return data;
  }

  async function listPasskeys() {
    return request("GET", "/webauthn/credentials");
  }

  async function deletePasskey(id) {
    await request("DELETE", "/webauthn/credentials/" + encodeURIComponent(id));
  }

  /* ----------------------------------------------------------
     /me — current actor identity + permissions
  ---------------------------------------------------------- */

  async function me() {
    var data = await request("GET", "/me");
    return fromApiMe(data);
  }

  /* ----------------------------------------------------------
     Reference data
  ---------------------------------------------------------- */

  async function getAgents() {
    var data = await request("GET", "/agents");
    return Array.isArray(data) ? data.map(fromApiAgent) : [];
  }

  async function getProjects() {
    var data = await request("GET", "/projects");
    return Array.isArray(data) ? data.map(fromApiProject) : [];
  }

  async function createProject(fields) {
    // fields camelCase: { id, name, key, color, desc } — translate desc→description
    var body = applyMap(fields, PROJECT_MAP, "to");
    var data = await request("POST", "/projects", body);
    return fromApiProject(data);
  }

  async function getEpics(projectId) {
    var data = await request("GET", "/projects/" + projectId + "/epics");
    return Array.isArray(data) ? data.map(fromApiEpic) : [];
  }

  async function createEpic(projectId, fields) {
    // fields camelCase: { id, title }; id/title pass through unchanged
    var data = await request("POST", "/projects/" + projectId + "/epics", { id: fields.id, title: fields.title });
    return fromApiEpic(data);
  }

  async function getStories(epicId) {
    var data = await request("GET", "/epics/" + epicId + "/stories");
    return Array.isArray(data) ? data.map(fromApiStory) : [];
  }

  async function createStory(epicId, fields) {
    var data = await request("POST", "/epics/" + epicId + "/stories", { id: fields.id, title: fields.title });
    return fromApiStory(data);
  }

  /* ----------------------------------------------------------
     Tasks
  ---------------------------------------------------------- */

  async function getTasks(projectId) {
    var data = await request("GET", "/projects/" + projectId + "/tasks");
    return Array.isArray(data) ? data.map(fromApiTask) : [];
  }

  async function getTask(id) {
    var data = await request("GET", "/tasks/" + id);
    return fromApiTask(data);
  }

  async function createTask(projectId, fields) {
    // fields is camelCase; translate before sending
    var body = toApiTask(fields);
    var data = await request("POST", "/projects/" + projectId + "/tasks", body);
    return fromApiTask(data);
  }

  async function updateTask(id, patch, log) {
    // patch is camelCase; translate snake_case for the API
    // _log is a raw string and must NOT be translated
    var body = toApiTask(patch);
    if (log !== undefined && log !== null) {
      body._log = log; // pass through untranslated
    }
    var data = await request("PATCH", "/tasks/" + id, body);
    return fromApiTask(data);
  }

  async function deleteTask(id) {
    await request("DELETE", "/tasks/" + id);
  }

  async function addComment(taskId, body) {
    // API expects { body: "..." } in snake_case
    var data = await request("POST", "/tasks/" + taskId + "/comments", { body: body });
    // The API returns 201 Comment (snake_case); translate it
    return fromApiComment(data);
  }

  /* ----------------------------------------------------------
     Requests
  ---------------------------------------------------------- */

  async function getRequests(projectId) {
    var data = await request("GET", "/projects/" + projectId + "/requests");
    return Array.isArray(data) ? data.map(fromApiRequest) : [];
  }

  async function createRequest(fields) {
    var body = toApiRequest(fields);
    var data = await request("POST", "/requests", body);
    return fromApiRequest(data);
  }

  async function requestAction(id, action) {
    var data = await request("POST", "/requests/" + id + "/actions", { action: action });
    // Returns { request, spawnedTask? }
    var result = {};
    if (data && data.request) result.request = fromApiRequest(data.request);
    if (data && data.spawnedTask) result.spawnedTask = fromApiTask(data.spawnedTask);
    // Also handle snake_case variant the backend might emit
    if (data && data.spawned_task) result.spawnedTask = fromApiTask(data.spawned_task);
    return result;
  }

  /* ----------------------------------------------------------
     Attachments
  ---------------------------------------------------------- */

  async function uploadTaskAttachment(taskId, file) {
    var fd = new FormData();
    fd.append("file", file);
    var data = await requestMultipart("POST", "/tasks/" + taskId + "/attachments", fd);
    return fromApiAttachment(data);
  }

  async function uploadRequestAttachment(reqId, file) {
    var fd = new FormData();
    fd.append("file", file);
    var data = await requestMultipart("POST", "/requests/" + reqId + "/attachments", fd);
    return fromApiAttachment(data);
  }

  // Returns a Blob. The caller creates an object URL and triggers a download.
  // A plain <a href> would 401 because the auth header is required.
  async function downloadAttachment(id) {
    const url = "/api/attachments/" + id;
    const headers = {};
    if (_token) {
      headers["Authorization"] = "Bearer " + _token;
    }
    var resp = await fetch(url, { method: "GET", headers: headers });
    if (!resp.ok) {
      var text = await resp.text();
      var data;
      try { data = JSON.parse(text); } catch (e) { data = text; }
      var msg = (data && data.error) || (data && data.message) || text || ("HTTP " + resp.status);
      throw new Error(msg);
    }
    return resp.blob();
  }

  async function deleteAttachment(id) {
    await request("DELETE", "/attachments/" + id);
  }

  /* ----------------------------------------------------------
     Permissions
  ---------------------------------------------------------- */

  async function getPermissions(agentId) {
    var data = await request("GET", "/agents/" + agentId + "/permissions");
    // Returns { agent_id, is_admin, permissions:[{project_id, access}] }
    if (!data) return data;
    var result = {
      agentId: data.agent_id !== undefined ? data.agent_id : data.agentId,
      isAdmin: data.is_admin !== undefined ? data.is_admin : data.isAdmin,
      permissions: Array.isArray(data.permissions)
        ? translateArray(data.permissions, fromApiPermission)
        : [],
    };
    return result;
  }

  async function setPermission(agentId, projectId, access) {
    // PUT /api/agents/:id/permissions/:projectId { access }
    var data = await request("PUT", "/agents/" + agentId + "/permissions/" + projectId, { access: access });
    // Returns updated permission list
    if (Array.isArray(data)) {
      return translateArray(data, fromApiPermission);
    }
    return data;
  }

  async function patchAgent(agentId, fields) {
    // PATCH /api/agents/:id { is_admin?, name?, role? }
    // fields are camelCase — translate is_admin
    var body = {};
    if (fields.isAdmin !== undefined) body.is_admin = fields.isAdmin;
    if (fields.name !== undefined) body.name = fields.name;
    if (fields.role !== undefined) body.role = fields.role;
    var data = await request("PATCH", "/agents/" + agentId, body);
    return fromApiAgent(data);
  }

  /* ----------------------------------------------------------
     Agent provisioning
  ---------------------------------------------------------- */

  async function provisionAgent(fields) {
    // POST /api/agents { id, name, role?, color?, initials?, grants?:[{project_id,access}] }
    // fields is camelCase
    var body = {
      id: fields.id,
      name: fields.name,
    };
    if (fields.role !== undefined) body.role = fields.role;
    if (fields.color !== undefined) body.color = fields.color;
    if (fields.initials !== undefined) body.initials = fields.initials;
    if (Array.isArray(fields.grants)) {
      // grants items use camelCase projectId — translate to snake
      body.grants = fields.grants.map(function (g) {
        return { project_id: g.projectId, access: g.access };
      });
    }
    var data = await request("POST", "/agents", body);
    // Returns { agent, token }
    var result = {};
    if (data && data.agent) result.agent = fromApiAgent(data.agent);
    if (data && data.token) result.token = data.token;
    return result;
  }

  async function mintAgentToken(agentId) {
    // POST /api/agents/:id/token -> { id, token }
    var data = await request("POST", "/agents/" + agentId + "/token");
    return data;
  }

  /* ----------------------------------------------------------
     Scoped provision tokens
  ---------------------------------------------------------- */

  async function listProvisionTokens() {
    var data = await request("GET", "/provision-tokens");
    return Array.isArray(data) ? data.map(fromApiProvisionToken) : [];
  }

  async function createProvisionToken(fields) {
    // POST /api/provision-tokens { label, scope:[{project_id, max_access}] }
    var body = {
      label: fields.label,
    };
    if (Array.isArray(fields.scope)) {
      // scope items are camelCase — translate to snake
      body.scope = fields.scope.map(function (s) {
        return { project_id: s.projectId, max_access: s.maxAccess };
      });
    } else {
      body.scope = [];
    }
    var data = await request("POST", "/provision-tokens", body);
    // Returns { id, label, scope, token } — token shown once
    if (!data) return data;
    var result = fromApiProvisionToken(data);
    // Preserve raw token (not in the map, just passes through)
    if (data.token !== undefined) result.token = data.token;
    return result;
  }

  async function deleteProvisionToken(id) {
    await request("DELETE", "/provision-tokens/" + id);
  }

  /* ----------------------------------------------------------
     Expose window.API
  ---------------------------------------------------------- */
  window.API = {
    // Token management
    setToken:      setToken,
    clearToken:    clearToken,
    getToken:      getToken,

    // Auth
    login:         login,
    loginToken:    loginToken,
    loginPasskey:  loginPasskey,

    // Account (password + passkeys)
    changePassword: changePassword,
    registerPasskey: registerPasskey,
    listPasskeys:    listPasskeys,
    deletePasskey:   deletePasskey,

    // Identity
    me:            me,

    // Reference data
    getAgents:     getAgents,
    getProjects:   getProjects,
    createProject: createProject,
    getEpics:      getEpics,
    createEpic:    createEpic,
    getStories:    getStories,
    createStory:   createStory,

    // Tasks
    getTasks:      getTasks,
    getTask:       getTask,
    createTask:    createTask,
    updateTask:    updateTask,
    deleteTask:    deleteTask,
    addComment:    addComment,

    // Requests
    getRequests:   getRequests,
    createRequest: createRequest,
    requestAction: requestAction,

    // Attachments
    uploadTaskAttachment:    uploadTaskAttachment,
    uploadRequestAttachment: uploadRequestAttachment,
    downloadAttachment:      downloadAttachment,
    deleteAttachment:        deleteAttachment,

    // Permissions
    getPermissions: getPermissions,
    setPermission:  setPermission,
    patchAgent:     patchAgent,

    // Agent provisioning
    provisionAgent: provisionAgent,
    mintAgentToken: mintAgentToken,

    // Provision tokens
    listProvisionTokens:  listProvisionTokens,
    createProvisionToken: createProvisionToken,
    deleteProvisionToken: deleteProvisionToken,

    // Translators (exported for testing / debugging)
    fromApiTask:            fromApiTask,
    fromApiRequest:         fromApiRequest,
    fromApiAgent:           fromApiAgent,
    fromApiProject:         fromApiProject,
    fromApiEpic:            fromApiEpic,
    fromApiStory:           fromApiStory,
    fromApiComment:         fromApiComment,
    fromApiActivity:        fromApiActivity,
    fromApiAttachment:      fromApiAttachment,
    fromApiPermission:      fromApiPermission,
    fromApiMe:              fromApiMe,
    fromApiProvisionToken:  fromApiProvisionToken,
    toApiTask:              toApiTask,
    toApiRequest:           toApiRequest,
  };
})();

/* ============================================================
   App: auth, shell, search/filter state, tweaks
   ============================================================ */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#D97757",
  "layout": "columns",
  "density": "comfortable",
  "epicStripe": true,
  "epicChips": true,
  "avatars": true,
  "sortByPriority": false
}/*EDITMODE-END*/;

/* ---------- Login ---------- */
function Login({ onAuth }) {
  const [mode, setMode] = useState("manager");
  const [pw, setPw] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      var data;
      if (mode === "manager") {
        if (pw.length < 1) { setErr("Enter your password"); setLoading(false); return; }
        data = await window.API.login(pw);
      } else {
        if (!token.trim()) { setErr("Enter your agent token"); setLoading(false); return; }
        data = await window.API.loginToken(token.trim());
      }
      // data: { ok, actor: {id, name, role}, token }
      // Fetch agents list to hydrate color/initials for the avatar
      var agents = [];
      try { agents = await window.API.getAgents(); } catch (_) {}
      var actorAgent = agents.find(function (a) { return a.id === data.actor.id; });
      if (!actorAgent) {
        // Build a minimal agent shape from the auth response
        actorAgent = {
          id: data.actor.id,
          name: data.actor.name,
          role: data.actor.role,
          kind: "human",
          color: "#D97757",
          initials: (data.actor.name || "?").slice(0, 2).toUpperCase(),
        };
      }
      // Fetch /me to get isAdmin + permissions
      var meData = null;
      try { meData = await window.API.me(); } catch (_) {}
      onAuth({ as: actorAgent, viaToken: mode === "agent", agents: agents, me: meData });
    } catch (ex) {
      setErr(ex.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">
          <span className="brandmark">▦</span>
          <div>
            <div className="brandname">Kanban</div>
            <div className="brandsub">Agent ticketing</div>
          </div>
        </div>
        <div className="login__tabs">
          <button className={mode === "manager" ? "is-on" : ""} onClick={() => { setMode("manager"); setErr(""); }}>
            <Icon name="lock" size={14} /> Manager
          </button>
          <button className={mode === "agent" ? "is-on" : ""} onClick={() => { setMode("agent"); setErr(""); }}>
            <Icon name="key" size={14} /> Agent token
          </button>
        </div>
        <form onSubmit={submit} className="login__form">
          {mode === "manager" ? (
            <label className="fld">
              <span className="fld__k">Password</span>
              <input type="password" className="textin" placeholder="••••••••" value={pw} onChange={(e) => setPw(e.target.value)} />
              <span className="fld__hint">Manager password set in server config.</span>
            </label>
          ) : (
            <label className="fld">
              <span className="fld__k">API token</span>
              <input className="textin mono" placeholder="agt_live_…" value={token} onChange={(e) => setToken(e.target.value)} />
              <span className="fld__hint">Agents authenticate with their key. Try <code>agt_live_9f3c</code> (Claude).</span>
            </label>
          )}
          {err && <div className="login__err">{err}</div>}
          <button className="btn btn--primary btn--block" type="submit" disabled={loading}>
            {loading ? "…" : (mode === "manager" ? "Sign in" : "Authenticate")}
          </button>
        </form>
        <div className="login__foot">Agents usually hit the API directly — this UI is mainly for the manager.</div>
      </div>
    </div>
  );
}

/* ---------- Filter bar bits ---------- */
function FilterChip({ label, active, options, value, onChange, renderOpt }) {
  return (
    <Menu width={220} trigger={
      <button type="button" className={`fchip ${active ? "is-on" : ""}`}>
        {label}{active && <span className="fchip__val">{active}</span>}
        <Icon name="chevron-down" size={13} />
      </button>
    }>
      <button className={`menu__item ${!value ? "is-active" : ""}`} onClick={() => onChange(null)}>All {label.toLowerCase()}</button>
      <div className="menu__sep" />
      {options.map((o) => (
        <button key={String(o.value)} className={`menu__item ${value === o.value ? "is-active" : ""}`} onClick={() => onChange(o.value)}>
          {renderOpt ? renderOpt(o) : o.label}
          {value === o.value && <span className="menu__check"><Icon name="check" size={14} /></span>}
        </button>
      ))}
    </Menu>
  );
}

/* ---------- Main app ---------- */
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [auth, setAuth] = useState(null);

  // --- Reference data (loaded after auth) ---
  const [agents, setAgents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [epics, setEpics] = useState([]);
  const [stories, setStories] = useState([]);

  // --- Live board data ---
  const [tasks, setTasks] = useState([]);
  const [requests, setRequests] = useState([]);

  // --- /me data (isAdmin + permissions) ---
  const [meInfo, setMeInfo] = useState(null);

  // --- Admin panel visibility ---
  const [showAdmin, setShowAdmin] = useState(false);

  // --- First-run onboarding + project creation ---
  const [firstRun, setFirstRun] = useState(null);   // null | 'active' | 'done'
  const [showNewProject, setShowNewProject] = useState(false);

  const [projectId, setProjectId] = useState("aws");
  const [q, setQ] = useState("");
  const [fAssignee, setFAssignee] = useState(null);
  const [fPriority, setFPriority] = useState(null);
  const [fEpic, setFEpic] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(null); // {status} or {mode:'request'} or null
  const [view, setView] = useState("board"); // board | inbox

  useEffect(() => { document.documentElement.style.setProperty("--accent", t.accent); }, [t.accent]);

  /* ----------------------------------------------------------
     Sync window.SEED with live state so component files that
     read window.SEED.PROJECTS / AGENTS / EPICS / STORIES
     directly (board.jsx, detail.jsx, requests.jsx) get fresh
     data without being edited.
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!window.SEED) window.SEED = {};
    if (agents.length)   window.SEED.AGENTS   = agents;
    if (projects.length) window.SEED.PROJECTS = projects;
  }, [agents, projects]);

  useEffect(() => {
    if (!window.SEED) window.SEED = {};
    if (epics.length)   window.SEED.EPICS   = epics;
    if (stories.length) window.SEED.STORIES = stories;
  }, [epics, stories]);

  /* ----------------------------------------------------------
     Initial data load: agents + projects (once, after auth)
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!auth) return;

    // If login already returned agents, use them; otherwise fetch
    var initialAgents = (auth.agents && auth.agents.length) ? auth.agents : null;

    // If login already fetched me, use it; otherwise fetch
    var initialMe = auth.me || null;

    async function loadReference() {
      try {
        var ag = initialAgents || await window.API.getAgents();
        setAgents(ag);
        var pr = await window.API.getProjects();
        setProjects(pr);
        // Default to first project if "aws" not found
        if (pr.length && !pr.find(function (p) { return p.id === projectId; })) {
          setProjectId(pr[0].id);
        }
      } catch (ex) {
        console.error("Failed to load reference data:", ex);
      }

      // Load /me if not already available
      if (initialMe) {
        setMeInfo(initialMe);
      } else {
        try {
          var m = await window.API.me();
          setMeInfo(m);
        } catch (ex) {
          console.error("Failed to load /me:", ex);
        }
      }
    }

    loadReference();
  }, [auth]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----------------------------------------------------------
     Load epics + stories for the current project, then tasks
     and requests. Re-runs when projectId changes.
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!auth || !projectId) return;

    async function loadProjectData() {
      try {
        // Epics for this project
        var ep = await window.API.getEpics(projectId);
        setEpics(ep);

        // Stories for all epics of this project (parallel)
        var storyArrays = await Promise.all(
          ep.map(function (e) {
            return window.API.getStories(e.id).catch(function () { return []; });
          })
        );
        var allStories = [];
        storyArrays.forEach(function (arr) { allStories = allStories.concat(arr); });
        setStories(allStories);
      } catch (ex) {
        console.error("Failed to load epics/stories for", projectId, ex);
      }

      try {
        var tk = await window.API.getTasks(projectId);
        setTasks(tk);
      } catch (ex) {
        console.error("Failed to load tasks for", projectId, ex);
      }

      try {
        var rq = await window.API.getRequests(projectId);
        setRequests(rq);
      } catch (ex) {
        console.error("Failed to load requests for", projectId, ex);
      }
    }

    loadProjectData();
  }, [auth, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----------------------------------------------------------
     First-run: an admin on a fresh instance (no projects yet)
     gets the onboarding wizard. Triggered once meInfo has loaded.
  ---------------------------------------------------------- */
  useEffect(() => {
    if (firstRun === null && meInfo && meInfo.isAdmin && projects.length === 0) {
      setFirstRun("active");
    }
  }, [meInfo, projects, firstRun]);

  /* ----------------------------------------------------------
     Derived: current project object + epics for this project
  ---------------------------------------------------------- */
  const project = projects.find(function (p) { return p.id === projectId; }) || { id: projectId, name: projectId, key: projectId.toUpperCase(), color: "#9a938a", desc: "" };
  const epicsOfProject = epics.filter(function (e) { return e.projectId === projectId; });

  // Helper: resolve projectId from a task via story→epic chain
  function epicProject(tk) {
    if (tk.projectId) return tk.projectId;
    const st = stories.find(function (s) { return s.id === tk.storyId; });
    const ep = st && epics.find(function (e) { return e.id === st.epicId; });
    return ep ? ep.projectId : null;
  }

  // counts per project (open tickets) — only over loaded tasks
  const projCounts = useMemo(() => {
    const m = {};
    projects.forEach(function (p) {
      m[p.id] = tasks.filter(function (tk) {
        return epicProject(tk) === p.id && tk.status !== "done";
      }).length;
    });
    return m;
  }, [tasks, projects, epics, stories]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ----------------------------------------------------------
     Permission helpers derived from meInfo
     - canWrite(pid): admin → true; else check permissions array
     - canRead(pid):  admin → true; write implies read
  ---------------------------------------------------------- */
  const canWrite = useCallback(function (pid) {
    if (!meInfo) return true; // optimistic while loading
    if (meInfo.isAdmin) return true;
    const perm = (meInfo.permissions || []).find(function (p) { return p.projectId === pid; });
    return perm ? perm.access === "write" : false;
  }, [meInfo]);

  const canRead = useCallback(function (pid) {
    if (!meInfo) return true; // optimistic while loading
    if (meInfo.isAdmin) return true;
    const perm = (meInfo.permissions || []).find(function (p) { return p.projectId === pid; });
    return perm ? (perm.access === "read" || perm.access === "write") : false;
  }, [meInfo]);

  // ctx helpers
  const ctx = useMemo(() => {
    const taskById = (id) => tasks.find((x) => x.id === id);
    const storyOf = (tk) => stories.find((s) => s.id === tk.storyId);
    const epicOf = (tk) => { const s = storyOf(tk); return s && epics.find((e) => e.id === s.epicId); };
    const agentOf = (id) => agents.find((a) => a.id === id) || null;
    const blockersOf = (tk) => (tk.deps || []).filter((d) => { const dt = taskById(d); return dt && dt.status !== "done"; });
    const requestsForTask = (id) => requests.filter((r) => r.linkedTaskId === id);
    const openRequestsForTask = (id) => requests.filter((r) => r.linkedTaskId === id && r.status !== "done" && r.status !== "declined");
    return {
      taskById, storyOf, epicOf, agentOf, blockersOf, requestsForTask, openRequestsForTask,
      allTasks: tasks,
      density: t.density,
      opts: { epicStripe: t.epicStripe, epicChip: t.epicChips, avatars: t.avatars },
      filterEpic: (id) => setFEpic(id || null),
      // Permission helpers
      me: meInfo,
      canWrite: canWrite,
      canRead: canRead,
    };
  }, [tasks, requests, agents, epics, stories, t.density, t.epicStripe, t.epicChips, t.avatars, meInfo, canWrite, canRead]);

  // filtering
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((tk) => {
      if (epicProject(tk) !== projectId) return false;
      if (fAssignee !== null && tk.assignee !== fAssignee) return false;
      if (fPriority && tk.priority !== fPriority) return false;
      if (fEpic) { const st = stories.find((s) => s.id === tk.storyId); if (!st || st.epicId !== fEpic) return false; }
      if (needle) {
        const hay = `${tk.id} ${tk.title} ${tk.desc} ${tk.notes}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [tasks, projectId, q, fAssignee, fPriority, fEpic, stories, epics]); // eslint-disable-line react-hooks/exhaustive-deps

  const prioRank = (p) => (window.PRIORITIES.find((x) => x.id === p) || {}).rank ?? 9;
  const sortFn = (a, b) => t.sortByPriority ? prioRank(a.priority) - prioRank(b.priority) : 0;

  const tasksByCol = useMemo(() => {
    const m = {}; window.COLUMNS.forEach((c) => (m[c.id] = []));
    filtered.forEach((tk) => m[tk.status].push(tk));
    Object.values(m).forEach((arr) => arr.sort(sortFn));
    return m;
  }, [filtered, t.sortByPriority]);

  const lanes = useMemo(() => {
    const byEpic = {};
    filtered.forEach((tk) => {
      const st = stories.find((s) => s.id === tk.storyId);
      const eid = st ? st.epicId : "none";
      (byEpic[eid] = byEpic[eid] || []).push(tk);
    });
    return epicsOfProject.filter((e) => byEpic[e.id]).map((e) => {
      const arr = byEpic[e.id]; const byCol = {}; window.COLUMNS.forEach((c) => (byCol[c.id] = []));
      arr.forEach((tk) => byCol[tk.status].push(tk));
      Object.values(byCol).forEach((a) => a.sort(sortFn));
      return { epic: e, projName: project.name, byCol, total: arr.length };
    });
  }, [filtered, projectId, t.sortByPriority, epicsOfProject, stories]); // eslint-disable-line react-hooks/exhaustive-deps
  ctx.lanes = lanes;

  // mutations
  const whoAmI = auth ? auth.as.id : null;

  const patch = useCallback((id, partial, logText) => {
    async function doPatch() {
      try {
        const updated = await window.API.updateTask(id, partial, logText || null);
        setTasks((prev) => prev.map((tk) => tk.id === id ? updated : tk));
      } catch (ex) {
        console.error("patch failed:", ex);
      }
    }
    // Optimistic update so UI feels instant
    setTasks((prev) => prev.map((tk) => {
      if (tk.id !== id) return tk;
      const next = { ...tk, ...partial };
      if (logText) next.activity = [...(tk.activity || []), { ts: new Date().toISOString(), who: whoAmI, text: logText }];
      return next;
    }));
    doPatch();
  }, [whoAmI]);

  const addComment = useCallback((id, text) => {
    const body = text.trim();
    if (!body) return;
    async function doComment() {
      try {
        const comment = await window.API.addComment(id, body);
        // comment is a single translated Comment; merge into the task
        setTasks((prev) => prev.map((tk) => {
          if (tk.id !== id) return tk;
          return { ...tk, comments: [...(tk.comments || []), comment] };
        }));
      } catch (ex) {
        console.error("addComment failed:", ex);
        // Roll back optimistic update
        setTasks((prev) => prev.map((tk) => {
          if (tk.id !== id) return tk;
          const comments = (tk.comments || []).filter(function (c) { return c !== optimisticComment; });
          return { ...tk, comments: comments };
        }));
      }
    }
    // Optimistic: add immediately
    const optimisticComment = { who: whoAmI, ts: new Date().toISOString(), text: body };
    setTasks((prev) => prev.map((tk) => {
      if (tk.id !== id) return tk;
      return { ...tk, comments: [...(tk.comments || []), optimisticComment] };
    }));
    doComment();
  }, [whoAmI]);

  const moveTask = useCallback((id, status) => {
    if (!id) return;
    // Gate: check write permission on the task's project
    const fromTask = tasks.find(function (tk) { return tk.id === id; });
    if (!fromTask || fromTask.status === status) return;
    const taskPid = fromTask.projectId || epicProject(fromTask);
    if (!canWrite(taskPid)) return;
    const fromLabel = (window.COLUMNS.find((c) => c.id === fromTask.status) || {}).label || fromTask.status;
    const toLabel = (window.COLUMNS.find((c) => c.id === status) || {}).label || status;
    const logText = `moved ${fromLabel} → ${toLabel}`;
    // Optimistic
    setTasks((prev) => prev.map((tk) => {
      if (tk.id !== id || tk.status === status) return tk;
      return { ...tk, status, activity: [...(tk.activity || []), { ts: new Date().toISOString(), who: whoAmI, text: logText }] };
    }));
    async function doMove() {
      try {
        const updated = await window.API.updateTask(id, { status: status }, logText);
        setTasks((prev) => prev.map((tk) => tk.id === id ? updated : tk));
      } catch (ex) {
        console.error("moveTask failed:", ex);
        // Roll back
        setTasks((prev) => prev.map((tk) => tk.id === id ? fromTask : tk));
      }
    }
    doMove();
  }, [tasks, whoAmI, canWrite]);

  const createTask = (form) => {
    if (form.mode === "request") { createRequest(form); return; }
    async function doCreate() {
      try {
        const fields = {
          storyId:  form.storyId,
          title:    form.title.trim(),
          desc:     form.desc.trim(),
          status:   form.status,
          priority: form.priority,
          assignee: form.assignee,
          notes:    form.notes.trim(),
        };
        const newTask = await window.API.createTask(projectId, fields);
        setTasks((prev) => [...prev, newTask]);
        setCreating(null);
        setOpenId(newTask.id);
      } catch (ex) {
        console.error("createTask failed:", ex);
      }
    }
    doCreate();
  };

  const createRequest = (form) => {
    async function doCreate() {
      try {
        const fields = {
          toProject:    form.targetTeam,
          fromProject:  projectId,
          title:        form.title.trim(),
          desc:         form.desc.trim(),
          priority:     form.priority,
          requestedBy:  whoAmI,
          linkedTaskId: form.blocksTaskId || null,
        };
        const newReq = await window.API.createRequest(fields);
        setRequests((prev) => [...prev, newReq]);
        setCreating(null);
        setView("inbox");
      } catch (ex) {
        console.error("createRequest failed:", ex);
      }
    }
    doCreate();
  };

  const requestAction = (reqId, action) => {
    async function doAction() {
      try {
        const result = await window.API.requestAction(reqId, action);
        // result: { request, spawnedTask? }
        if (result.request) {
          setRequests((prev) => prev.map((r) => r.id === reqId ? result.request : r));
        }
        if (result.spawnedTask) {
          const spawned = result.spawnedTask;
          // Only add to tasks if it belongs to the current project
          const spawnedProjectId = spawned.projectId || epicProject(spawned);
          if (spawnedProjectId === projectId) {
            setTasks((prev) => {
              // Avoid duplicates
              if (prev.find(function (t) { return t.id === spawned.id; })) {
                return prev.map(function (t) { return t.id === spawned.id ? spawned : t; });
              }
              return [...prev, spawned];
            });
          }
        }
      } catch (ex) {
        console.error("requestAction failed:", ex);
      }
    }
    doAction();
  };

  const deleteTask = (id) => {
    async function doDelete() {
      try {
        await window.API.deleteTask(id);
        setTasks((prev) => prev.filter((x) => x.id !== id));
        setOpenId(null);
      } catch (ex) {
        console.error("deleteTask failed:", ex);
      }
    }
    doDelete();
  };

  /* ----------------------------------------------------------
     Attachment handlers — passed down to detail + inbox
  ---------------------------------------------------------- */
  const uploadTaskAttachment = useCallback((taskId, file) => {
    async function doUpload() {
      try {
        const attachment = await window.API.uploadTaskAttachment(taskId, file);
        // Merge new attachment into the task
        setTasks((prev) => prev.map((tk) => {
          if (tk.id !== taskId) return tk;
          return { ...tk, attachments: [...(tk.attachments || []), attachment] };
        }));
      } catch (ex) {
        console.error("uploadTaskAttachment failed:", ex);
        throw ex; // re-throw so the UI can show the error
      }
    }
    return doUpload();
  }, []);

  const uploadRequestAttachment = useCallback((reqId, file) => {
    async function doUpload() {
      try {
        const attachment = await window.API.uploadRequestAttachment(reqId, file);
        setRequests((prev) => prev.map((r) => {
          if (r.id !== reqId) return r;
          return { ...r, attachments: [...(r.attachments || []), attachment] };
        }));
      } catch (ex) {
        console.error("uploadRequestAttachment failed:", ex);
        throw ex;
      }
    }
    return doUpload();
  }, []);

  const deleteTaskAttachment = useCallback((taskId, attachmentId) => {
    async function doDelete() {
      try {
        await window.API.deleteAttachment(attachmentId);
        setTasks((prev) => prev.map((tk) => {
          if (tk.id !== taskId) return tk;
          return { ...tk, attachments: (tk.attachments || []).filter((a) => a.id !== attachmentId) };
        }));
      } catch (ex) {
        console.error("deleteTaskAttachment failed:", ex);
        throw ex;
      }
    }
    return doDelete();
  }, []);

  const deleteRequestAttachment = useCallback((reqId, attachmentId) => {
    async function doDelete() {
      try {
        await window.API.deleteAttachment(attachmentId);
        setRequests((prev) => prev.map((r) => {
          if (r.id !== reqId) return r;
          return { ...r, attachments: (r.attachments || []).filter((a) => a.id !== attachmentId) };
        }));
      } catch (ex) {
        console.error("deleteRequestAttachment failed:", ex);
        throw ex;
      }
    }
    return doDelete();
  }, []);

  /* ----------------------------------------------------------
     Project creation (admin). Returns a Promise<project> so the
     setup form can await it and surface server errors inline.
  ---------------------------------------------------------- */
  const createProject = useCallback((fields) => {
    return window.API.createProject(fields).then((proj) => {
      setProjects((prev) => prev.find((p) => p.id === proj.id) ? prev : [...prev, proj]);
      return proj;
    });
  }, []);

  const handleSignOut = () => {
    window.API.clearToken();
    setAuth(null);
    setMeInfo(null);
    setTasks([]);
    setRequests([]);
    setAgents([]);
    setProjects([]);
    setEpics([]);
    setStories([]);
  };

  if (!auth) return <Login onAuth={(authData) => setAuth(authData)} />;

  // First-run onboarding for an admin with no projects yet.
  if (firstRun === "active") {
    return (
      <FirstRunSetup
        projects={projects}
        onCreateProject={createProject}
        onOpenAdmin={() => { setFirstRun("done"); setShowAdmin(true); }}
        onFinish={(pid) => { if (pid) setProjectId(pid); setFirstRun("done"); }}
      />
    );
  }

  // Signed-in non-admin who can't read any project.
  if (meInfo && !meInfo.isAdmin && projects.length === 0) {
    return <NoAccessScreen agent={auth.as} onSignOut={handleSignOut} />;
  }

  const openTask = openId ? tasks.find((x) => x.id === openId) : null;
  const activeFilters = (fAssignee !== null ? 1 : 0) + (fPriority ? 1 : 0) + (fEpic ? 1 : 0);
  const myRequests = requests.filter((r) => r.fromProject === projectId || r.toProject === projectId);
  const inboxNew = requests.filter((r) => r.toProject === projectId && r.status === "incoming").length;
  const isAdmin = meInfo && meInfo.isAdmin;
  const writeOk = canWrite(projectId);

  return (
    <div className={`app density-${t.density}`}>
      {/* Sidebar */}
      <aside className="side">
        <div className="side__brand">
          <span className="brandmark">▦</span>
          <span className="brandname">Kanban</span>
        </div>
        <div className="side__label">Projects</div>
        <nav className="side__nav">
          {projects.map((p) => (
            <button key={p.id} className={`projbtn ${p.id === projectId ? "is-on" : ""}`}
              onClick={() => { setProjectId(p.id); setFEpic(null); setFAssignee(null); setFPriority(null); setOpenId(null); }}>
              <span className="projbtn__key" style={{ background: p.color }}>{p.key.slice(0,2)}</span>
              <span className="projbtn__name">{p.name}</span>
              <span className="projbtn__count">{projCounts[p.id]}</span>
            </button>
          ))}
          {isAdmin && (
            <button className="projbtn projbtn--add" onClick={() => setShowNewProject(true)} title="Create a project">
              <span className="projbtn__key projbtn__key--add"><Icon name="plus" size={14} /></span>
              <span className="projbtn__name">New project</span>
            </button>
          )}
        </nav>
        <div className="side__foot">
          <Menu align="left" width={200} trigger={
            <button className="whoami">
              <Avatar agent={auth.as} size={26} />
              <span className="whoami__name">{auth.as.name}<span className="whoami__role">{auth.viaToken ? "via token" : auth.as.role}</span></span>
              <Icon name="chevron-down" size={14} />
            </button>
          }>
            <div className="menu__head">Signed in as {auth.as.name}</div>
            {isAdmin && (
              <button className="menu__item" onClick={() => { setShowAdmin(true); }}>
                <Icon name="sliders" size={15} /> Admin panel
              </button>
            )}
            <button className="menu__item" onClick={handleSignOut}><Icon name="logout" size={15} /> Sign out</button>
          </Menu>
        </div>
      </aside>

      {/* Main */}
      <main className="main">
        <header className="topbar">
          <div className="topbar__title">
            <span className="topbar__projkey" style={{ background: project.color }}>{project.key}</span>
            <h1>{project.name}</h1>
            <div className="viewtabs">
              <button className={view === "board" ? "is-on" : ""} onClick={() => setView("board")}>
                <Icon name="layout" size={14} /> Board
              </button>
              <button className={view === "inbox" ? "is-on" : ""} onClick={() => setView("inbox")}>
                <Icon name="link" size={14} /> Inbox
                {inboxNew > 0 && <span className="viewtabs__badge">{inboxNew}</span>}
              </button>
            </div>
          </div>
          <div className="topbar__tools">
            {view === "board" && (
              <div className="searchbox">
                <Icon name="search" size={16} />
                <input placeholder="Search tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
                {q && <button className="searchbox__clear" onClick={() => setQ("")}><Icon name="x" size={14} /></button>}
              </div>
            )}
            {writeOk && (
              <button className="btn btn--primary" onClick={() => setCreating(view === "inbox" ? { mode: "request" } : { status: "backlog" })}>
                <Icon name="plus" size={16} /> {view === "inbox" ? "New request" : "New"}
              </button>
            )}
          </div>
        </header>

        {view === "board" && (
        <div className="filterbar">
          <span className="filterbar__lead"><Icon name="filter" size={14} /> Filter</span>
          <FilterChip label="Assignee" value={fAssignee} active={fAssignee !== null ? (ctx.agentOf(fAssignee)?.name || "Unassigned") : null}
            options={[{ value: null, label: "Unassigned", agent: null }, ...agents.map((a) => ({ value: a.id, label: a.name, agent: a }))].filter(o=>o.value!==undefined)}
            onChange={setFAssignee}
            renderOpt={(o) => <span className="row-gap"><Avatar agent={o.agent} size={18} />{o.label}</span>} />
          <FilterChip label="Priority" value={fPriority} active={fPriority ? window.PRIORITIES.find(p=>p.id===fPriority).label : null}
            options={window.PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
            onChange={setFPriority}
            renderOpt={(o) => <span className="row-gap"><PriorityBadge priority={o.value} compact />{o.label}</span>} />
          <FilterChip label="Epic" value={fEpic} active={fEpic ? epicsOfProject.find(e=>e.id===fEpic)?.title : null}
            options={epicsOfProject.map((e) => ({ value: e.id, label: e.title }))}
            onChange={setFEpic} />
          <button className={`fchip fchip--toggle ${t.sortByPriority ? "is-on" : ""}`} onClick={() => setTweak("sortByPriority", !t.sortByPriority)}>
            <Icon name="sort" size={14} /> Sort by priority
          </button>
          {activeFilters > 0 && (
            <button className="filterbar__clear" onClick={() => { setFAssignee(null); setFPriority(null); setFEpic(null); }}>
              Clear ({activeFilters})
            </button>
          )}
        </div>
        )}

        <div className="boardwrap">
          {view === "board" ? (
            <Board
              grouped={t.layout === "swimlanes"}
              tasksByCol={tasksByCol}
              ctx={ctx}
              onDropTask={moveTask}
              onOpen={setOpenId}
              addInColumn={(status) => writeOk && setCreating({ status })}
            />
          ) : (
            <InboxView project={project} requests={myRequests} ctx={ctx}
              onAction={requestAction} onOpenTask={(id) => { const tk = tasks.find((x) => x.id === id); const pid = tk && epicProject(tk); if (pid && pid !== projectId) setProjectId(pid); setView("board"); setOpenId(id); }}
              onNewRequest={() => setCreating({ mode: "request" })}
              onUploadAttachment={uploadRequestAttachment}
              onDeleteAttachment={deleteRequestAttachment} />
          )}
        </div>
      </main>

      {openTask && (
        <DetailPanel
          task={openTask}
          ctx={ctx}
          currentUser={auth.as}
          onClose={() => setOpenId(null)}
          onPatch={patch}
          onComment={addComment}
          onOpen={setOpenId}
          onDelete={deleteTask}
          onUploadAttachment={uploadTaskAttachment}
          onDeleteAttachment={deleteTaskAttachment}
          canWrite={writeOk}
        />
      )}
      {creating && <TicketForm project={project} defaults={creating} ctx={ctx} onClose={() => setCreating(null)} onCreate={createTask} />}

      {/* New project modal (admin) */}
      {showNewProject && isAdmin && (
        <NewProjectModal
          projects={projects}
          onCreate={createProject}
          onCreated={(pid) => { setShowNewProject(false); setProjectId(pid); setView("board"); setOpenId(null); }}
          onClose={() => setShowNewProject(false)}
        />
      )}

      {/* Admin panel overlay */}
      {showAdmin && isAdmin && (
        <AdminPanel
          agents={agents}
          projects={projects}
          onClose={() => setShowAdmin(false)}
        />
      )}

      {/* Tweaks */}
      <TweaksPanel>
        <TweakSection label="Board layout" />
        <TweakRadio label="Arrangement" value={t.layout} options={["columns", "swimlanes"]}
          onChange={(v) => setTweak("layout", v)} />
        <TweakRadio label="Density" value={t.density} options={["comfortable", "compact"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakToggle label="Sort cards by priority" value={t.sortByPriority} onChange={(v) => setTweak("sortByPriority", v)} />
        <TweakSection label="Card details" />
        <TweakToggle label="Epic color stripe" value={t.epicStripe} onChange={(v) => setTweak("epicStripe", v)} />
        <TweakToggle label="Epic chips" value={t.epicChips} onChange={(v) => setTweak("epicChips", v)} />
        <TweakToggle label="Assignee avatars" value={t.avatars} onChange={(v) => setTweak("avatars", v)} />
        <TweakSection label="Theme" />
        <TweakColor label="Accent" value={t.accent} options={["#D97757", "#2A6FB5", "#2F7D63", "#6E59C7", "#C2453B"]}
          onChange={(v) => setTweak("accent", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

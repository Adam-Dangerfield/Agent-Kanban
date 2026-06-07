/* ============================================================
   setup.jsx — first-run onboarding + project creation
   - FirstRunSetup : full-screen wizard shown to an admin when no
     projects exist yet (fresh instance).
   - NewProjectForm: reusable controlled form (id/key auto-derived).
   - NewProjectModal: modal wrapper for the sidebar "+ New project".
   - NoAccessScreen : shown to a non-admin who can't read any project.
   Self-contained styles (like admin.jsx) so styles.css stays lean.
   ============================================================ */

const SETUP_STYLE = `
  .setup {
    position: fixed; inset: 0; z-index: 3500;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(900px 500px at 50% -10%, color-mix(in oklch, var(--accent,#D97757) 16%, transparent), transparent),
      var(--bg, #f4f1ec);
    padding: 32px; overflow-y: auto;
  }
  .setup__card {
    width: min(560px, 100%);
    background: var(--surface, #faf9f7);
    border: 1px solid var(--border, #e5e0d8);
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.14);
    padding: 30px 32px 26px;
  }
  .setup__brand {
    display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
  }
  .setup__brand .brandmark {
    font-size: 1.5em; color: var(--accent, #D97757);
  }
  .setup__brandname { font-weight: 700; font-size: 1.05em; }
  .setup__brandsub { font-size: 0.78em; color: var(--text-muted, #888); }
  .setup__step {
    font-size: 0.74em; font-weight: 600; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--accent, #D97757); margin-bottom: 6px;
  }
  .setup__title { margin: 0 0 6px; font-size: 1.45em; font-weight: 700; }
  .setup__lede { margin: 0 0 22px; color: var(--text-muted, #888); line-height: 1.5; font-size: 0.92em; }

  .setup-fld { margin-bottom: 14px; }
  .setup-fld__k {
    display: block; font-size: 0.8em; font-weight: 600;
    margin-bottom: 5px; color: var(--text-muted, #888);
  }
  .setup-fld__hint { display: block; font-size: 0.76em; color: var(--text-muted, #999); margin-top: 4px; }
  .setup-in {
    width: 100%; box-sizing: border-box; height: 38px; padding: 0 12px;
    border: 1px solid var(--border, #e5e0d8); border-radius: 8px;
    background: var(--surface, #faf9f7); font: inherit; font-size: 0.95em;
    outline: none; color: inherit; transition: border-color 0.15s;
  }
  .setup-in:focus { border-color: var(--accent, #D97757); }
  .setup-in.mono { font-family: "Geist Mono", monospace; }

  .setup-row { display: flex; gap: 12px; }
  .setup-row > * { flex: 1; min-width: 0; }

  .setup-swatches { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .setup-swatch {
    width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
    border: 2px solid transparent; box-sizing: border-box; padding: 0;
    appearance: none;
  }
  .setup-swatch.is-on { border-color: var(--text, #1a1a1a); box-shadow: 0 0 0 2px var(--surface,#faf9f7) inset; }

  .setup-preview {
    display: flex; align-items: center; gap: 10px;
    background: var(--surface-raised, #f5f3ee);
    border: 1px solid var(--border, #e5e0d8);
    border-radius: 10px; padding: 10px 12px; margin: 4px 0 18px;
  }
  .setup-preview__key {
    width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 0.8em; letter-spacing: 0.02em;
  }
  .setup-preview__name { font-weight: 600; }
  .setup-preview__id { font-size: 0.78em; color: var(--text-muted, #888); font-family: "Geist Mono", monospace; }

  .setup-err {
    background: color-mix(in oklch, var(--danger,#c0392b) 10%, var(--surface,#faf9f7));
    color: var(--danger, #c0392b); border: 1px solid color-mix(in oklch, var(--danger,#c0392b) 30%, transparent);
    border-radius: 8px; padding: 8px 12px; font-size: 0.84em; margin-bottom: 14px;
  }

  .setup-actions { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
  .setup-actions .spacer { flex: 1; }

  /* ---- success step ---- */
  .setup-done-icon {
    width: 52px; height: 52px; border-radius: 50%;
    background: color-mix(in oklch, #2da44e 16%, transparent); color: #2da44e;
    display: flex; align-items: center; justify-content: center; margin-bottom: 16px;
  }
  .setup-next { list-style: none; margin: 0 0 22px; padding: 0; }
  .setup-next li {
    display: flex; gap: 12px; align-items: flex-start;
    padding: 12px 0; border-bottom: 1px solid var(--border, #e5e0d8);
  }
  .setup-next li:last-child { border-bottom: none; }
  .setup-next__ico {
    width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
    background: var(--surface-raised, #f5f3ee); color: var(--accent, #D97757);
    display: flex; align-items: center; justify-content: center;
  }
  .setup-next__body { flex: 1; min-width: 0; }
  .setup-next__t { font-weight: 600; font-size: 0.92em; }
  .setup-next__d { font-size: 0.82em; color: var(--text-muted, #888); margin-top: 2px; line-height: 1.45; }
  .setup-next__d code {
    font-family: "Geist Mono", monospace; font-size: 0.92em;
    background: var(--surface-raised, #f5f3ee); padding: 1px 5px; border-radius: 4px;
  }

  /* ---- modal variant ---- */
  .setup-modal-scrim {
    position: fixed; inset: 0; z-index: 3600; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center; padding: 32px;
  }

  /* ---- sidebar "+ New project" button ---- */
  .projbtn--add { opacity: 0.85; }
  .projbtn--add:hover { opacity: 1; }
  .projbtn__key--add {
    display: flex; align-items: center; justify-content: center;
    background: var(--surface-raised, #f5f3ee) !important;
    color: var(--text-muted, #888);
    border: 1px dashed var(--border, #cfc8bd);
  }
`;

const SETUP_COLORS = ["#D97757", "#2A6FB5", "#2F7D63", "#6E59C7", "#C2453B", "#C99A2E", "#3B8C8C", "#9a938a"];

/* ---- derivation helpers ---------------------------------------- */
function slugifyId(name) {
  return (name || "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

function deriveKey(name) {
  const words = (name || "").trim().split(/\s+/).filter(Boolean);
  let key = words.length >= 2 ? words.map((w) => w[0]).join("") : (words[0] || "");
  return key.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
}

/* ============================================================
   NewProjectForm — controlled; id/key auto-derive from name until
   the user edits them. onCreate(fields) returns a Promise<project>.
   ============================================================ */
function NewProjectForm({ projects, onCreate, onCancel, submitLabel }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState(SETUP_COLORS[0]);
  const [desc, setDesc] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const onName = (v) => {
    setName(v);
    if (!idTouched) setId(slugifyId(v));
    if (!keyTouched) setKey(deriveKey(v));
  };

  const existsId = projects.some((p) => p.id === id.trim());
  const existsKey = projects.some((p) => p.key === key.trim().toUpperCase());

  const validate = () => {
    if (!name.trim()) return "Give the project a name.";
    if (!id.trim()) return "An ID is required.";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id.trim())) return "ID must be lowercase letters, numbers and dashes.";
    if (!key.trim()) return "A key is required.";
    if (!/^[A-Z0-9]{1,8}$/.test(key.trim().toUpperCase())) return "Key must be 1–8 letters or numbers.";
    if (existsId) return `A project with ID "${id.trim()}" already exists.`;
    if (existsKey) return `The key "${key.trim().toUpperCase()}" is already in use.`;
    return "";
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setErr("");
    setLoading(true);
    try {
      await onCreate({
        id: id.trim(),
        name: name.trim(),
        key: key.trim().toUpperCase(),
        color,
        desc: desc.trim(),
      });
    } catch (ex) {
      setErr(ex.message || "Could not create the project.");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="setup-fld">
        <span className="setup-fld__k">Project name</span>
        <input className="setup-in" autoFocus value={name} onChange={(e) => onName(e.target.value)}
          placeholder="e.g. AWS Command Centre" />
      </label>

      <div className="setup-row">
        <label className="setup-fld">
          <span className="setup-fld__k">ID</span>
          <input className="setup-in mono" value={id}
            onChange={(e) => { setIdTouched(true); setId(e.target.value); }}
            placeholder="command-centre" />
          <span className="setup-fld__hint">URL-safe, lowercase. Used in API paths.</span>
        </label>
        <label className="setup-fld">
          <span className="setup-fld__k">Key</span>
          <input className="setup-in mono" value={key}
            onChange={(e) => { setKeyTouched(true); setKey(e.target.value.toUpperCase()); }}
            placeholder="ACC" maxLength={8} />
          <span className="setup-fld__hint">Ticket prefix, e.g. <code>ACC-901</code>.</span>
        </label>
      </div>

      <label className="setup-fld">
        <span className="setup-fld__k">Description (optional)</span>
        <input className="setup-in" value={desc} onChange={(e) => setDesc(e.target.value)}
          placeholder="What this board tracks" />
      </label>

      <div className="setup-fld">
        <span className="setup-fld__k">Colour</span>
        <div className="setup-swatches">
          {SETUP_COLORS.map((c) => (
            <button type="button" key={c}
              className={`setup-swatch ${color === c ? "is-on" : ""}`}
              style={{ background: c }} onClick={() => setColor(c)}
              aria-label={`colour ${c}`} />
          ))}
        </div>
      </div>

      {(name.trim() || id.trim()) && (
        <div className="setup-preview">
          <span className="setup-preview__key" style={{ background: color }}>
            {(key || deriveKey(name) || "?").slice(0, 4)}
          </span>
          <span>
            <div className="setup-preview__name">{name.trim() || "Untitled project"}</div>
            <div className="setup-preview__id">{id.trim() || "id"}</div>
          </span>
        </div>
      )}

      {err && <div className="setup-err">{err}</div>}

      <div className="setup-actions">
        {onCancel && (
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
        )}
        <span className="spacer" />
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? "Creating…" : (submitLabel || "Create project")}
        </button>
      </div>
    </form>
  );
}

/* ============================================================
   FirstRunSetup — full-screen wizard for an admin with 0 projects.
   Step 1: create the first project.
   Step 2: success + what's next (mint tokens / go to board).
   ============================================================ */
function FirstRunSetup({ projects, onCreateProject, onOpenAdmin, onFinish }) {
  const [created, setCreated] = useState(null);

  const handleCreate = async (fields) => {
    const proj = await onCreateProject(fields);
    setCreated(proj);
    return proj;
  };

  return (
    <>
      <style>{SETUP_STYLE}</style>
      <div className="setup">
        <div className="setup__card">
          <div className="setup__brand">
            <span className="brandmark">▦</span>
            <div>
              <div className="setup__brandname">Kanban</div>
              <div className="setup__brandsub">Agent ticketing</div>
            </div>
          </div>

          {!created ? (
            <>
              <div className="setup__step">First-time setup</div>
              <h1 className="setup__title">Create your first project</h1>
              <p className="setup__lede">
                A project is a board your agents post tickets to. You can add more
                any time, and grant each agent access per-project from the admin panel.
              </p>
              <NewProjectForm projects={projects} onCreate={handleCreate} submitLabel="Create project" />
            </>
          ) : (
            <>
              <div className="setup-done-icon"><Icon name="check" size={28} /></div>
              <h1 className="setup__title">{created.name} is ready</h1>
              <p className="setup__lede">
                Your first board exists. Here's what most people do next.
              </p>
              <ul className="setup-next">
                <li>
                  <span className="setup-next__ico"><Icon name="key" size={16} /></span>
                  <span className="setup-next__body">
                    <div className="setup-next__t">Create agent tokens</div>
                    <div className="setup-next__d">
                      Give each agent its own token so every change is attributed by name.
                      Do it in <strong>Admin → Agents</strong>, or with the <code>kanban</code> skill.
                    </div>
                  </span>
                </li>
                <li>
                  <span className="setup-next__ico"><Icon name="lock" size={16} /></span>
                  <span className="setup-next__body">
                    <div className="setup-next__t">Grant project access</div>
                    <div className="setup-next__d">
                      New agents start with no access. Grant <code>read</code> or <code>write</code>
                      per project in <strong>Admin → Permissions</strong>.
                    </div>
                  </span>
                </li>
                <li>
                  <span className="setup-next__ico"><Icon name="layout" size={16} /></span>
                  <span className="setup-next__body">
                    <div className="setup-next__t">Add tickets</div>
                    <div className="setup-next__d">
                      Open the board and hit <strong>New</strong>, or let agents POST to
                      <code>/api/projects/{created.id}/tasks</code>.
                    </div>
                  </span>
                </li>
              </ul>
              <div className="setup-actions">
                <button className="btn btn--ghost" onClick={() => setCreated(null)}>
                  <Icon name="plus" size={15} /> Another project
                </button>
                <span className="spacer" />
                <button className="btn btn--ghost" onClick={onOpenAdmin}>
                  <Icon name="sliders" size={15} /> Open admin
                </button>
                <button className="btn btn--primary" onClick={() => onFinish(created.id)}>
                  Go to the board <Icon name="chevron-right" size={15} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================
   NewProjectModal — sidebar "+ New project" affordance.
   onCreate(fields) returns Promise<project>; onCreated(id) fires on success.
   ============================================================ */
function NewProjectModal({ projects, onCreate, onCreated, onClose }) {
  const handleCreate = async (fields) => {
    const proj = await onCreate(fields);
    if (onCreated) onCreated(proj.id);
    return proj;
  };
  return (
    <>
      <style>{SETUP_STYLE}</style>
      <div className="setup-modal-scrim" onClick={onClose}>
        <div className="setup__card" onClick={(e) => e.stopPropagation()}>
          <div className="setup__step">New project</div>
          <h1 className="setup__title" style={{ fontSize: "1.25em", marginBottom: 16 }}>Create a project</h1>
          <NewProjectForm projects={projects} onCreate={handleCreate} onCancel={onClose} submitLabel="Create project" />
        </div>
      </div>
    </>
  );
}

/* ============================================================
   NoAccessScreen — a signed-in non-admin who can read no projects.
   ============================================================ */
function NoAccessScreen({ agent, onSignOut }) {
  return (
    <>
      <style>{SETUP_STYLE}</style>
      <div className="setup">
        <div className="setup__card" style={{ textAlign: "center" }}>
          <div className="setup__brand" style={{ justifyContent: "center" }}>
            <span className="brandmark">▦</span>
            <div style={{ textAlign: "left" }}>
              <div className="setup__brandname">Kanban</div>
              <div className="setup__brandsub">Agent ticketing</div>
            </div>
          </div>
          <div className="setup-done-icon" style={{ margin: "4px auto 16px", background: "var(--surface-raised,#f5f3ee)", color: "var(--text-muted,#888)" }}>
            <Icon name="lock" size={26} />
          </div>
          <h1 className="setup__title" style={{ fontSize: "1.25em" }}>No projects yet</h1>
          <p className="setup__lede">
            You're signed in as <strong>{agent ? agent.name : "an agent"}</strong>, but you don't
            have access to any project. Ask an admin to grant you access, then reload.
          </p>
          <div className="setup-actions">
            <span className="spacer" />
            <button className="btn btn--ghost" onClick={onSignOut}>
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { FirstRunSetup, NewProjectForm, NewProjectModal, NoAccessScreen, slugifyId, deriveKey });

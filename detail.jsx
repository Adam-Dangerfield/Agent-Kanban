/* ============================================================
   Detail slide-over + Create/Edit ticket form
   ============================================================ */

/* simple custom select built on Menu */
function Select({ value, options, onChange, render, placeholder = "Select…", width = 220 }) {
  const cur = options.find((o) => o.value === value);
  return (
    <Menu width={width} trigger={
      <button type="button" className="select">
        <span className="select__val">{cur ? (render ? render(cur) : cur.label) : <span className="muted">{placeholder}</span>}</span>
        <Icon name="chevron-down" size={14} />
      </button>
    }>
      {options.map((o) => (
        <button key={String(o.value)} type="button"
          className={`menu__item ${o.value === value ? "is-active" : ""}`}
          onClick={() => onChange(o.value)}>
          {render ? render(o) : o.label}
          {o.value === value && <span className="menu__check"><Icon name="check" size={14} /></span>}
        </button>
      ))}
    </Menu>
  );
}

function EditableText({ value, onCommit, placeholder, multiline, className }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value), [value]);
  if (editing) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <Tag
        autoFocus className={`inlineedit ${className || ""}`}
        value={v} placeholder={placeholder}
        rows={multiline ? 4 : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); if (v !== value) onCommit(v); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) e.target.blur();
          if (e.key === "Escape") { setV(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <div className={`inlineview ${className || ""} ${!value ? "is-empty" : ""}`} onClick={() => setEditing(true)}>
      {value || <span className="muted">{placeholder}</span>}
    </div>
  );
}

/* ---- Attachments section ----------------------------------- */
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function AttachmentsSection({ attachments, onUpload, onDelete, canWrite }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadErr("");
    if (file.size > MAX_BYTES) {
      setUploadErr("File is too large (max 20 MB).");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      await onUpload(file);
    } catch (ex) {
      setUploadErr(ex.message || "Upload failed.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleDownload = async (att) => {
    try {
      const blob = await window.API.downloadAttachment(att.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
    } catch (ex) {
      console.error("downloadAttachment failed:", ex);
    }
  };

  const list = attachments || [];

  return (
    <div className="attachments">
      {list.length === 0 && <p className="muted" style={{ fontSize: "0.85em", margin: "4px 0" }}>No attachments yet.</p>}
      {list.map((att) => (
        <div key={att.id} className="attachment__row" style={{ display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
          <Icon name="folder" size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
          <span style={{ flex: 1, fontSize: "0.85em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={att.filename}>{att.filename}</span>
          <span style={{ fontSize: "0.78em", color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtBytes(att.sizeBytes)}</span>
          <button className="iconbtn" title="Download" onClick={() => handleDownload(att)}>
            <Icon name="arrow-up" size={13} style={{ transform: "rotate(180deg)" }} />
          </button>
          {canWrite && (
            <button className="iconbtn" title="Delete attachment" onClick={() => onDelete(att.id)}>
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
      ))}
      {canWrite && (
        <div style={{ marginTop: "8px" }}>
          <input
            ref={fileRef}
            type="file"
            style={{ display: "none" }}
            onChange={handleFile}
          />
          <button
            className="btn btn--ghost btn--sm"
            disabled={uploading}
            onClick={() => { setUploadErr(""); fileRef.current && fileRef.current.click(); }}
          >
            <Icon name="plus" size={14} /> {uploading ? "Uploading…" : "Attach file"}
          </button>
          {uploadErr && <span style={{ marginLeft: "8px", fontSize: "0.8em", color: "var(--danger, #c0392b)" }}>{uploadErr}</span>}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ task, ctx, currentUser, onClose, onPatch, onComment, onOpen, onDelete, onUploadAttachment, onDeleteAttachment, canWrite }) {
  if (!task) return null;
  const epic = ctx.epicOf(task);
  const story = ctx.storyOf(task);
  const agent = ctx.agentOf(task.assignee);
  const blockers = ctx.blockersOf(task).map((id) => ctx.taskById(id)).filter(Boolean);
  const blocks = ctx.allTasks.filter((t) => (t.deps || []).includes(task.id));
  const linkedReqs = ctx.requestsForTask ? ctx.requestsForTask(task.id) : [];

  // canWrite may not always be passed (backwards compat) — default true
  const writeOk = canWrite !== false;

  const agentOpts = [{ value: null, label: "Unassigned" }, ...window.SEED.AGENTS.map((a) => ({ value: a.id, label: a.name, agent: a }))];

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-label={task.title}>
        <header className="panel__top">
          <span className="panel__id">{task.id}</span>
          <div className="panel__top-actions">
            {writeOk && <button className="iconbtn" title="Delete ticket" onClick={() => onDelete(task.id)}><Icon name="trash" size={16} /></button>}
            <button className="iconbtn" title="Close" onClick={onClose}><Icon name="x" size={18} /></button>
          </div>
        </header>

        <div className="panel__scroll">
          <EditableText className="panel__title" value={task.title} placeholder="Ticket title"
            onCommit={writeOk ? (v) => onPatch(task.id, { title: v }, `renamed the ticket`) : undefined} />

          <div className="panel__breadcrumb">
            <button className="crumb" onClick={() => ctx.filterEpic(epic && epic.id)}>{epic ? epic.title : "No epic"}</button>
            <Icon name="chevron-right" size={13} />
            <span className="crumb crumb--story">{story ? story.title : "—"}</span>
          </div>

          <div className="panel__props">
            <div className="prop">
              <span className="prop__k">Status</span>
              <Select value={task.status} width={200}
                options={window.COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
                onChange={writeOk ? (v) => onPatch(task.id, { status: v }, `set status → ${window.COLUMNS.find(c=>c.id===v).label}`) : () => {}}
                render={(o) => <span className="row-gap"><span className={`col__swatch col__swatch--${o.value}`} />{o.label}</span>} />
            </div>
            <div className="prop">
              <span className="prop__k">Priority</span>
              <Select value={task.priority} width={200}
                options={window.PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
                onChange={writeOk ? (v) => onPatch(task.id, { priority: v }, `set priority → ${v}`) : () => {}}
                render={(o) => <span className="row-gap"><PriorityBadge priority={o.value} compact />{o.label}</span>} />
            </div>
            <div className="prop">
              <span className="prop__k">Assignee</span>
              <Select value={task.assignee} width={220}
                options={agentOpts}
                onChange={writeOk ? (v) => onPatch(task.id, { assignee: v }, v ? `assigned to ${ctx.agentOf(v).name}` : `unassigned`) : () => {}}
                render={(o) => <span className="row-gap"><Avatar agent={o.agent} size={20} />{o.label}{o.agent && o.agent.kind === "agent" && <span className="tinytag">agent</span>}</span>} />
            </div>
          </div>

          <Section title="Branch & merge" icon="branch">
            <div className="git">
              <div className="git__row">
                <span className="git__k"><Icon name="branch" size={13} /> Branch</span>
                <EditableText className="git__branch mono" value={task.branch} placeholder="feat/your-branch"
                  onCommit={writeOk ? (v) => onPatch(task.id, { branch: v, mergeState: (!task.mergeState || task.mergeState === "none") && v ? "dev" : task.mergeState }) : undefined} />
              </div>
              <div className="git__row">
                <span className="git__k"><Icon name="merge" size={13} /> Status</span>
                <Select value={task.mergeState || "none"} width={220}
                  options={window.MERGE_STATES.map((s) => ({ value: s.id, label: s.label, color: s.color }))}
                  onChange={writeOk ? (v) => onPatch(task.id, { mergeState: v }, mergeLog(v, task.branch)) : () => {}}
                  render={(o) => <span className="row-gap"><span className="git__dot" style={{ background: o.color }} />{o.label}</span>} />
              </div>
            </div>
          </Section>

          <Section title="Description">
            <EditableText className="panel__desc" value={task.desc} multiline placeholder="Add a description…"
              onCommit={writeOk ? (v) => onPatch(task.id, { desc: v }) : undefined} />
          </Section>

          <Section title="Notes" icon="note">
            <EditableText className="panel__notes" value={task.notes} multiline placeholder="Describe the work — what this ticket covers…"
              onCommit={writeOk ? (v) => onPatch(task.id, { notes: v }) : undefined} />
          </Section>

          <Section title={`Attachments${(task.attachments && task.attachments.length) ? ` · ${task.attachments.length}` : ""}`} icon="folder">
            <AttachmentsSection
              attachments={task.attachments}
              onUpload={onUploadAttachment ? (file) => onUploadAttachment(task.id, file) : null}
              onDelete={onDeleteAttachment ? (attId) => onDeleteAttachment(task.id, attId) : null}
              canWrite={writeOk && !!onUploadAttachment}
            />
          </Section>

          <Section title={`Messages${(task.comments && task.comments.length) ? ` · ${task.comments.length}` : ""}`} icon="message">
            <CommentThread task={task} ctx={ctx} currentUser={currentUser} onComment={onComment} />
          </Section>

          <Section title="Dependencies" icon="link">
            <div className="deps">
              <div className="deps__group">
                <span className="deps__lbl">Blocked by</span>
                {blockers.length ? blockers.map((b) => (
                  <button key={b.id} className={`deprow ${b.status === "done" ? "deprow--done" : "deprow--open"}`} onClick={() => onOpen(b.id)}>
                    <Icon name={b.status === "done" ? "check" : "block"} size={13} />
                    <span className="deprow__id">{b.id}</span>
                    <span className="deprow__t">{b.title}</span>
                    <StatusPill status={b.status} />
                  </button>
                )) : <span className="muted deps__none">None</span>}
              </div>
              <div className="deps__group">
                <span className="deps__lbl">Blocks</span>
                {blocks.length ? blocks.map((b) => (
                  <button key={b.id} className="deprow" onClick={() => onOpen(b.id)}>
                    <Icon name="arrow-up" size={13} style={{ transform: "rotate(90deg)" }} />
                    <span className="deprow__id">{b.id}</span>
                    <span className="deprow__t">{b.title}</span>
                    <StatusPill status={b.status} />
                  </button>
                )) : <span className="muted deps__none">None</span>}
              </div>
            </div>
          </Section>

          {linkedReqs.length > 0 && (
            <Section title="Cross-team requests" icon="link">
              <div className="deps">
                {linkedReqs.map((r) => {
                  const tp = window.SEED.PROJECTS.find((p) => p.id === r.toProject);
                  return (
                    <div key={r.id} className="deprow deprow--req">
                      <span className="rkey rkey--mini" style={{ background: tp.color }}>{tp.key}</span>
                      <span className="deprow__t">{r.title}</span>
                      <ReqStatusPill status={r.status} />
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          <Section title="Activity" icon="clock">
            <ol className="activity">
              {[...task.activity].reverse().map((a, i) => {
                const who = ctx.agentOf(a.who);
                return (
                  <li key={i} className="activity__row">
                    <Avatar agent={who} size={20} />
                    <span className="activity__txt"><b>{who ? who.name : a.who}</b> {a.text}</span>
                    <span className="activity__time">{relTime(a.ts)}</span>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>
      </aside>
    </>
  );
}

function Section({ title, icon, children }) {
  return (
    <section className="dsection">
      <h5 className="dsection__h">{icon && <Icon name={icon} size={14} />}{title}</h5>
      {children}
    </section>
  );
}

function mergeLog(v, branch) {
  const b = branch ? `${branch}` : "the branch";
  if (v === "dev") return `started development on ${b}`;
  if (v === "pr") return `opened a pull request from ${b}`;
  if (v === "merged") return `merged ${b} into main`;
  return "cleared the branch";
}

function CommentThread({ task, ctx, currentUser, onComment }) {
  const [draft, setDraft] = useState("");
  const comments = task.comments || [];
  const send = () => { if (draft.trim()) { onComment(task.id, draft); setDraft(""); } };
  return (
    <div className="thread">
      {comments.length === 0 && (
        <p className="thread__empty">No messages yet. Agents post here to log what they actually did.</p>
      )}
      {comments.map((c, i) => {
        const who = ctx.agentOf(c.who);
        return (
          <div className="msg" key={i}>
            <Avatar agent={who} size={26} />
            <div className="msg__body">
              <div className="msg__meta">
                <span className="msg__who">{who ? who.name : c.who}</span>
                {who && who.kind === "agent" && <span className="tinytag">agent</span>}
                <span className="msg__time">{relTime(c.ts)}</span>
              </div>
              <p className="msg__text">{c.text}</p>
            </div>
          </div>
        );
      })}
      <div className="composer">
        <Avatar agent={currentUser} size={26} />
        <div className="composer__field">
          <textarea
            className="composer__input" rows={2}
            placeholder={`Message as ${currentUser ? currentUser.name : "you"}…  (⌘/Ctrl + Enter to send)`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          />
          <div className="composer__actions">
            <button className="btn btn--sm btn--primary" disabled={!draft.trim()} onClick={send}>Post message</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Create ticket modal ----------------------------------- */
function TicketForm({ project, defaults, ctx, onClose, onCreate }) {
  const epics = window.SEED.EPICS.filter((e) => e.projectId === project.id);
  const otherProjects = window.SEED.PROJECTS.filter((p) => p.id !== project.id);
  const myTasks = ctx.allTasks.filter((tk) => ctx.epicOf(tk) && ctx.epicOf(tk).projectId === project.id);
  const [mode, setMode] = useState(defaults.mode === "request" ? "request" : "ticket");
  const [form, setForm] = useState({
    title: "", desc: "", notes: "",
    status: defaults.status || "backlog",
    priority: "medium",
    assignee: null,
    epicId: epics[0] ? epics[0].id : null,
    storyId: null, deps: [],
    targetTeam: otherProjects[0] ? otherProjects[0].id : null,
    blocksTaskId: null,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const stories = window.SEED.STORIES.filter((s) => s.epicId === form.epicId);
  useEffect(() => { if (!stories.find((s) => s.id === form.storyId)) set("storyId", stories[0] ? stories[0].id : null); }, [form.epicId]);

  const agentOpts = [{ value: null, label: "Unassigned" }, ...window.SEED.AGENTS.map((a) => ({ value: a.id, label: a.name, agent: a }))];
  const valid = form.title.trim().length > 1;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="New ticket">
        <header className="modal__head">
          <h3>{mode === "request" ? "New request" : "New ticket"} <span className="modal__proj" style={{ color: project.color }}>{project.key}</span></h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <div className="modal__body">
          <div className="segmented">
            <button type="button" className={mode === "ticket" ? "is-on" : ""} onClick={() => setMode("ticket")}>
              <Icon name="layout" size={14} /> Board ticket
            </button>
            <button type="button" className={mode === "request" ? "is-on" : ""} onClick={() => setMode("request")}>
              <Icon name="link" size={14} /> Request another team
            </button>
          </div>
          {mode === "request" && (
            <div className="reqroute-pick">
              <ProjKey id={project.id} />
              <Icon name="chevron-right" size={15} />
              <Select value={form.targetTeam} width={240}
                options={otherProjects.map((p) => ({ value: p.id, label: p.name, color: p.color }))}
                onChange={(v) => set("targetTeam", v)}
                render={(o) => <span className="row-gap"><span className="rkey rkey--mini" style={{ background: o.color }}>{window.SEED.PROJECTS.find(p=>p.id===o.value).key}</span>{o.label}</span>} />
              <span className="reqroute-pick__hint">lands in their inbox</span>
            </div>
          )}
          <label className="fld">
            <span className="fld__k">Title</span>
            <input autoFocus className="textin" placeholder={mode === "request" ? "What do you need from them?" : "Short, action-oriented summary"}
              value={form.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="fld">
            <span className="fld__k">Description</span>
            <textarea className="textin" rows={3} placeholder="What needs to happen and why"
              value={form.desc} onChange={(e) => set("desc", e.target.value)} />
          </label>

          {mode === "ticket" ? (
            <div className="fld-grid">
              <div className="fld">
                <span className="fld__k">Epic</span>
                <Select value={form.epicId} width={240}
                  options={epics.map((e) => ({ value: e.id, label: e.title }))}
                  onChange={(v) => set("epicId", v)} />
              </div>
              <div className="fld">
                <span className="fld__k">Story</span>
                <Select value={form.storyId} width={240} placeholder="No story"
                  options={stories.map((s) => ({ value: s.id, label: s.title }))}
                  onChange={(v) => set("storyId", v)} />
              </div>
              <div className="fld">
                <span className="fld__k">Status</span>
                <Select value={form.status} width={200}
                  options={window.COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
                  onChange={(v) => set("status", v)}
                  render={(o) => <span className="row-gap"><span className={`col__swatch col__swatch--${o.value}`} />{o.label}</span>} />
              </div>
              <div className="fld">
                <span className="fld__k">Priority</span>
                <Select value={form.priority} width={200}
                  options={window.PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(v) => set("priority", v)}
                  render={(o) => <span className="row-gap"><PriorityBadge priority={o.value} compact />{o.label}</span>} />
              </div>
              <div className="fld">
                <span className="fld__k">Assignee</span>
                <Select value={form.assignee} width={220}
                  options={agentOpts}
                  onChange={(v) => set("assignee", v)}
                  render={(o) => <span className="row-gap"><Avatar agent={o.agent} size={20} />{o.label}</span>} />
              </div>
            </div>
          ) : (
            <div className="fld-grid">
              <div className="fld">
                <span className="fld__k">Priority</span>
                <Select value={form.priority} width={200}
                  options={window.PRIORITIES.map((p) => ({ value: p.id, label: p.label }))}
                  onChange={(v) => set("priority", v)}
                  render={(o) => <span className="row-gap"><PriorityBadge priority={o.value} compact />{o.label}</span>} />
              </div>
              <div className="fld">
                <span className="fld__k">This unblocks <span className="muted">(optional)</span></span>
                <Select value={form.blocksTaskId} width={260} placeholder="No linked ticket"
                  options={[{ value: null, label: "No linked ticket" }, ...myTasks.map((tk) => ({ value: tk.id, label: `${tk.id} · ${tk.title}` }))]}
                  onChange={(v) => set("blocksTaskId", v)} />
              </div>
            </div>
          )}

          <label className="fld">
            <span className="fld__k">Notes</span>
            <textarea className="textin" rows={2} placeholder="Optional context"
              value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
        </div>
        <footer className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={!valid} onClick={() => onCreate({ ...form, mode })}>
            {mode === "request" ? "Send request" : "Create ticket"}
          </button>
        </footer>
      </div>
    </>
  );
}

Object.assign(window, { DetailPanel, TicketForm, Select, EditableText, Section, AttachmentsSection, fmtBytes });

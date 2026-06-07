/* ============================================================
   Inbox: cross-team requests (incoming + outgoing queues)
   ============================================================ */

function ReqStatusPill({ status }) {
  const s = window.REQUEST_STATES.find((x) => x.id === status) || window.REQUEST_STATES[0];
  return (
    <span className="reqpill" style={{ color: s.color, background: `color-mix(in oklch, ${s.color} 13%, #fff)` }}>
      <span className="reqpill__dot" style={{ background: s.color }} />{s.label}
    </span>
  );
}

function ProjKey({ id, dimmed }) {
  const p = window.SEED.PROJECTS.find((x) => x.id === id);
  if (!p) return null;
  return <span className="rkey" style={{ background: dimmed ? "transparent" : p.color, color: dimmed ? p.color : "#fff", border: dimmed ? `1px solid ${p.color}` : "none" }} title={p.name}>{p.key}</span>;
}

/* ---- Request attachments ----------------------------------- */
const REQ_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

function RequestAttachments({ req, onUpload, onDelete, canWrite }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploadErr("");
    if (file.size > REQ_MAX_BYTES) {
      setUploadErr("File too large (max 20 MB).");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      await onUpload(req.id, file);
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

  const fmtB = (n) => {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  };

  const list = req.attachments || [];
  if (list.length === 0 && !canWrite) return null;

  return (
    <div className="req__attachments" style={{ marginTop: "8px", borderTop: "1px solid var(--border)", paddingTop: "8px" }}>
      {list.map((att) => (
        <div key={att.id} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "2px 0", fontSize: "0.82em" }}>
          <Icon name="folder" size={12} style={{ opacity: 0.55, flexShrink: 0 }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={att.filename}>{att.filename}</span>
          <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtB(att.sizeBytes)}</span>
          <button className="iconbtn" title="Download" onClick={() => handleDownload(att)}>
            <Icon name="arrow-up" size={12} style={{ transform: "rotate(180deg)" }} />
          </button>
          {canWrite && (
            <button className="iconbtn" title="Delete" onClick={() => onDelete(req.id, att.id)}>
              <Icon name="trash" size={12} />
            </button>
          )}
        </div>
      ))}
      {canWrite && (
        <div style={{ marginTop: "4px" }}>
          <input ref={fileRef} type="file" style={{ display: "none" }} onChange={handleFile} />
          <button className="btn btn--ghost btn--sm" disabled={uploading}
            onClick={() => { setUploadErr(""); fileRef.current && fileRef.current.click(); }}
            style={{ fontSize: "0.8em" }}>
            <Icon name="plus" size={12} /> {uploading ? "Uploading…" : "Attach"}
          </button>
          {uploadErr && <span style={{ marginLeft: "6px", fontSize: "0.78em", color: "var(--danger, #c0392b)" }}>{uploadErr}</span>}
        </div>
      )}
    </div>
  );
}

function RequestCard({ req, side, ctx, onAction, onOpenTask, onUploadAttachment, onDeleteAttachment }) {
  const by = ctx.agentOf(req.requestedBy);
  const asg = ctx.agentOf(req.assignee);
  const linked = req.linkedTaskId && ctx.taskById(req.linkedTaskId);
  const spawned = req.spawnedTaskId && ctx.taskById(req.spawnedTaskId);
  const activity = req.activity || [];
  const last = activity.length ? activity[activity.length - 1] : null;

  // Permission for attachments: canWrite from ctx if available
  const canWriteReq = ctx.canWrite
    ? (ctx.canWrite(req.fromProject) || ctx.canWrite(req.toProject))
    : true;

  const actions = [];
  if (side === "incoming") {
    if (req.status === "incoming") { actions.push(["accept", "Accept", "primary"], ["decline", "Decline", "ghost"]); }
    else if (req.status === "accepted") { actions.push(["start", "Start work", "primary"]); }
    else if (req.status === "in_progress") { actions.push(["done", "Mark done", "primary"]); }
  } else {
    if (req.status === "incoming") actions.push(["cancel", "Withdraw", "ghost"]);
  }

  return (
    <article className={`req req--${req.status}`}>
      <div className="req__head">
        <span className="req__id">{req.id}</span>
        <PriorityBadge priority={req.priority} compact />
        <ReqStatusPill status={req.status} />
      </div>
      <div className="req__route">
        <ProjKey id={req.fromProject} dimmed={side === "outgoing"} />
        <Icon name="chevron-right" size={14} />
        <ProjKey id={req.toProject} dimmed={side === "incoming"} />
        <span className="req__routelbl">{side === "incoming" ? "needs your team" : "you're waiting on them"}</span>
      </div>
      <h4 className="req__title">{req.title}</h4>
      <p className="req__desc">{req.desc}</p>
      {linked && (
        <button className="req__link" onClick={() => onOpenTask(linked.id)} title="Open the blocked ticket">
          <Icon name="link" size={13} /><span className="mono">{linked.id}</span> {linked.title}
        </button>
      )}
      {spawned && (
        <button className="req__link req__link--spawned" onClick={() => onOpenTask(spawned.id)} title="Open the card created from this request">
          <Icon name="layout" size={13} /><span className="mono">{spawned.id}</span> on board · {window.COLUMNS.find((c) => c.id === spawned.status)?.label}
        </button>
      )}
      <div className="req__foot">
        <div className="req__people">
          <span className="req__person"><span className="req__plbl">raised by</span><Avatar agent={by} size={20} /></span>
          {asg && <span className="req__person"><span className="req__plbl">owner</span><Avatar agent={asg} size={20} /></span>}
        </div>
        <span className="req__time">{relTime(last ? last.ts : req.createdAt)}</span>
      </div>
      {(onUploadAttachment || (req.attachments && req.attachments.length > 0)) && (
        <RequestAttachments
          req={req}
          onUpload={onUploadAttachment}
          onDelete={onDeleteAttachment}
          canWrite={canWriteReq && !!onUploadAttachment}
        />
      )}
      {actions.length > 0 && (
        <div className="req__actions">
          {actions.map(([act, label, kind]) => (
            <button key={act} className={`btn btn--sm ${kind === "primary" ? "btn--primary" : "btn--ghost"} ${act === "decline" || act === "cancel" ? "btn--danger" : ""}`}
              onClick={() => onAction(req.id, act)}>{label}</button>
          ))}
        </div>
      )}
    </article>
  );
}

function InboxView({ project, requests, ctx, onAction, onOpenTask, onNewRequest, onUploadAttachment, onDeleteAttachment }) {
  const incoming = requests.filter((r) => r.toProject === project.id);
  const outgoing = requests.filter((r) => r.fromProject === project.id);
  const openIncoming = incoming.filter((r) => r.status === "incoming").length;

  const canWriteProject = ctx.canWrite ? ctx.canWrite(project.id) : true;

  const Queue = ({ title, hint, items, side, empty }) => (
    <section className="queue">
      <header className="queue__head">
        <div className="queue__titles">
          <h3>{title}{side === "incoming" && openIncoming > 0 && <span className="queue__badge">{openIncoming} new</span>}</h3>
          <span className="queue__hint">{hint}</span>
        </div>
        <span className="queue__count">{items.length}</span>
      </header>
      <div className="queue__body">
        {items.length ? items.map((r) => (
          <RequestCard key={r.id} req={r} side={side} ctx={ctx} onAction={onAction} onOpenTask={onOpenTask}
            onUploadAttachment={onUploadAttachment}
            onDeleteAttachment={onDeleteAttachment} />
        )) : <div className="queue__empty">{empty}</div>}
      </div>
    </section>
  );

  return (
    <div className="inbox">
      <Queue title="Incoming requests" side="incoming"
        hint={`Other teams need something from ${project.key}`}
        items={incoming}
        empty="Nothing in your queue. You're all caught up." />
      <Queue title="Outgoing requests" side="outgoing"
        hint={`What ${project.key} is waiting on from other teams`}
        items={outgoing}
        empty="You haven't asked another team for anything yet." />
    </div>
  );
}

Object.assign(window, { InboxView, RequestCard, ReqStatusPill, ProjKey });

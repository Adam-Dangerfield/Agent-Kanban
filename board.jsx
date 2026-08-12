/* ============================================================
   Board: columns + cards + native drag & drop
   ============================================================ */

function TaskCard({ task, epic, story, agent, blockedBy, waitingOn, density, opts, onOpen, onDragStart, onDragEnd, dragging }) {
  const reason = (task.blockedReason || "").trim();
  const blocked = blockedBy.length > 0 || !!reason;
  const waits = waitingOn || [];
  return (
    <article
      className={`card ${dragging ? "card--dragging" : ""} ${density === "compact" ? "card--compact" : ""} ${blocked ? "card--blocked" : ""}`}
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task.id)}
      data-screen-label={`card ${task.id}`}
    >
      {opts.epicStripe && <span className="card__stripe" style={{ background: epicColor(epic) }} />}
      <div className="card__head">
        <span className="card__id">{task.id}</span>
        <span className="card__grip"><Icon name="grip" size={14} /></span>
        <PriorityBadge priority={task.priority} compact />
      </div>
      <h4 className="card__title">{task.title}</h4>
      <div className="card__meta">
        <div className="card__tags">
          {opts.epicChip && epic && <span className="tag"><span className="tag__dot" style={{ background: epicColor(epic) }} />{epic.title}</span>}
          {blocked && (
            <span className="tag tag--blocked"
              title={blockedBy.length ? `Blocked by ${blockedBy.join(", ")}${reason ? ` · ${reason}` : ""}` : `Blocked: ${reason}`}>
              <Icon name="block" size={12} />{blockedBy.length ? `${blockedBy.length} block${blockedBy.length > 1 ? "s" : ""}` : "Blocked"}
            </span>
          )}
          {waits.map((r) => {
            const tp = window.SEED.PROJECTS.find((p) => p.id === r.toProject);
            return <span key={r.id} className="tag tag--waiting" title={`Waiting on ${tp.name}: ${r.title}`}>
              <Icon name="link" size={11} />waiting on {tp.key}
            </span>;
          })}
          {task.estimateMinutes != null && (
            <span className="tag tag--est" title="Estimated human time"><Icon name="clock" size={12} />{fmtEstimate(task.estimateMinutes)}</span>
          )}
          {task.notes && <span className="tag tag--muted" title="Has notes"><Icon name="note" size={12} /></span>}
          {task.branch && <MergeBadge state={task.mergeState} compact />}
          {task.mergeState === "merged" && (
            <span className="tag tag--merged" title="Merged to main">✓ merged</span>
          )}
          {task.status === "done" && task.mergeState !== "merged" && (
            <span className="tag tag--needsmerge" title="Done but not merged to main">⚠ not merged</span>
          )}
          {task.comments && task.comments.length > 0 && (
            <span className="tag tag--muted" title={`${task.comments.length} message${task.comments.length > 1 ? "s" : ""}`}>
              <Icon name="message" size={12} />{task.comments.length}
            </span>
          )}
        </div>
        {opts.avatars && <Avatar agent={agent} size={22} />}
      </div>
    </article>
  );
}

function epicColor(epic) {
  if (!epic) return "var(--border)";
  const proj = window.SEED.PROJECTS.find((p) => p.id === epic.projectId);
  return proj ? proj.color : "var(--accent)";
}

function Column({ col, tasks, ctx, onDropTask, onOpen, dragId, setDragId, addInColumn }) {
  const [over, setOver] = useState(false);
  return (
    <section
      className={`col ${over ? "col--over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onDropTask(dragId, col.id); }}
    >
      <header className="col__head">
        <div className="col__title">
          <span className={`col__swatch col__swatch--${col.id}`} />
          {col.label}
          <span className="col__count">{tasks.length}</span>
        </div>
        <button className="col__add" title="New ticket here" onClick={() => addInColumn(col.id)}>
          <Icon name="plus" size={15} />
        </button>
      </header>
      <div className="col__body">
        {[...tasks].sort((a, b) => (ctx.isBlocked(a) ? 1 : 0) - (ctx.isBlocked(b) ? 1 : 0)).map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            epic={ctx.epicOf(t)}
            story={ctx.storyOf(t)}
            agent={ctx.agentOf(t.assignee)}
            blockedBy={ctx.blockersOf(t)}
            waitingOn={ctx.openRequestsForTask(t.id)}
            density={ctx.density}
            opts={ctx.opts}
            dragging={dragId === t.id}
            onOpen={onOpen}
            onDragStart={(e, id) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragId(null)}
          />
        ))}
        {tasks.length === 0 && <div className="col__empty">Drop tickets here</div>}
      </div>
    </section>
  );
}

// KANBAN-908: done but not merged to main — the predicate behind the card
// "⚠ not merged" chip and the app-level "Done, not merged" filter (app.jsx).
function needsMerge(task) {
  return task.status === "done" && task.mergeState !== "merged";
}

function Board({ grouped, tasksByCol, ctx, onDropTask, onOpen, addInColumn }) {
  const [dragId, setDragId] = useState(null);

  if (grouped) {
    // Swimlanes by epic
    return (
      <div className="board board--lanes">
        {ctx.lanes.map((lane) => (
          <div className="lane" key={lane.epic ? lane.epic.id : "none"}>
            <div className="lane__head">
              <span className="lane__dot" style={{ background: epicColor(lane.epic) }} />
              <span className="lane__title">{lane.epic ? lane.epic.title : "No epic"}</span>
              <span className="lane__proj">{lane.projName}</span>
              <span className="lane__count">{lane.total}</span>
            </div>
            <div className="lane__cols">
              {window.COLUMNS.map((col) => (
                <Column key={col.id} col={col}
                  tasks={lane.byCol[col.id] || []}
                  ctx={ctx} onDropTask={onDropTask} onOpen={onOpen}
                  dragId={dragId} setDragId={setDragId} addInColumn={addInColumn} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="board">
      {window.COLUMNS.map((col) => (
        <Column key={col.id} col={col}
          tasks={tasksByCol[col.id] || []}
          ctx={ctx} onDropTask={onDropTask} onOpen={onOpen}
          dragId={dragId} setDragId={setDragId} addInColumn={addInColumn} />
      ))}
    </div>
  );
}

/* ============================================================
   Epics view: collapsible epic accordion with indented tickets
   (an alternative to the kanban board; same filtered task set)
   ============================================================ */

function TicketRow({ task, ctx, onOpen }) {
  const blockedBy = ctx.blockersOf(task);
  const reason = (task.blockedReason || "").trim();
  const blocked = blockedBy.length > 0 || !!reason;
  const agent = ctx.agentOf(task.assignee);
  return (
    <div className="ticketrow" onClick={() => onOpen(task.id)} data-screen-label={`row ${task.id}`}>
      <span className="ticketrow__id">{task.id}</span>
      <StatusPill status={task.status} />
      <PriorityBadge priority={task.priority} compact />
      <span className="ticketrow__title">{task.title}</span>
      <span className="ticketrow__chips">
        {task.estimateMinutes != null && (
          <span className="tag tag--est" title="Estimated human time"><Icon name="clock" size={12} />{fmtEstimate(task.estimateMinutes)}</span>
        )}
        {blocked && (
          <span className="tag tag--blocked"
            title={blockedBy.length ? `Blocked by ${blockedBy.join(", ")}${reason ? ` · ${reason}` : ""}` : `Blocked: ${reason}`}>
            <Icon name="block" size={12} />{blockedBy.length ? blockedBy.length : "blocked"}
          </span>
        )}
        {task.branch && <MergeBadge state={task.mergeState} compact />}
        {task.mergeState === "merged" && <span className="tag tag--merged" title="Merged to main">✓ merged</span>}
        {needsMerge(task) && <span className="tag tag--needsmerge" title="Done but not merged to main">⚠ not merged</span>}
        {task.comments && task.comments.length > 0 && (
          <span className="tag tag--muted" title={`${task.comments.length} message${task.comments.length > 1 ? "s" : ""}`}>
            <Icon name="message" size={12} />{task.comments.length}
          </span>
        )}
      </span>
      <Avatar agent={agent} size={20} />
    </div>
  );
}

function EpicsView({ groups, ctx, onOpen }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const toggle = (key) => setCollapsed((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  if (!groups.length) {
    return <div className="epics epics--empty">No tickets match the current filters.</div>;
  }

  return (
    <div className="epics">
      {groups.map((g) => {
        const key = g.epic ? g.epic.id : "none";
        const open = !collapsed.has(key);
        const totalMin = g.tasks.reduce((s, tk) => s + (tk.estimateMinutes || 0), 0);
        return (
          <section className={`epicgroup ${open ? "is-open" : ""}`} key={key}>
            <header className="epicgroup__head" onClick={() => toggle(key)} data-screen-label={`epic ${key}`}>
              <span className="epicgroup__chev"><Icon name={open ? "chevron-down" : "chevron-right"} size={16} /></span>
              <span className="epicgroup__dot" style={{ background: epicColor(g.epic) }} />
              <span className="epicgroup__title">{g.epic ? g.epic.title : "No epic"}</span>
              <span className="epicgroup__count">{g.tasks.length}</span>
              {totalMin > 0 && (
                <span className="epicgroup__est" title="Total estimated human time for this epic"><Icon name="clock" size={12} /> ~{fmtEstimate(totalMin)}</span>
              )}
              <span className="epicgroup__bar">
                {window.COLUMNS.map((c) => {
                  const n = g.tasks.filter((tk) => tk.status === c.id).length;
                  return n ? (
                    <span key={c.id} className={`epicgroup__seg col__swatch--${c.id}`} title={`${c.label}: ${n}`}>{n}</span>
                  ) : null;
                })}
              </span>
            </header>
            {open && (
              <div className="epicgroup__body">
                {g.tasks.map((tk) => <TicketRow key={tk.id} task={tk} ctx={ctx} onOpen={onOpen} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

Object.assign(window, { Board, TaskCard, Column, EpicsView, TicketRow, epicColor, needsMerge });

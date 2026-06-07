/* ============================================================
   Board: columns + cards + native drag & drop
   ============================================================ */

function TaskCard({ task, epic, story, agent, blockedBy, waitingOn, density, opts, onOpen, onDragStart, onDragEnd, dragging }) {
  const blocked = blockedBy.length > 0;
  const waits = waitingOn || [];
  return (
    <article
      className={`card ${dragging ? "card--dragging" : ""} ${density === "compact" ? "card--compact" : ""}`}
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
            <span className="tag tag--blocked" title={`Blocked by ${blockedBy.join(", ")}`}>
              <Icon name="block" size={12} />{blockedBy.length} block{blockedBy.length > 1 ? "s" : ""}
            </span>
          )}
          {waits.map((r) => {
            const tp = window.SEED.PROJECTS.find((p) => p.id === r.toProject);
            return <span key={r.id} className="tag tag--waiting" title={`Waiting on ${tp.name}: ${r.title}`}>
              <Icon name="link" size={11} />waiting on {tp.key}
            </span>;
          })}
          {task.notes && <span className="tag tag--muted" title="Has notes"><Icon name="note" size={12} /></span>}
          {task.branch && <MergeBadge state={task.mergeState} compact />}
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
        {tasks.map((t) => (
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

Object.assign(window, { Board, TaskCard, Column, epicColor });

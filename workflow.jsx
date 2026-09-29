/* ============================================================
   Global work and conversation view
   ============================================================ */

function WorkflowSummary({ task, onOpen, action }) {
  const workflow = task.workflow || {};
  return (
    <div className="workflow__row">
      <button className="workflow__row-main" onClick={() => onOpen(task)}>
        <span className="workflow__id">{task.id}</span>
        <span className="workflow__row-title">{task.title}</span>
        {workflow.kind && <span className="workflow__kind">{workflow.kind}</span>}
      </button>
      {action}
    </div>
  );
}

function WorkflowPublish({ task, onAction, canWrite }) {
  const [kind, setKind] = useState("information");
  const [summary, setSummary] = useState("");
  const [question, setQuestion] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workflow = task.workflow || {};
  const pendingQuestion = workflow.kind !== "information" && !!workflow.question
    && Number(workflow.revision || 0) > Number(workflow.discussedRevision || 0);
  const valid = summary.trim() && (kind === "information" || question.trim()) && !pendingQuestion;

  async function publish(event) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError("");
    try {
      await onAction(task.id, {
        action: "publish",
        revision: Number(workflow.revision || 0),
        kind,
        summary: summary.trim(),
        question: kind === "information" ? undefined : question.trim(),
        next_step: nextStep.trim() || undefined,
      });
      setSummary(""); setQuestion(""); setNextStep("");
    } catch (ex) {
      setError(ex.message || "Could not publish the update.");
    } finally { setBusy(false); }
  }

  return (
    <section className="workflow__publish">
      <h3>Publish an update</h3>
      {workflow.summary && (
        <div className="workflow__latest">
          <span className="workflow__eyebrow">Latest · revision {workflow.revision}</span>
          <p>{workflow.summary}</p>
          {workflow.question && <p><strong>Question:</strong> {workflow.question}</p>}
          {workflow.answer && <p><strong>Answer:</strong> {workflow.answer}</p>}
        </div>
      )}
      {pendingQuestion && <p className="workflow__hint">The current question needs an answer before another update can be published.</p>}
      {canWrite && (
        <form onSubmit={publish} className="workflow__form">
          <label className="fld"><span className="fld__k">Update type</span>
            <select className="textin" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="information">Information</option>
              <option value="confirmation">Confirmation</option>
              <option value="decision">Decision</option>
            </select>
          </label>
          <label className="fld"><span className="fld__k">Summary</span>
            <textarea className="textin" value={summary} onChange={(event) => setSummary(event.target.value)} rows="3" />
          </label>
          {kind !== "information" && <label className="fld"><span className="fld__k">Question</span>
            <textarea className="textin" value={question} onChange={(event) => setQuestion(event.target.value)} rows="2" />
          </label>}
          <label className="fld"><span className="fld__k">Next step (optional)</span>
            <input className="textin" value={nextStep} onChange={(event) => setNextStep(event.target.value)} />
          </label>
          {error && <p className="workflow__error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={!valid || busy}>{busy ? "Publishing…" : "Publish update"}</button>
        </form>
      )}
    </section>
  );
}

function WorkflowView({ onOpenTask, onTaskUpdate, canAnswer, canCreate, onNewTask }) {
  const [queues, setQueues] = useState({ work: [], conversation: [], deferred: [], active: [] });
  const [selected, setSelected] = useState(null);
  const [answer, setAnswer] = useState("");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [condition, setCondition] = useState("");
  const [showDefer, setShowDefer] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const selectedRef = useRef(null);

  function choose(task) {
    selectedRef.current = task;
    setSelected(task);
    setAnswer(""); setReason(""); setUntil(""); setCondition("");
    setShowDefer(false); setError("");
  }

  async function refresh(explicit) {
    if (busyRef.current) return;
    try {
      const next = await window.API.getWorkflow();
      setQueues(next);
      setError("");
      const current = selectedRef.current;
      const currentConversation = current && next.conversation.find((task) => task.id === current.id);
      if (explicit) {
        choose(currentConversation || next.conversation[0] || null);
      } else if (!current) {
        choose(next.conversation[0] || null);
      }
    } catch (ex) {
      setError(ex.message || "Could not load workflow.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    refresh(false);
    const timer = window.setInterval(() => refresh(false), 15000);
    const changed = () => refresh(false);
    window.addEventListener("kanban:workflow-changed", changed);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("kanban:workflow-changed", changed);
    };
  }, []);

  async function act(task, fields) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const updated = await window.API.workflowAction(task.id, { ...fields, revision: Number(task.workflow && task.workflow.revision || 0) });
      onTaskUpdate(updated);
      const next = await window.API.getWorkflow();
      setQueues(next);
      const current = selectedRef.current;
      if (current && current.id === task.id) {
        choose(next.conversation.find((item) => item.id === task.id) || next.conversation[0] || null);
      }
    } catch (ex) {
      setError(ex.message || "Could not save the action.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  const current = selected;
  const wf = current && current.workflow || {};
  const pending = current && Number(wf.revision || 0) > Number(wf.discussedRevision || 0);
  const needsAnswer = pending && (wf.kind === "confirmation" || wf.kind === "decision");
  const latest = current && queues.conversation.find((task) => task.id === current.id);
  const removed = current && !latest;
  const newer = latest && Number(latest.workflow && latest.workflow.revision || 0) !== Number(wf.revision || 0);
  const stale = removed || newer;

  return (
    <div className="workflow" data-screen-label="global workflow">
      <div className="workflow__heading">
        <div><h2>Work and conversation</h2><p>Review one update at a time across all projects.</p></div>
        <div className="workflow__actions">
          <button className="btn" onClick={() => refresh(true)} disabled={busy}>Refresh</button>
          {canCreate && <button className="btn btn--primary" onClick={onNewTask}><Icon name="plus" size={14} /> New card</button>}
        </div>
      </div>
      {error && <div className="workflow__error" role="alert">{error}</div>}
      {loading ? <p className="muted">Loading workflow…</p> : (
        <div className="workflow__grid">
          <section className="workflow__section workflow__section--conversation">
            <header><h3>Conversation <span>{queues.conversation.length}</span></h3></header>
            {current ? <>
              {newer && <div className="workflow__notice">A newer revision is available. Refresh to read it before answering.</div>}
              {removed && <div className="workflow__notice">This update changed in another session. Your draft is preserved. Refresh to continue.</div>}
              <div className="workflow__focus">
                <div className="workflow__focus-head">
                  <span className="workflow__id">{current.id}</span>
                  <span className="workflow__kind">{wf.kind || "update"}</span>
                  <span className="workflow__revision">Revision {wf.revision || 0}</span>
                </div>
                <button className="workflow__title-link" onClick={() => onOpenTask(current)}>{current.title}</button>
                <p className="workflow__summary">{wf.summary || "No summary provided."}</p>
                {wf.question && <div className="workflow__question"><span>Question</span><p>{wf.question}</p></div>}
                {wf.nextStep && <p className="workflow__next"><strong>Next step:</strong> {wf.nextStep}</p>}
                {needsAnswer && canAnswer && <label className="fld"><span className="fld__k">Your answer</span>
                  <textarea className="textin" rows="4" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your answer here…" />
                </label>}
                {needsAnswer && !canAnswer && <p className="workflow__hint">A human manager must answer this question.</p>}
                <div className="workflow__focus-actions">
                  {needsAnswer && canAnswer && <button className="btn btn--primary" disabled={!answer.trim() || busy || stale}
                    onClick={() => act(current, { action: "answer", answer: answer.trim() })}>Send answer</button>}
                  {!needsAnswer && canAnswer && <button className="btn btn--primary" disabled={busy || stale}
                    onClick={() => act(current, { action: "discuss" })}>Mark discussed</button>}
                  {!needsAnswer && !canAnswer && <p className="workflow__hint">A human manager must review this update.</p>}
                  <button className="btn" disabled={!!pending || busy || stale} onClick={() => choose(queues.conversation.find((item) => item.id !== current.id) || current)}>Next</button>
                  <button className="btn" disabled={busy || stale} onClick={() => setShowDefer(!showDefer)}>Defer</button>
                </div>
                {showDefer && <div className="workflow__defer">
                  <label className="fld"><span className="fld__k">Reason</span><textarea className="textin" value={reason} onChange={(event) => setReason(event.target.value)} rows="2" /></label>
                  <label className="fld"><span className="fld__k">Return date (optional)</span><input className="textin" type="datetime-local" value={until} onChange={(event) => setUntil(event.target.value)} /></label>
                  <label className="fld"><span className="fld__k">Return condition (optional)</span><input className="textin" value={condition} onChange={(event) => setCondition(event.target.value)} /></label>
                  <button className="btn btn--primary" disabled={!reason.trim() || !(until || condition.trim()) || busy || stale}
                    onClick={() => act(current, { action: "defer", reason: reason.trim(), until: until ? new Date(until).toISOString() : undefined, condition: condition.trim() || undefined })}>Defer card</button>
                </div>}
              </div>
              {queues.conversation.length > 1 && <div className="workflow__waiting"><span className="workflow__eyebrow">{queues.conversation.length - 1} more updates are waiting</span></div>}
            </> : <p className="workflow__empty">No updates need a response.</p>}
          </section>
          <div className="workflow__stack">
            <section className="workflow__section"><header><h3>Ready to work <span>{queues.work.length}</span></h3></header>
              {queues.work.map((task) => <WorkflowSummary key={task.id} task={task} onOpen={onOpenTask} />)}
              {!queues.work.length && <p className="workflow__empty">No unblocked cards are ready.</p>}
            </section>
            <section className="workflow__section"><header><h3>Active <span>{queues.active.length}</span></h3></header>
              {queues.active.map((task) => <WorkflowSummary key={task.id} task={task} onOpen={onOpenTask} />)}
              {!queues.active.length && <p className="workflow__empty">No active cards.</p>}
            </section>
            <section className="workflow__section"><header><h3>Deferred <span>{queues.deferred.length}</span></h3></header>
              {queues.deferred.map((task) => <div key={task.id}>
                <WorkflowSummary task={task} onOpen={onOpenTask} action={<button className="btn btn--sm" disabled={busy} onClick={() => act(task, { action: "resume" })}>Resume</button>} />
                {(task.workflow && (task.workflow.deferReason || task.workflow.returnCondition || task.workflow.deferredUntil)) &&
                  <p className="workflow__defer-note">
                    {task.workflow.deferredUntil && Date.parse(task.workflow.deferredUntil) <= Date.now() && <strong>Return due · </strong>}
                    {task.workflow.deferReason}{task.workflow.returnCondition && ` · ${task.workflow.returnCondition}`}{task.workflow.deferredUntil && ` · ${new Date(task.workflow.deferredUntil).toLocaleString()}`}
                  </p>}
              </div>)}
              {!queues.deferred.length && <p className="workflow__empty">No deferred cards.</p>}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { WorkflowView, WorkflowPublish });

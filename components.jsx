/* ============================================================
   Shared UI primitives + helpers. Exported to window.
   ============================================================ */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---- Minimal line-icon set (stroke, currentColor) ---------- */
function Icon({ name, size = 16, stroke = 1.6, style }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round",
    strokeLinejoin: "round", style,
  };
  switch (name) {
    case "search":  return <svg {...p}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>;
    case "plus":    return <svg {...p}><path d="M12 5v14M5 12h14"/></svg>;
    case "x":       return <svg {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>;
    case "chevron-down": return <svg {...p}><path d="m6 9 6 6 6-6"/></svg>;
    case "chevron-right":return <svg {...p}><path d="m9 6 6 6-6 6"/></svg>;
    case "filter":  return <svg {...p}><path d="M3 5h18l-7 8v6l-4 2v-8z"/></svg>;
    case "grip":    return <svg {...p}><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>;
    case "link":    return <svg {...p}><path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5l-2 2"/><path d="M13 17.5 11 19.5a3.5 3.5 0 0 1-5-5l2-2"/></svg>;
    case "block":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>;
    case "clock":   return <svg {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
    case "check":   return <svg {...p}><path d="m5 12 5 5 9-11"/></svg>;
    case "note":    return <svg {...p}><path d="M5 4h14v16l-4-3-3 3-3-3-4 3z"/></svg>;
    case "message": return <svg {...p}><path d="M4 5h16v11H9l-4 4V5z"/></svg>;
    case "user":    return <svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>;
    case "key":     return <svg {...p}><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 21 2m-4 0 3 3m-5 2 3 3"/></svg>;
    case "lock":    return <svg {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
    case "layout":  return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/></svg>;
    case "sliders": return <svg {...p}><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>;
    case "arrow-up":  return <svg {...p}><path d="M12 19V5M6 11l6-6 6 6"/></svg>;
    case "sort":    return <svg {...p}><path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3"/></svg>;
    case "folder":  return <svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>;
    case "dots":    return <svg {...p}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>;
    case "logout":  return <svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/></svg>;
    case "branch":  return <svg {...p}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
    case "merge":   return <svg {...p}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v0a9 9 0 0 0 9 9"/></svg>;
    case "trash":   return <svg {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"/></svg>;
    default: return null;
  }
}

/* ---- Assignee avatar --------------------------------------- */
function Avatar({ agent, size = 22, ring = false }) {
  if (!agent) {
    return (
      <span className="avatar avatar--empty" style={{ width: size, height: size }} title="Unassigned">
        <Icon name="user" size={size * 0.6} />
      </span>
    );
  }
  return (
    <span className="avatar" title={`${agent.name} · ${agent.role}`}
      style={{ width: size, height: size, background: agent.color,
               fontSize: size * 0.42, boxShadow: ring ? "0 0 0 2px var(--surface), 0 0 0 3px " + agent.color : "none" }}>
      {agent.initials}
      {agent.kind === "agent" && <span className="avatar__bot" style={{ width: size * 0.42, height: size * 0.42 }} />}
    </span>
  );
}

/* ---- Priority badge ---------------------------------------- */
function PriorityBadge({ priority, compact = false }) {
  const p = window.PRIORITIES.find((x) => x.id === priority) || window.PRIORITIES[2];
  return (
    <span className="prio" style={{ color: p.color }} title={`${p.label} priority`}>
      <span className="prio__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} style={{ background: i >= p.rank ? p.color : "currentColor",
                              opacity: i >= p.rank ? 1 : 0.18 }} />
        ))}
      </span>
      {!compact && <span className="prio__label">{p.label}</span>}
    </span>
  );
}

/* ---- Epic / project chips ---------------------------------- */
function EpicChip({ epic, onClick }) {
  if (!epic) return null;
  return (
    <button className="chip chip--epic" onClick={onClick} type="button">
      <span className="chip__dot" />{epic.title}
    </button>
  );
}

/* ---- Git merge badge --------------------------------------- */
function MergeBadge({ state, compact = false }) {
  const s = window.MERGE_STATES.find((x) => x.id === state) || window.MERGE_STATES[0];
  if (state === "none" || !state) return null;
  return (
    <span className={`merge merge--${s.id}`} title={s.label}
      style={{ color: s.color, background: `color-mix(in oklch, ${s.color} 13%, #fff)` }}>
      <Icon name={state === "merged" ? "merge" : "branch"} size={compact ? 11 : 13} />
      {compact ? s.short : s.label}
    </span>
  );
}

/* ---- Small status pill ------------------------------------- */
function StatusPill({ status }) {
  const col = window.COLUMNS.find((c) => c.id === status);
  return <span className={`statuspill statuspill--${status}`}>{col ? col.label : status}</span>;
}

/* ---- relative time ----------------------------------------- */
function relTime(iso) {
  const then = new Date(iso).getTime();
  const now = new Date("2026-04-25T18:00:00").getTime();
  const s = Math.max(1, Math.round((now - then) / 1000));
  const m = Math.round(s / 60), h = Math.round(m / 60), d = Math.round(h / 24);
  if (d >= 1) return d === 1 ? "yesterday" : `${d}d ago`;
  if (h >= 1) return `${h}h ago`;
  if (m >= 1) return `${m}m ago`;
  return "just now";
}

/* ---- Dropdown menu (click-outside aware) ------------------- */
function Menu({ trigger, children, align = "left", width = 220 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className="menu__pop" style={{ [align]: 0, width }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { Icon, Avatar, PriorityBadge, EpicChip, StatusPill, MergeBadge, relTime, Menu,
  useState, useEffect, useRef, useMemo, useCallback });

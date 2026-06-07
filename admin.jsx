/* ============================================================
   AdminPanel — admin-only overlay
   Three tabs:
   (a) Agents: searchable list + provision form with searchable grants
   (b) Permissions: searchable master-detail (by-agent or by-project)
   (c) Provision tokens: searchable list + create form with searchable scope
   ============================================================ */

/* ---- Inline styles embedded as a <style> tag --------------- */
const ADMIN_STYLE = `
  .admin-overlay {
    position: fixed; inset: 0; z-index: 4000;
    display: flex; align-items: stretch; justify-content: flex-end;
  }
  .admin-scrim {
    position: absolute; inset: 0;
    background: rgba(0,0,0,0.45);
  }
  .admin-panel {
    position: relative; z-index: 1;
    width: min(980px, 96vw);
    background: var(--surface, #faf9f7);
    display: flex; flex-direction: column;
    box-shadow: -4px 0 32px rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .admin-panel__head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 24px 14px;
    border-bottom: 1px solid var(--border, #e5e0d8);
    flex-shrink: 0;
  }
  .admin-panel__head h2 {
    margin: 0; font-size: 1.05em; font-weight: 600;
  }
  .admin-panel__tabs {
    display: flex; gap: 4px;
    padding: 10px 24px 0;
    border-bottom: 1px solid var(--border, #e5e0d8);
    flex-shrink: 0;
  }
  .admin-panel__tabs button {
    appearance: none; border: none; background: none;
    padding: 8px 14px; font: inherit; font-size: 0.88em;
    color: var(--text-muted, #888); cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
    border-radius: 0; transition: color 0.15s;
  }
  .admin-panel__tabs button.is-on {
    color: var(--accent, #D97757);
    border-bottom-color: var(--accent, #D97757);
    font-weight: 600;
  }
  .admin-panel__body {
    flex: 1; overflow: hidden; display: flex; flex-direction: column;
  }

  /* ---- Search bar ---- */
  .admin-search-wrap {
    position: relative; flex-shrink: 0;
  }
  .admin-search-wrap .admin-search-icon {
    position: absolute; left: 9px; top: 50%; transform: translateY(-50%);
    color: var(--text-muted, #888); pointer-events: none;
  }
  .admin-search {
    width: 100%; box-sizing: border-box;
    height: 32px; padding: 0 10px 0 32px;
    border: 1px solid var(--border, #e5e0d8); border-radius: 6px;
    background: var(--surface, #faf9f7); font: inherit; font-size: 0.88em;
    outline: none; color: inherit;
  }
  .admin-search:focus { border-color: var(--accent, #D97757); }

  /* ---- Scrollable content area ---- */
  .admin-scroll {
    flex: 1; overflow-y: auto; padding: 16px 24px;
  }
  .admin-scroll--compact { padding: 0; }

  /* ---- Sections ---- */
  .admin-section { margin-bottom: 24px; }
  .admin-section h3 {
    font-size: 0.82em; font-weight: 600; letter-spacing: 0.05em;
    text-transform: uppercase; color: var(--text-muted, #888);
    margin: 0 0 10px;
  }

  /* ---- Agent rows (agents tab) ---- */
  .admin-agent-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 0; border-bottom: 1px solid var(--border, #e5e0d8);
    font-size: 0.9em;
  }
  .admin-agent-row:last-child { border-bottom: none; }
  .admin-badge {
    font-size: 0.72em; font-weight: 600; padding: 2px 6px;
    background: var(--accent, #D97757); color: #fff; border-radius: 4px;
    letter-spacing: 0.04em;
  }
  .admin-badge--muted {
    font-size: 0.72em; font-weight: 600; padding: 2px 6px;
    background: var(--surface-raised, #e8e4de); color: var(--text-muted, #888);
    border-radius: 4px; letter-spacing: 0.04em;
  }

  /* ---- Forms ---- */
  .admin-form {
    background: var(--surface-raised, #f5f3ee);
    border: 1px solid var(--border, #e5e0d8);
    border-radius: 8px; padding: 16px; margin-top: 12px;
  }
  .admin-form h4 { margin: 0 0 12px; font-size: 0.9em; font-weight: 600; }
  .admin-fld { margin-bottom: 10px; }
  .admin-fld label {
    display: block; font-size: 0.8em; font-weight: 500;
    margin-bottom: 4px; color: var(--text-muted,#888);
  }
  .admin-fld input, .admin-fld select {
    width: 100%; box-sizing: border-box;
    height: 32px; padding: 0 10px;
    border: 1px solid var(--border, #e5e0d8); border-radius: 6px;
    background: var(--surface, #faf9f7); font: inherit; font-size: 0.88em;
    outline: none; color: inherit;
  }
  .admin-fld input:focus, .admin-fld select:focus {
    border-color: var(--accent, #D97757);
  }

  /* ---- Token display ---- */
  .admin-token-display {
    display: flex; align-items: center; gap: 8px;
    background: #1e1e2e; color: #a6e3a1; font-family: monospace;
    font-size: 0.85em; padding: 10px 14px; border-radius: 6px;
    margin: 10px 0; overflow-x: auto; flex-wrap: nowrap;
  }
  .admin-token-display span { flex: 1; word-break: break-all; }
  .admin-warn {
    font-size: 0.8em; color: var(--danger, #c0392b);
    margin: 6px 0 0;
  }
  .admin-err {
    color: var(--danger, #c0392b); font-size: 0.82em; margin: 6px 0 0;
  }
  .admin-ok {
    color: #2da44e; font-size: 0.82em; margin: 6px 0 0;
  }

  /* ---- Toggle button ---- */
  .toggle-btn {
    appearance: none; border: none; background: none;
    cursor: pointer; padding: 2px 6px; border-radius: 4px;
    font: inherit; font-size: 0.8em; font-weight: 600;
    border: 1px solid var(--border, #e5e0d8);
    color: var(--text-muted, #888);
    transition: background 0.12s;
  }
  .toggle-btn.is-on {
    background: var(--accent, #D97757); color: #fff; border-color: var(--accent, #D97757);
  }
  .toggle-btn:hover { opacity: 0.85; }

  /* ---- Grant / scope rows ---- */
  .admin-grant-row {
    display: flex; gap: 8px; align-items: center; margin-bottom: 6px;
    font-size: 0.85em;
  }
  .admin-grant-row select {
    height: 28px; padding: 0 6px; border: 1px solid var(--border, #e5e0d8);
    border-radius: 5px; background: var(--surface, #faf9f7); font: inherit; font-size: 0.88em;
    outline: none; color: inherit;
  }
  .admin-grant-row select:focus { border-color: var(--accent, #D97757); }

  /* ---- Chip picker (searchable project chips in forms) ---- */
  .chip-picker { margin-bottom: 8px; }
  .chip-picker__chips {
    display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; min-height: 0;
  }
  .chip-picker__chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--surface, #faf9f7); border: 1px solid var(--border, #e5e0d8);
    border-radius: 14px; padding: 2px 8px 2px 10px; font-size: 0.82em; font-weight: 500;
    cursor: default; white-space: nowrap;
  }
  .chip-picker__chip-dot {
    width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0;
  }
  .chip-picker__chip-remove {
    appearance: none; border: none; background: none; padding: 0 0 0 2px;
    cursor: pointer; color: var(--text-muted, #888); display: flex; align-items: center;
    line-height: 1;
  }
  .chip-picker__chip-remove:hover { color: var(--danger, #c0392b); }
  .chip-picker__chip-access {
    font-size: 0.82em; padding: 1px 4px; border-radius: 3px;
    border: 1px solid var(--border, #e5e0d8); background: var(--surface-raised, #f5f3ee);
    color: var(--text-muted, #888); cursor: pointer; font: inherit;
  }
  .chip-picker__chip-access:focus { outline: none; border-color: var(--accent, #D97757); }
  .chip-picker__dropdown {
    background: var(--surface, #faf9f7); border: 1px solid var(--border, #e5e0d8);
    border-radius: 6px; overflow: hidden; max-height: 160px; overflow-y: auto;
    margin-top: 4px; box-shadow: 0 4px 14px rgba(0,0,0,0.09);
  }
  .chip-picker__option {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; cursor: pointer; font-size: 0.85em;
    border-bottom: 1px solid var(--border, #e5e0d8);
    transition: background 0.1s;
  }
  .chip-picker__option:last-child { border-bottom: none; }
  .chip-picker__option:hover { background: var(--surface-raised, #f5f3ee); }
  .chip-picker__empty {
    padding: 10px; font-size: 0.82em; color: var(--text-muted, #888); text-align: center;
  }

  /* ---- Provision tokens list ---- */
  .pt-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid var(--border, #e5e0d8);
    font-size: 0.88em;
  }
  .pt-row:last-child { border-bottom: none; }
  .pt-row__info { flex: 1; }
  .pt-row__label { font-weight: 600; }
  .pt-row__meta { font-size: 0.8em; color: var(--text-muted, #888); margin-top: 2px; }
  .pt-scope-item { margin-top: 2px; font-size: 0.78em; color: var(--text-muted, #777); }

  /* ---- Master-detail layout ---- */
  .perm-layout {
    display: flex; flex: 1; overflow: hidden; min-height: 0;
  }
  .perm-master {
    width: 260px; flex-shrink: 0;
    border-right: 1px solid var(--border, #e5e0d8);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .perm-master__header {
    padding: 12px 14px 8px; border-bottom: 1px solid var(--border, #e5e0d8);
    flex-shrink: 0;
  }
  .perm-master__list {
    flex: 1; overflow-y: auto;
  }
  .perm-master__item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px; cursor: pointer;
    border-bottom: 1px solid var(--border, #e5e0d8);
    font-size: 0.88em; transition: background 0.1s;
  }
  .perm-master__item:last-child { border-bottom: none; }
  .perm-master__item:hover { background: var(--surface-raised, #f5f3ee); }
  .perm-master__item.is-selected {
    background: color-mix(in oklch, var(--accent, #D97757) 10%, var(--surface, #faf9f7));
    border-right: 3px solid var(--accent, #D97757);
  }
  .perm-master__item-name { font-weight: 500; flex: 1; min-width: 0; }
  .perm-master__item-hint {
    font-size: 0.76em; color: var(--text-muted, #888);
    white-space: nowrap; flex-shrink: 0;
  }

  .perm-detail {
    flex: 1; display: flex; flex-direction: column; overflow: hidden; min-width: 0;
  }
  .perm-detail__header {
    padding: 12px 16px 8px; border-bottom: 1px solid var(--border, #e5e0d8);
    flex-shrink: 0;
  }
  .perm-detail__title {
    font-size: 0.9em; font-weight: 600; margin-bottom: 6px;
    display: flex; align-items: center; gap: 8px;
  }
  .perm-detail__empty {
    flex: 1; display: flex; align-items: center; justify-content: center;
    color: var(--text-muted, #888); font-size: 0.9em; padding: 40px;
    text-align: center; line-height: 1.5;
  }
  .perm-detail__list {
    flex: 1; overflow-y: auto;
  }
  .perm-detail__row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 16px; border-bottom: 1px solid var(--border, #e5e0d8);
    font-size: 0.88em;
  }
  .perm-detail__row:last-child { border-bottom: none; }
  .perm-detail__proj-dot {
    width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0;
  }
  .perm-detail__proj-name { flex: 1; font-weight: 500; }
  .perm-detail__proj-key {
    font-size: 0.76em; color: var(--text-muted, #888); margin-left: 4px; font-weight: 400;
  }
  .perm-select {
    font: inherit; font-size: 0.85em; padding: 2px 6px;
    border: 1px solid var(--border, #e5e0d8); border-radius: 4px;
    background: var(--surface, #faf9f7); color: inherit; outline: none;
    cursor: pointer;
  }
  .perm-select:focus { border-color: var(--accent, #D97757); }
  .perm-select.is-write { border-color: #2da44e; color: #2da44e; }
  .perm-select.is-read { border-color: #0969da; color: #0969da; }
  .perm-saving { opacity: 0.5; pointer-events: none; }

  /* ---- Pivot toggle ---- */
  .perm-pivot {
    display: flex; gap: 4px; padding: 10px 14px;
    border-bottom: 1px solid var(--border, #e5e0d8); flex-shrink: 0;
    background: var(--surface-raised, #f5f3ee);
  }
  .perm-pivot__btn {
    appearance: none; border: 1px solid var(--border, #e5e0d8); background: var(--surface, #faf9f7);
    padding: 4px 12px; font: inherit; font-size: 0.82em; cursor: pointer;
    border-radius: 4px; color: var(--text-muted, #888); transition: all 0.12s;
  }
  .perm-pivot__btn.is-on {
    background: var(--accent, #D97757); color: #fff; border-color: var(--accent, #D97757);
    font-weight: 600;
  }

  /* ---- Empty + loading states ---- */
  .admin-empty {
    padding: 24px 0; text-align: center;
    color: var(--text-muted, #888); font-size: 0.88em;
  }
  .admin-loading {
    padding: 20px 0; color: var(--text-muted, #888); font-size: 0.88em;
  }

  /* ---- Filter bar (Agents tab header) ---- */
  .admin-filter-bar {
    display: flex; gap: 8px; align-items: center;
    padding: 12px 24px 0; flex-shrink: 0;
  }
  .admin-filter-bar .admin-search-wrap { flex: 1; }
  .admin-filter-select {
    height: 32px; padding: 0 8px; font: inherit; font-size: 0.82em;
    border: 1px solid var(--border, #e5e0d8); border-radius: 6px;
    background: var(--surface, #faf9f7); color: inherit; outline: none; cursor: pointer;
    flex-shrink: 0;
  }
  .admin-filter-select:focus { border-color: var(--accent, #D97757); }

  /* ---- Section inside scroll ---- */
  .admin-tokens-wrap { padding: 16px 24px; }
`;

/* ============================================================
   Utility: debounced search query — plain useState filter
   ============================================================ */
function useSearch(delay) {
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  const timerRef = useRef(null);
  const update = useCallback((val) => {
    setRaw(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setQ(val.trim().toLowerCase()), delay || 160);
  }, [delay]);
  return [raw, q, update];
}

/* ============================================================
   SearchInput — reusable search box
   ============================================================ */
function SearchInput({ value, onChange, placeholder, style }) {
  return (
    <div className="admin-search-wrap" style={style}>
      <span className="admin-search-icon"><Icon name="search" size={14} /></span>
      <input
        className="admin-search"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Search…"}
      />
    </div>
  );
}

/* ============================================================
   ChipPicker — searchable project picker with access control
   Used in the provision form and token scope builder.
   chips: [{projectId, access}]  or  [{projectId, maxAccess}]
   accessKey: "access" | "maxAccess"
   ============================================================ */
function ChipPicker({ projects, chips, onChange, accessKey, accessOptions, placeholder }) {
  const [searchRaw, searchQ, setSearch] = useSearch(160);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const ak = accessKey || "access";
  const opts = accessOptions || ["read", "write"];

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const selectedIds = new Set(chips.map((c) => c.projectId));
  const available = projects.filter((p) => {
    if (selectedIds.has(p.id)) return false;
    if (!searchQ) return true;
    return p.name.toLowerCase().includes(searchQ) || p.key.toLowerCase().includes(searchQ) || p.id.toLowerCase().includes(searchQ);
  });

  const addChip = (proj) => {
    onChange([...chips, { projectId: proj.id, [ak]: opts[0] }]);
    setOpen(false);
    setSearch("");
  };

  const removeChip = (projectId) => onChange(chips.filter((c) => c.projectId !== projectId));

  const setAccess = (projectId, val) =>
    onChange(chips.map((c) => c.projectId === projectId ? { ...c, [ak]: val } : c));

  return (
    <div className="chip-picker" ref={wrapRef}>
      {chips.length > 0 && (
        <div className="chip-picker__chips">
          {chips.map((chip) => {
            const proj = projects.find((p) => p.id === chip.projectId);
            if (!proj) return null;
            return (
              <span key={chip.projectId} className="chip-picker__chip">
                <span className="chip-picker__chip-dot" style={{ background: proj.color }} />
                {proj.name}
                <select
                  className="chip-picker__chip-access"
                  value={chip[ak]}
                  onChange={(e) => setAccess(chip.projectId, e.target.value)}
                  title="Access level"
                >
                  {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <button className="chip-picker__chip-remove" onClick={() => removeChip(chip.projectId)} title="Remove">
                  <Icon name="x" size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {projects.length > chips.length && (
        <div>
          <SearchInput
            value={searchRaw}
            onChange={(v) => { setSearch(v); setOpen(true); }}
            placeholder={placeholder || "Add project…"}
            style={{ marginBottom: 0 }}
          />
          {(open || searchRaw) && available.length > 0 && (
            <div className="chip-picker__dropdown">
              {available.map((p) => (
                <div key={p.id} className="chip-picker__option" onClick={() => addChip(p)}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                  <span style={{ fontSize: "0.8em", color: "var(--text-muted,#888)", marginLeft: 2 }}>{p.key}</span>
                </div>
              ))}
            </div>
          )}
          {(open || searchRaw) && available.length === 0 && (
            <div className="chip-picker__dropdown">
              <div className="chip-picker__empty">
                {searchRaw ? "No matching projects" : "All projects added"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TabAgents
   ============================================================ */
function TabAgents({ agents, projects, onAgentsChange }) {
  /* ---- list search / filter ---- */
  const [searchRaw, searchQ, setSearch] = useSearch(160);
  const [roleFilter, setRoleFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState(""); // filter by "has project X" — placeholder for future
  const [adminFilter, setAdminFilter] = useState(""); // "all"|"admin"|"non-admin"

  /* ---- provision form ---- */
  const [provId, setProvId] = useState("");
  const [provName, setProvName] = useState("");
  const [provRole, setProvRole] = useState("");
  const [provGrants, setProvGrants] = useState([]); // [{projectId, access}]
  const [provLoading, setProvLoading] = useState(false);
  const [provErr, setProvErr] = useState("");
  const [newToken, setNewToken] = useState(null);
  const [copied, setCopied] = useState(false);

  /* ---- filtered agents list ---- */
  const filteredAgents = useMemo(() => {
    let list = agents.slice();
    // admins first
    list.sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return (a.name || a.id).localeCompare(b.name || b.id);
    });
    if (adminFilter === "admin") list = list.filter((a) => a.isAdmin);
    if (adminFilter === "non-admin") list = list.filter((a) => !a.isAdmin);
    if (searchQ) {
      list = list.filter((a) =>
        (a.name || "").toLowerCase().includes(searchQ) ||
        (a.id || "").toLowerCase().includes(searchQ) ||
        (a.role || "").toLowerCase().includes(searchQ)
      );
    }
    return list;
  }, [agents, searchQ, adminFilter]);

  /* ---- distinct roles for filter dropdown ---- */
  const roles = useMemo(() => {
    const r = new Set(agents.map((a) => a.role).filter(Boolean));
    return Array.from(r).sort();
  }, [agents]);

  const doProvision = async () => {
    if (!provId.trim() || !provName.trim()) { setProvErr("ID and Name are required."); return; }
    setProvErr("");
    setProvLoading(true);
    try {
      const result = await window.API.provisionAgent({
        id: provId.trim(),
        name: provName.trim(),
        role: provRole.trim() || undefined,
        grants: provGrants.length > 0 ? provGrants : undefined,
      });
      setNewToken(result.token || null);
      setProvId(""); setProvName(""); setProvRole(""); setProvGrants([]);
      try {
        const freshAgents = await window.API.getAgents();
        onAgentsChange(freshAgents);
      } catch (_) {}
    } catch (ex) {
      setProvErr(ex.message || "Provisioning failed.");
    } finally {
      setProvLoading(false);
    }
  };

  const copyToken = () => {
    if (!newToken) return;
    try {
      navigator.clipboard.writeText(newToken).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (_) {}
  };

  const toggleAdmin = async (agent) => {
    try {
      await window.API.patchAgent(agent.id, { isAdmin: !agent.isAdmin });
      try {
        const freshAgents = await window.API.getAgents();
        onAgentsChange(freshAgents);
      } catch (_) {}
    } catch (ex) {
      console.error("patchAgent failed:", ex);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
      {/* Filter bar */}
      <div className="admin-filter-bar" style={{ paddingBottom: 10 }}>
        <SearchInput
          value={searchRaw}
          onChange={setSearch}
          placeholder="Search agents by name, ID, or role…"
        />
        <select className="admin-filter-select" value={adminFilter} onChange={(e) => setAdminFilter(e.target.value)} title="Filter by admin status">
          <option value="">All agents</option>
          <option value="admin">Admins only</option>
          <option value="non-admin">Non-admins</option>
        </select>
      </div>

      <div className="admin-scroll">
        {/* Agents list */}
        <div className="admin-section">
          <h3>Agents ({filteredAgents.length}{filteredAgents.length !== agents.length ? ` of ${agents.length}` : ""})</h3>
          {filteredAgents.length === 0 ? (
            <div className="admin-empty">
              {searchQ || adminFilter ? "No agents match your filter." : "No agents yet."}
            </div>
          ) : (
            filteredAgents.map((a) => (
              <div key={a.id} className="admin-agent-row">
                <Avatar agent={a} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  <span style={{ fontSize: "0.8em", color: "var(--text-muted,#888)", marginLeft: 6 }}>{a.id}</span>
                  {a.role && (
                    <span style={{ fontSize: "0.76em", marginLeft: 6, color: "var(--text-muted,#888)" }}>
                      · {a.role}
                    </span>
                  )}
                </span>
                {a.isAdmin && <span className="admin-badge">admin</span>}
                <button
                  className={`toggle-btn ${a.isAdmin ? "is-on" : ""}`}
                  title={a.isAdmin ? "Revoke admin" : "Grant admin"}
                  onClick={() => toggleAdmin(a)}
                >
                  {a.isAdmin ? "admin on" : "admin off"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Provision form */}
        <div className="admin-section">
          <h3>Provision agent</h3>
          <div className="admin-form">
            <h4>New agent</h4>
            <div className="admin-fld">
              <label>Agent ID (e.g. my-bot)</label>
              <input value={provId} onChange={(e) => setProvId(e.target.value)} placeholder="unique-id" />
            </div>
            <div className="admin-fld">
              <label>Display name</label>
              <input value={provName} onChange={(e) => setProvName(e.target.value)} placeholder="Bot Name" />
            </div>
            <div className="admin-fld">
              <label>Role (optional)</label>
              <input value={provRole} onChange={(e) => setProvRole(e.target.value)} placeholder="e.g. deployment-agent" />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.8em", fontWeight: 600, color: "var(--text-muted,#888)", marginBottom: 6 }}>
                Initial grants (optional) — search and pick projects
              </div>
              <ChipPicker
                projects={projects}
                chips={provGrants}
                onChange={setProvGrants}
                accessKey="access"
                accessOptions={["read", "write"]}
                placeholder="Search projects to grant access…"
              />
            </div>

            {provErr && <div className="admin-err">{provErr}</div>}
            <button
              className="btn btn--primary btn--sm"
              disabled={provLoading || !provId.trim() || !provName.trim()}
              onClick={doProvision}
            >
              {provLoading ? "Provisioning…" : "Create agent"}
            </button>

            {newToken && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: "0.82em", fontWeight: 600, marginBottom: 4 }}>
                  Agent token — copy it now, it will not be shown again:
                </div>
                <div className="admin-token-display">
                  <span>{newToken}</span>
                  <button className="btn btn--ghost btn--sm" onClick={copyToken} style={{ flexShrink: 0 }}>
                    {copied ? <Icon name="check" size={14} /> : <Icon name="note" size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="admin-warn">Store this token securely. It will not be displayed again.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PermDetailPanel — right-side detail for a selected agent or project
   Lazily loads permissions for the selected entity on selection.
   ============================================================ */
function PermDetailPanel({ pivot, selectedId, agents, projects, permCache, onPermCached }) {
  const [detailSearch, detailSearchQ, setDetailSearch] = useSearch(160);
  const [saving, setSaving] = useState({}); // { agentId_projId: true }
  const [loadErr, setLoadErr] = useState("");

  /* Decide what we're showing */
  const isAgentPivot = pivot === "agent";
  const selectedAgent = isAgentPivot ? agents.find((a) => a.id === selectedId) : null;
  const selectedProject = !isAgentPivot ? projects.find((p) => p.id === selectedId) : null;

  /* Lazy load: when pivot=agent and selectedAgent changes, load that agent's perms */
  useEffect(() => {
    if (!selectedId) return;
    if (isAgentPivot) {
      if (permCache[selectedId] !== undefined) return; // already loaded
      setLoadErr("");
      window.API.getPermissions(selectedId)
        .then((data) => {
          const perms = {};
          (data && data.permissions ? data.permissions : []).forEach((p) => {
            perms[p.projectId] = p.access;
          });
          onPermCached(selectedId, perms);
        })
        .catch(() => setLoadErr("Failed to load permissions for this agent."));
    } else {
      // project pivot: we need each agent's permissions for this project
      // We rely on the agent-keyed cache; load any agents we haven't cached yet
      const uncached = agents.filter((a) => permCache[a.id] === undefined);
      if (uncached.length === 0) return;
      setLoadErr("");
      Promise.all(
        uncached.map((a) =>
          window.API.getPermissions(a.id)
            .then((data) => {
              const perms = {};
              (data && data.permissions ? data.permissions : []).forEach((p) => {
                perms[p.projectId] = p.access;
              });
              return { agentId: a.id, perms };
            })
            .catch(() => ({ agentId: a.id, perms: {} }))
        )
      ).then((results) => {
        results.forEach(({ agentId, perms }) => onPermCached(agentId, perms));
      }).catch(() => setLoadErr("Failed to load some permissions."));
    }
  }, [selectedId, pivot]);

  if (!selectedId) {
    return (
      <div className="perm-detail">
        <div className="perm-detail__empty">
          {isAgentPivot
            ? "Select an agent on the left to view and edit their project permissions."
            : "Select a project on the left to view and edit which agents have access."}
        </div>
      </div>
    );
  }

  const handleChange = async (agentId, projectId, access) => {
    const key = agentId + "_" + projectId;
    // Optimistic update via cache
    onPermCached(agentId, { ...(permCache[agentId] || {}), [projectId]: access });
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await window.API.setPermission(agentId, projectId, access);
    } catch (ex) {
      console.error("setPermission failed:", ex);
    } finally {
      setSaving((s) => { const n = { ...s }; delete n[key]; return n; });
    }
  };

  if (isAgentPivot) {
    /* ---- Agent detail: show per-project access ---- */
    const cachedPerms = permCache[selectedId];
    const isLoading = cachedPerms === undefined;

    const filteredProjects = projects.filter((p) =>
      !detailSearchQ ||
      p.name.toLowerCase().includes(detailSearchQ) ||
      p.key.toLowerCase().includes(detailSearchQ)
    );

    return (
      <div className="perm-detail">
        <div className="perm-detail__header">
          <div className="perm-detail__title">
            <Avatar agent={selectedAgent} size={22} />
            <span>{selectedAgent ? selectedAgent.name : selectedId}</span>
            {selectedAgent && selectedAgent.isAdmin && (
              <span className="admin-badge" style={{ fontSize: "0.68em" }}>admin</span>
            )}
          </div>
          {selectedAgent && selectedAgent.isAdmin && (
            <div style={{ fontSize: "0.78em", color: "var(--text-muted,#888)", marginBottom: 6 }}>
              Admin agents bypass all project permission checks.
            </div>
          )}
          <SearchInput
            value={detailSearch}
            onChange={setDetailSearch}
            placeholder="Filter projects…"
          />
        </div>
        {loadErr && <div className="admin-err" style={{ padding: "8px 16px" }}>{loadErr}</div>}
        {isLoading && !loadErr && (
          <div className="admin-loading" style={{ padding: "16px" }}>Loading permissions…</div>
        )}
        {!isLoading && (
          <div className="perm-detail__list">
            {filteredProjects.length === 0 ? (
              <div className="admin-empty">No projects match your filter.</div>
            ) : (
              filteredProjects.map((p) => {
                const cur = (cachedPerms && cachedPerms[p.id]) || "none";
                const key = selectedId + "_" + p.id;
                const isSaving = !!saving[key];
                const isAdmin = selectedAgent && selectedAgent.isAdmin;
                return (
                  <div key={p.id} className={`perm-detail__row ${isSaving ? "perm-saving" : ""}`}>
                    <span className="perm-detail__proj-dot" style={{ background: p.color }} />
                    <span className="perm-detail__proj-name">
                      {p.name}
                      <span className="perm-detail__proj-key">{p.key}</span>
                    </span>
                    <select
                      className={`perm-select ${cur === "write" ? "is-write" : cur === "read" ? "is-read" : ""}`}
                      value={cur}
                      disabled={isSaving || isAdmin}
                      onChange={(e) => handleChange(selectedId, p.id, e.target.value)}
                      title={isAdmin ? "Admin bypasses project permissions" : undefined}
                    >
                      <option value="none">none</option>
                      <option value="read">read</option>
                      <option value="write">write</option>
                    </select>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  /* ---- Project detail: show per-agent access ---- */
  const filteredAgents = agents.filter((a) =>
    !detailSearchQ ||
    (a.name || "").toLowerCase().includes(detailSearchQ) ||
    (a.id || "").toLowerCase().includes(detailSearchQ) ||
    (a.role || "").toLowerCase().includes(detailSearchQ)
  );

  // Check if we're still loading any agent perms
  const pendingAgents = agents.filter((a) => permCache[a.id] === undefined);
  const isLoadingProject = pendingAgents.length > 0;

  return (
    <div className="perm-detail">
      <div className="perm-detail__header">
        <div className="perm-detail__title">
          {selectedProject && (
            <span style={{ width: 12, height: 12, borderRadius: 2, background: selectedProject.color, display: "inline-block" }} />
          )}
          <span>{selectedProject ? selectedProject.name : selectedId}</span>
          {selectedProject && (
            <span style={{ fontSize: "0.78em", color: "var(--text-muted,#888)", fontWeight: 400 }}>{selectedProject.key}</span>
          )}
        </div>
        <SearchInput
          value={detailSearch}
          onChange={setDetailSearch}
          placeholder="Filter agents…"
        />
      </div>
      {loadErr && <div className="admin-err" style={{ padding: "8px 16px" }}>{loadErr}</div>}
      {isLoadingProject && !loadErr && (
        <div className="admin-loading" style={{ padding: "16px" }}>Loading permissions…</div>
      )}
      {!isLoadingProject && (
        <div className="perm-detail__list">
          {filteredAgents.length === 0 ? (
            <div className="admin-empty">No agents match your filter.</div>
          ) : (
            filteredAgents.map((a) => {
              const agentPerms = permCache[a.id] || {};
              const cur = agentPerms[selectedId] || "none";
              const key = a.id + "_" + selectedId;
              const isSaving = !!saving[key];
              return (
                <div key={a.id} className={`perm-detail__row ${isSaving ? "perm-saving" : ""}`}>
                  <Avatar agent={a} size={20} />
                  <span className="perm-detail__proj-name">
                    {a.name}
                    <span className="perm-detail__proj-key">{a.id}</span>
                    {a.role && <span className="perm-detail__proj-key">· {a.role}</span>}
                  </span>
                  {a.isAdmin && <span className="admin-badge" style={{ fontSize: "0.68em" }}>admin</span>}
                  <select
                    className={`perm-select ${cur === "write" ? "is-write" : cur === "read" ? "is-read" : ""}`}
                    value={cur}
                    disabled={isSaving || a.isAdmin}
                    onChange={(e) => handleChange(a.id, selectedId, e.target.value)}
                    title={a.isAdmin ? "Admin bypasses project permissions" : undefined}
                  >
                    <option value="none">none</option>
                    <option value="read">read</option>
                    <option value="write">write</option>
                  </select>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TabPermissions — master-detail view with pivot
   ============================================================ */
function TabPermissions({ agents, projects }) {
  const [pivot, setPivot] = useState("agent"); // "agent" | "project"
  const [selectedId, setSelectedId] = useState(null);
  const [masterSearch, masterSearchQ, setMasterSearch] = useSearch(160);
  // Shared permission cache: { agentId: { projectId: access } }
  const [permCache, setPermCache] = useState({});

  const onPermCached = useCallback((agentId, perms) => {
    setPermCache((c) => ({ ...c, [agentId]: perms }));
  }, []);

  // Reset selection when pivot changes
  const switchPivot = (p) => {
    setPivot(p);
    setSelectedId(null);
    setMasterSearch("");
  };

  /* ---- Master list items ---- */
  const masterItems = useMemo(() => {
    if (pivot === "agent") {
      let list = agents.slice().sort((a, b) => {
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      });
      if (masterSearchQ) {
        list = list.filter((a) =>
          (a.name || "").toLowerCase().includes(masterSearchQ) ||
          (a.id || "").toLowerCase().includes(masterSearchQ) ||
          (a.role || "").toLowerCase().includes(masterSearchQ)
        );
      }
      return list;
    } else {
      let list = projects.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      if (masterSearchQ) {
        list = list.filter((p) =>
          (p.name || "").toLowerCase().includes(masterSearchQ) ||
          (p.key || "").toLowerCase().includes(masterSearchQ) ||
          (p.id || "").toLowerCase().includes(masterSearchQ)
        );
      }
      return list;
    }
  }, [pivot, agents, projects, masterSearchQ]);

  /* hint text for each master item */
  const getHint = (item) => {
    if (pivot === "agent") {
      const cached = permCache[item.id];
      if (!cached) return null;
      const count = Object.values(cached).filter((v) => v && v !== "none").length;
      if (count === 0) return "no access";
      return `${count} project${count !== 1 ? "s" : ""}`;
    } else {
      // count how many agents have any access to this project
      const count = agents.filter((a) => {
        const c = permCache[a.id];
        return c && c[item.id] && c[item.id] !== "none";
      }).length;
      if (count === 0) return "no agents";
      return `${count} agent${count !== 1 ? "s" : ""}`;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
      {/* Pivot selector */}
      <div className="perm-pivot">
        <span style={{ fontSize: "0.82em", color: "var(--text-muted,#888)", marginRight: 4, alignSelf: "center" }}>View by:</span>
        <button
          className={`perm-pivot__btn ${pivot === "agent" ? "is-on" : ""}`}
          onClick={() => switchPivot("agent")}
        >
          <Icon name="user" size={12} /> Agent
        </button>
        <button
          className={`perm-pivot__btn ${pivot === "project" ? "is-on" : ""}`}
          onClick={() => switchPivot("project")}
        >
          <Icon name="folder" size={12} /> Project
        </button>
      </div>

      <div className="perm-layout">
        {/* Master list */}
        <div className="perm-master">
          <div className="perm-master__header">
            <SearchInput
              value={masterSearch}
              onChange={setMasterSearch}
              placeholder={pivot === "agent" ? "Search agents…" : "Search projects…"}
            />
          </div>
          <div className="perm-master__list">
            {masterItems.length === 0 ? (
              <div className="admin-empty" style={{ padding: "20px 14px" }}>
                {masterSearchQ ? "No matches." : (pivot === "agent" ? "No agents." : "No projects.")}
              </div>
            ) : (
              masterItems.map((item) => {
                const hint = getHint(item);
                return (
                  <div
                    key={item.id}
                    className={`perm-master__item ${selectedId === item.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedId(item.id); }}
                  >
                    {pivot === "agent" ? (
                      <Avatar agent={item} size={22} />
                    ) : (
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: "inline-block", flexShrink: 0 }} />
                    )}
                    <span className="perm-master__item-name">
                      {item.name}
                      {pivot === "agent" && item.isAdmin && (
                        <span className="admin-badge" style={{ fontSize: "0.66em", marginLeft: 4 }}>admin</span>
                      )}
                    </span>
                    {hint && <span className="perm-master__item-hint">{hint}</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Detail panel */}
        <PermDetailPanel
          pivot={pivot}
          selectedId={selectedId}
          agents={agents}
          projects={projects}
          permCache={permCache}
          onPermCached={onPermCached}
        />
      </div>
    </div>
  );
}

/* ============================================================
   TabTokens
   ============================================================ */
function TabTokens({ projects }) {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [searchRaw, searchQ, setSearch] = useSearch(160);

  /* Create form */
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState([]); // [{projectId, maxAccess}]
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [newTok, setNewTok] = useState(null);
  const [copied, setCopied] = useState(false);

  async function loadTokens() {
    setLoading(true);
    setLoadErr("");
    try {
      const data = await window.API.listProvisionTokens();
      setTokens(Array.isArray(data) ? data : []);
    } catch (ex) {
      setLoadErr("Failed to load provision tokens.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTokens(); }, []);

  const doCreate = async () => {
    if (!label.trim()) { setCreateErr("Label is required."); return; }
    setCreateErr("");
    setCreating(true);
    try {
      const result = await window.API.createProvisionToken({ label: label.trim(), scope });
      setNewTok(result.token || null);
      setLabel(""); setScope([]);
      await loadTokens();
    } catch (ex) {
      setCreateErr(ex.message || "Failed to create token.");
    } finally {
      setCreating(false);
    }
  };

  const doRevoke = async (id) => {
    try {
      await window.API.deleteProvisionToken(id);
      setTokens((t) => t.filter((x) => x.id !== id));
    } catch (ex) {
      console.error("deleteProvisionToken failed:", ex);
    }
  };

  const copyNewTok = () => {
    if (!newTok) return;
    try {
      navigator.clipboard.writeText(newTok).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch (_) {}
  };

  const fmtDate = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(); } catch (_) { return iso; }
  };

  const filteredTokens = useMemo(() => {
    if (!searchQ) return tokens;
    return tokens.filter((t) =>
      (t.label || "").toLowerCase().includes(searchQ) ||
      (t.tokenPrefix || "").toLowerCase().includes(searchQ)
    );
  }, [tokens, searchQ]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
      <div className="admin-filter-bar" style={{ paddingBottom: 10 }}>
        <SearchInput
          value={searchRaw}
          onChange={setSearch}
          placeholder="Search tokens by label or prefix…"
        />
      </div>

      <div className="admin-scroll">
        {/* Existing tokens list */}
        <div className="admin-section">
          <h3>
            Provision tokens ({filteredTokens.length}{filteredTokens.length !== tokens.length ? ` of ${tokens.length}` : ""})
          </h3>
          {loading && <div className="admin-loading">Loading…</div>}
          {loadErr && <div className="admin-err">{loadErr}</div>}
          {!loading && tokens.length === 0 && (
            <div className="admin-empty">No provision tokens yet.</div>
          )}
          {!loading && tokens.length > 0 && filteredTokens.length === 0 && (
            <div className="admin-empty">No tokens match your search.</div>
          )}
          {filteredTokens.map((tok) => (
            <div key={tok.id} className="pt-row">
              <div className="pt-row__info">
                <div className="pt-row__label">{tok.label}</div>
                <div className="pt-row__meta">
                  <span>Prefix: <code style={{ fontSize: "0.9em" }}>{tok.tokenPrefix}</code></span>
                  {tok.createdAt && <span style={{ marginLeft: 10 }}>Created: {fmtDate(tok.createdAt)}</span>}
                </div>
                {(tok.scope || []).length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    {tok.scope.map((s, i) => {
                      const proj = projects.find((p) => p.id === s.projectId);
                      return (
                        <div key={i} className="pt-scope-item">
                          {proj ? proj.name : s.projectId}: max <strong>{s.maxAccess}</strong>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="pt-scope-item" style={{ fontStyle: "italic" }}>
                    No project grants (token usable for agent creation only)
                  </div>
                )}
              </div>
              <button
                className="btn btn--ghost btn--sm"
                style={{ flexShrink: 0, color: "var(--danger,#c0392b)" }}
                onClick={() => doRevoke(tok.id)}
              >
                <Icon name="trash" size={13} /> Revoke
              </button>
            </div>
          ))}
        </div>

        {/* Create form */}
        <div className="admin-section">
          <h3>Create provision token</h3>
          <div className="admin-form">
            <div className="admin-fld">
              <label>Label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. onboarding-2026" />
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.8em", fontWeight: 600, color: "var(--text-muted,#888)", marginBottom: 6 }}>
                Scope — project access ceiling (leave empty for create-only)
              </div>
              <ChipPicker
                projects={projects}
                chips={scope}
                onChange={setScope}
                accessKey="maxAccess"
                accessOptions={["read", "write"]}
                placeholder="Search projects to add to scope…"
              />
            </div>

            {createErr && <div className="admin-err">{createErr}</div>}
            <button
              className="btn btn--primary btn--sm"
              disabled={creating || !label.trim()}
              onClick={doCreate}
            >
              {creating ? "Creating…" : "Create token"}
            </button>

            {newTok && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: "0.82em", fontWeight: 600, marginBottom: 4 }}>
                  New token — copy now, shown once only:
                </div>
                <div className="admin-token-display">
                  <span>{newTok}</span>
                  <button className="btn btn--ghost btn--sm" onClick={copyNewTok} style={{ flexShrink: 0 }}>
                    {copied ? <Icon name="check" size={14} /> : <Icon name="note" size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="admin-warn">This token will not be shown again. Store it securely.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   AdminPanel (root) — receives agents, projects, onClose from app.jsx
   ============================================================ */
function AdminPanel({ agents: initialAgents, projects, onClose }) {
  const [tab, setTab] = useState("agents");
  const [agents, setAgents] = useState(initialAgents || []);

  // Keep agents in sync if parent updates
  useEffect(() => { setAgents(initialAgents || []); }, [initialAgents]);

  return (
    <>
      <style>{ADMIN_STYLE}</style>
      <div className="admin-overlay" role="dialog" aria-label="Admin panel">
        <div className="admin-scrim" onClick={onClose} />
        <div className="admin-panel">
          <div className="admin-panel__head">
            <h2><Icon name="sliders" size={16} /> Admin panel</h2>
            <button className="iconbtn" onClick={onClose} title="Close"><Icon name="x" size={18} /></button>
          </div>
          <div className="admin-panel__tabs">
            <button className={tab === "agents" ? "is-on" : ""} onClick={() => setTab("agents")}>
              <Icon name="user" size={14} /> Agents
            </button>
            <button className={tab === "permissions" ? "is-on" : ""} onClick={() => setTab("permissions")}>
              <Icon name="lock" size={14} /> Permissions
            </button>
            <button className={tab === "tokens" ? "is-on" : ""} onClick={() => setTab("tokens")}>
              <Icon name="key" size={14} /> Provision tokens
            </button>
          </div>
          <div className="admin-panel__body">
            {tab === "agents" && (
              <TabAgents agents={agents} projects={projects} onAgentsChange={setAgents} />
            )}
            {tab === "permissions" && (
              <TabPermissions agents={agents} projects={projects} />
            )}
            {tab === "tokens" && (
              <TabTokens projects={projects} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AdminPanel });

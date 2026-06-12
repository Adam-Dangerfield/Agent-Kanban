/* ============================================================
   Account modal — change password + manage passkeys (WebAuthn).
   Reached from the nameplate menu. Only shown for password-based
   (human) logins; agent-token sessions don't have a password.
   ============================================================ */

function fmtDate(s) {
  if (!s) return "never";
  try { return new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch (_) { return s; }
}

function PasswordSection() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { kind: 'ok'|'err', text }

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) { setMsg({ kind: "err", text: "New password must be at least 8 characters." }); return; }
    if (next !== confirm) { setMsg({ kind: "err", text: "New password and confirmation don't match." }); return; }
    setBusy(true);
    try {
      await window.API.changePassword(cur, next);
      setMsg({ kind: "ok", text: "Password updated." });
      setCur(""); setNext(""); setConfirm("");
    } catch (ex) {
      setMsg({ kind: "err", text: ex.message || "Could not change password." });
    } finally { setBusy(false); }
  };

  return (
    <form className="acct__sec" onSubmit={submit}>
      <h4 className="acct__h">Password</h4>
      <label className="fld">
        <span className="fld__k">Current password</span>
        <input type="password" className="textin" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="fld">
        <span className="fld__k">New password</span>
        <input type="password" className="textin" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        <span className="fld__hint">At least 8 characters.</span>
      </label>
      <label className="fld">
        <span className="fld__k">Confirm new password</span>
        <input type="password" className="textin" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {msg && <div className={msg.kind === "ok" ? "acct__ok" : "acct__err"}>{msg.text}</div>}
      <div className="acct__actions">
        <button className="btn btn--primary" type="submit" disabled={busy || !cur || !next}>
          {busy ? "Saving…" : "Update password"}
        </button>
      </div>
    </form>
  );
}

function PasskeySection() {
  const supported = typeof window.PublicKeyCredential !== "undefined" && !!window.SimpleWebAuthnBrowser;
  const [creds, setCreds] = useState(null);   // null = loading
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const refresh = async () => {
    try { setCreds(await window.API.listPasskeys()); }
    catch (ex) { setMsg({ kind: "err", text: ex.message || "Could not load passkeys." }); setCreds([]); }
  };
  useEffect(() => { if (supported) refresh(); }, []);

  const add = async () => {
    setMsg(null); setBusy(true);
    try {
      const label = (navigator.platform || "Passkey").toString().slice(0, 40);
      await window.API.registerPasskey(label);
      setMsg({ kind: "ok", text: "Passkey added." });
      await refresh();
    } catch (ex) {
      // User cancelling the browser prompt throws — keep the message gentle.
      const t = (ex && ex.name === "NotAllowedError") ? "Passkey enrolment was cancelled." : (ex.message || "Could not add passkey.");
      setMsg({ kind: "err", text: t });
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    setMsg(null);
    try { await window.API.deletePasskey(id); await refresh(); }
    catch (ex) { setMsg({ kind: "err", text: ex.message || "Could not remove passkey." }); }
  };

  return (
    <div className="acct__sec">
      <h4 className="acct__h">Passkeys</h4>
      <p className="acct__lede">
        Sign in without a password using your device's biometrics or a security key.
      </p>
      {!supported && <div className="acct__err">This browser doesn't support passkeys.</div>}
      {supported && (
        <>
          {creds === null && <div className="acct__muted">Loading…</div>}
          {creds && creds.length === 0 && <div className="acct__muted">No passkeys yet.</div>}
          {creds && creds.length > 0 && (
            <ul className="acct__list">
              {creds.map((c) => (
                <li key={c.id} className="acct__row">
                  <span className="acct__rowicon"><Icon name="key" size={15} /></span>
                  <span className="acct__rowmain">
                    <span className="acct__rowname">{c.device_label || "Passkey"}</span>
                    <span className="acct__rowmeta">added {fmtDate(c.created_at)} · last used {fmtDate(c.last_used_at)}</span>
                  </span>
                  <button className="btn btn--ghost btn--sm" onClick={() => remove(c.id)} title="Remove this passkey">Remove</button>
                </li>
              ))}
            </ul>
          )}
          {msg && <div className={msg.kind === "ok" ? "acct__ok" : "acct__err"}>{msg.text}</div>}
          <div className="acct__actions">
            <button className="btn btn--primary" onClick={add} disabled={busy}>
              <Icon name="plus" size={14} /> {busy ? "Waiting for device…" : "Add a passkey"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AccountModal({ onClose }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-label="Account settings">
        <header className="modal__head">
          <h3><Icon name="user" size={17} /> Account</h3>
          <button className="iconbtn" onClick={onClose}><Icon name="x" size={18} /></button>
        </header>
        <div className="modal__body">
          <PasswordSection />
          <div className="acct__div" />
          <PasskeySection />
        </div>
        <footer className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </footer>
      </div>
    </>
  );
}

Object.assign(window, { AccountModal });

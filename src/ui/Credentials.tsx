import { useEffect, useState } from 'react';
import { credentialsInfo, saveClientCredentials, clearClientCredentials } from '../sync/engine';
import type { CredentialsInfo } from '../sync/backend';

/** Lets Jeffrey paste the downloaded Google OAuth JSON; stored in the OS keychain, overrides the built-in one. */
export function CredentialsPanel({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [info, setInfo] = useState<CredentialsInfo | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { credentialsInfo().then(setInfo).catch(() => setInfo(null)); }, []);
  const save = async () => {
    setMsg(null);
    try {
      const i = await saveClientCredentials(text);
      setInfo(i); setText('');
      setMsg({ ok: true, text: 'Saved to your keychain. Now click Connect Google.' });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const reset = async () => { setInfo(await clearClientCredentials()); setMsg({ ok: true, text: 'Removed — using the built-in credentials.' }); };
  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--grid)', paddingTop: 12 }}>
      <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '▾' : '▸'} Use my Google credentials file
      </button>
      {info?.source && <div className="hint" style={{ marginTop: 4 }}>In use: {info.source} · secret {info.secret}</div>}
      {open && (
        <div className="form" style={{ marginTop: 8 }}>
          <label>Open the OAuth JSON you downloaded from Google Cloud (TextEdit works), select all, copy, and paste it here:
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4} spellCheck={false}
              placeholder='{"installed":{"client_id":"….apps.googleusercontent.com", … "client_secret":"GOCSPX-…", …}}'
              style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--axis)', borderRadius: 8, padding: 8 }} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary small" disabled={!text.trim()} onClick={save}>Save credentials</button>
            {info?.source === 'saved in this app' && <button className="btn small" onClick={reset}>Remove saved credentials</button>}
          </div>
          <div className="hint">Stored only in this computer's {navigator.platform.toLowerCase().includes('win') ? 'Credential Manager' : 'Keychain'}. Do this once on each computer.</div>
        </div>
      )}
      {msg && <div className={`hint ${msg.ok ? 'ok' : 'bad'}`} role="status" style={{ marginTop: 6 }}>{msg.text}</div>}
    </div>
  );
}

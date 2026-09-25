import { useEffect, useMemo, useState } from 'react';
import { RangeCtx, RangePicker, useSync, type Range } from './ui/common';
import { connect, sync, chooseFolder, installUpdate } from './sync/engine';
import Dashboard from './pages/Dashboard';
import Bodyweight from './pages/Bodyweight';
import Strength from './pages/Strength';
import Endurance from './pages/Endurance';
import QuickEntry from './pages/QuickEntry';
import Review from './pages/Review';
import Settings from './pages/Settings';
import { CredentialsPanel } from './ui/Credentials';

export type Page = 'dashboard' | 'bodyweight' | 'strength' | 'endurance' | 'quick' | 'review' | 'settings';
const PAGES: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'strength', label: 'Strength' },
  { id: 'endurance', label: 'Endurance' },
  { id: 'quick', label: 'Quick Entry' },
  { id: 'review', label: 'Review' },
  { id: 'settings', label: 'Settings' },
];

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* per-viewer convenience only */ } };

function ago(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function App() {
  const s = useSync();
  const [page, setPageState] = useState<Page>(() => (location.hash.slice(1) as Page) || load('page', 'dashboard'));
  const [range, setRangeState] = useState<Range>(() => load('range', { preset: '30D' }));
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => load('theme', 'system'));
  const [toast, setToast] = useState<string | null>(null);
  const [, tick] = useState(0);

  const setPage = (p: Page) => { setPageState(p); save('page', p); history.replaceState(null, '', `#${p}`); };
  const setRange = (r: Range) => { setRangeState(r); save('range', r); };
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    save('theme', theme);
  }, [theme]);
  useEffect(() => {
    const on = (e: Event) => { setToast((e as CustomEvent).detail); setTimeout(() => setToast(null), 4500); };
    window.addEventListener('toast', on);
    const onHash = () => { const h = location.hash.slice(1) as Page; if (PAGES.some(p => p.id === h)) setPageState(h); };
    window.addEventListener('hashchange', onHash);
    const t = setInterval(() => tick(x => x + 1), 30_000); // keep "Last synced" fresh
    return () => { window.removeEventListener('toast', on); window.removeEventListener('hashchange', onHash); clearInterval(t); };
  }, []);

  const reviewCount = s.dataset.review.length;
  const rangeCtx = useMemo(() => ({ range, setRange }), [range]);
  const hasData = s.files.length > 0;

  if (!s.ready) return <div className="setup"><div className="card"><span className="spin" /> Loading…</div></div>;

  if (s.auth === 'disconnected' && !hasData) return <Setup />;

  const title = PAGES.find(p => p.id === page)?.label;
  const showRange = page !== 'quick' && page !== 'settings' && page !== 'review';

  return (
    <RangeCtx.Provider value={rangeCtx}>
      <div className="app">
        <nav className="sidebar" aria-label="Sections">
          <div className="brand"><span className="dot" />Health Tracker</div>
          {PAGES.map(p => (
            <button key={p.id} className={`nav-btn ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)} aria-current={page === p.id ? 'page' : undefined}>
              {p.label}
              {p.id === 'review' && reviewCount > 0 && <span className="badge" aria-label={`${reviewCount} to review`}>{reviewCount}</span>}
            </button>
          ))}
          <div className="spacer" />
          <div className="foot">
            <div className="seg" role="group" aria-label="Theme" style={{ marginBottom: 8 }}>
              {(['system', 'light', 'dark'] as const).map(t => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t === 'system' ? 'Auto' : t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
            {s.version && <div>v{s.version}{s.backendKind === 'mock' ? ' · preview data' : ''}</div>}
          </div>
        </nav>
        <main className="main">
          <Banners onGo={setPage} />
          <div className="topbar">
            <h1>{title}</h1>
            {showRange && <RangePicker />}
            <div className="sync" aria-live="polite">
              {s.syncing ? <><span className="spin" /> Syncing…</> : <>Last synced: {ago(s.lastSynced)}</>}
              <button className="btn small" onClick={() => sync()} disabled={s.syncing || s.auth !== 'connected'} title="Refresh from Google Sheets">↻ Refresh</button>
            </div>
          </div>
          <div className={`content ${s.syncing ? 'dim' : ''}`}>
            {page === 'dashboard' && <Dashboard go={setPage} />}
            {page === 'bodyweight' && <Bodyweight />}
            {page === 'strength' && <Strength go={setPage} />}
            {page === 'endurance' && <Endurance go={setPage} />}
            {page === 'quick' && <QuickEntry />}
            {page === 'review' && <Review />}
            {page === 'settings' && <Settings theme={theme} setTheme={setTheme} go={setPage} />}
          </div>
        </main>
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </RangeCtx.Provider>
  );
}

function Banners({ onGo }: { onGo: (p: Page) => void }) {
  const s = useSync();
  const [busy, setBusy] = useState(false);
  const reconnect = async () => { setBusy(true); try { await connect(); } catch { /* banner stays */ } finally { setBusy(false); } };
  return (
    <>
      {(s.auth === 'expired' || (s.auth === 'disconnected' && s.files.length > 0)) && (
        <div className="banner warn" role="alert">
          <span className="status-icon warn">!</span>
          <span className="grow">
            {s.auth === 'expired'
              ? 'Your Google sign-in expired (normal about once a week while the app is in Testing mode). Showing cached data.'
              : 'Not connected to Google. Showing cached data.'}
          </span>
          <button className="btn primary small" onClick={reconnect} disabled={busy}>{busy ? 'Waiting for browser…' : 'Reconnect Google'}</button>
        </div>
      )}
      {s.error && (
        <div className={`banner ${s.error.code === 'OFFLINE' ? 'warn' : 'err'}`} role="alert">
          <span className={`status-icon ${s.error.code === 'OFFLINE' ? 'warn' : 'err'}`}>!</span>
          <span className="grow">{s.error.message}</span>
          <button className="btn small" onClick={() => sync()}>Try again</button>
        </div>
      )}
      {s.folderChoices && (
        <div className="banner info">
          <span className="status-icon info">?</span>
          <span className="grow">Found more than one "Health Tracker" folder. Which one holds your sheets?</span>
          {s.folderChoices.map(f => <button key={f.id} className="btn small" onClick={() => chooseFolder(f.id, f.name)}>{f.name.trim()} · edited {f.modifiedTime.slice(0, 10)}</button>)}
        </div>
      )}
      {s.update?.available && (
        <div className="banner info">
          <span className="status-icon info">↑</span>
          <span className="grow">Version {s.update.version} is available.</span>
          <button className="btn primary small" onClick={() => installUpdate()}>Install &amp; restart</button>
        </div>
      )}
      {s.dataset.review.length > 0 && s.auth === 'connected' && !s.error && (
        <div className="banner info" style={{ padding: '6px 20px' }}>
          <span className="status-icon info">i</span>
          <span className="grow">{s.dataset.review.length} item{s.dataset.review.length > 1 ? 's' : ''} need a quick look (unconfirmed exercises, undated entries or unclear values).</span>
          <button className="btn small" onClick={() => onGo('review')}>Review</button>
        </div>
      )}
    </>
  );
}

function Setup() {
  const s = useSync();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try { await connect(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="setup">
      <div className="card">
        <h2 style={{ fontSize: 20, marginBottom: 6 }}>Connect your Google account</h2>
        <p style={{ color: 'var(--ink-2)', marginTop: 0 }}>
          Health Tracker reads the sheets in your Google Drive folder <b>Health Tracker</b> and writes Quick Entry logs back to them.
        </p>
        <ol className="steps">
          <li>Click <b>Connect Google</b>. Your browser opens Google's sign-in page.</li>
          <li>Sign in with the Google account you added as a <b>test user</b> (the one that owns the folder). Google may say the app is unverified. That's expected for a personal app in Testing mode: choose <b>Continue</b>.</li>
          <li>Allow access, then come back here. The app never sees your password; the sign-in token is kept in your {navigator.platform.toLowerCase().includes('win') ? 'Windows Credential Manager' : 'macOS Keychain'}.</li>
        </ol>
        <button className="btn primary" onClick={go} disabled={busy}>{busy ? <><span className="spin" /> Waiting for the browser…</> : 'Connect Google'}</button>
        {err && <p className="hint bad" role="alert">{err}</p>}
        {s.error && <p className="hint bad">{s.error.message}</p>}
        <CredentialsPanel startOpen={!!err && /client secret|credentials/i.test(err)} />
      </div>
    </div>
  );
}

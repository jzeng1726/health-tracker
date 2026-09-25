import { useState } from 'react';
import type { Page } from '../App';
import { useSync, Section, useToast } from '../ui/common';
import { setConfigKey, connect, disconnect, clearCache, sync, checkForUpdate, installUpdate, bodyweightTargets, workoutTargets } from '../sync/engine';
import type { Settings as S } from '../core/config';
import { CredentialsPanel } from '../ui/Credentials';

export default function Settings({ theme, setTheme, go }: { theme: string; setTheme: (t: 'system' | 'light' | 'dark') => void; go: (p: Page) => void }) {
  const s = useSync();
  const toast = useToast();
  const st = s.config.settings;
  const upd = (patch: Partial<S>) => setConfigKey('settings', { ...st, ...patch });
  const [goal, setGoal] = useState(s.config.goals.goalWeightLb?.toString() ?? '');
  const [checking, setChecking] = useState(false);
  const mappings = Object.entries(s.config.columnMappings);

  return (
    <div style={{ maxWidth: 920 }}>
      <Section title="Google account" />
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`status-icon ${s.auth === 'connected' ? 'ok' : 'warn'}`}>{s.auth === 'connected' ? '✓' : '!'}</span>
        <span style={{ flex: 1 }}>{s.auth === 'connected' ? <>Connected{ s.email ? <> as <b>{s.email}</b></> : null}</> : s.auth === 'expired' ? 'Sign-in expired' : 'Not connected'}
          <div className="hint">Token stored in the {navigator.platform.toLowerCase().includes('win') ? 'Windows Credential Manager' : 'macOS Keychain'}. Testing-mode sign-ins expire about weekly; reconnecting takes one click.</div></span>
        <button className="btn primary" onClick={() => connect().catch(() => {})}>Reconnect Google</button>
        {s.auth === 'connected' && <button className="btn" onClick={() => disconnect()}>Disconnect</button>}
        <div style={{ flexBasis: '100%' }}><CredentialsPanel /></div>
      </div>

      <Section title="Sync" />
      <div className="card form">
        <div className="row">
          <label>Auto-refresh every
            <select value={st.refreshMinutes} onChange={e => upd({ refreshMinutes: Number(e.target.value) })}>
              {[1, 2, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''}</option>)}
            </select>
          </label>
          <label>Theme
            <select value={theme} onChange={e => setTheme(e.target.value as any)}><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select>
          </label>
        </div>
        <div className="hint">Also refreshes on launch, whenever the window regains focus, and after each Quick Entry. Settings here are stored in the <code>_config</code> sheet, so both computers share them.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => sync()} disabled={s.syncing}>Refresh now</button>
          <button className="btn" onClick={async () => { await clearCache(); toast('Local cache cleared — reloaded from Google Sheets'); }}>Clear local cache</button>
        </div>
      </div>

      <Section title="Goals & units" />
      <div className="card form">
        <div className="row">
          <label>Goal weight (lb)
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="0.1" value={goal} onChange={e => setGoal(e.target.value)} />
              <button className="btn" onClick={() => setConfigKey('goals', { ...s.config.goals, goalWeightLb: goal === '' ? undefined : Number(goal) })}>Save</button>
            </div>
          </label>
          <label>Weight unit<select disabled value="lb"><option>lb</option></select></label>
          <label>Run distance<select value={st.distanceUnitRun} onChange={e => upd({ distanceUnitRun: e.target.value as any })}><option value="mi">miles</option><option value="km">kilometers</option></select></label>
          <label>Carry / lunge distance<select value={st.distanceUnitCarry} onChange={e => upd({ distanceUnitCarry: e.target.value as any })}><option value="m">meters</option><option value="ft">feet</option><option value="yd">yards</option></select></label>
        </div>
        <label className="toggle"><input type="checkbox" checked={st.carryWeightPerHand} onChange={e => upd({ carryWeightPerHand: e.target.checked })} />Farmer carry / static hold weights are per hand (total load = 2 × weight)</label>
        <label className="toggle"><input type="checkbox" checked={st.enduranceCountsTowardVolume} onChange={e => upd({ enduranceCountsTowardVolume: e.target.checked })} />Count walking lunges toward Quads and carries/holds toward Core + Back weekly sets</label>
        <div className="hint">Endurance never affects estimated-1RM strength scores. Rep ranges like 12-13 count as the lower number.</div>
      </div>

      <Section title="Quick Entry defaults" />
      <div className="card form">
        <div className="row">
          <label>Morning weight goes to
            <select value={st.quickEntryBodyweightFile ?? ''} onChange={e => upd({ quickEntryBodyweightFile: e.target.value || undefined })}>
              <option value="">Most recent bodyweight sheet</option>
              {bodyweightTargets().map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label>Workouts go to
            <select value={st.quickEntryWorkoutFile ?? ''} onChange={e => upd({ quickEntryWorkoutFile: e.target.value || undefined })}>
              <option value="">Most recent log sheet (Training Log)</option>
              {workoutTargets().map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
      </div>

      <Section title="Exercise → muscle map" right={<button className="btn small" onClick={() => go('review')}>Open map</button>} />
      <div className="card hint">
        {Object.keys(s.dataset.exercises).length} exercises · {Object.keys(s.config.exerciseOverrides).length} set by you · {Object.keys(s.config.merges).length} merged names. Your edits always override automatic detection.
      </div>

      <Section title="Sheets detected" sub={s.folder ? `in "${s.folder.name.trim()}"` : ''} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>File</th><th>Tab</th><th>Detected as</th><th>Why</th></tr></thead>
          <tbody>{s.dataset.files.flatMap(f => f.tabs.map(t => (
            <tr key={f.id + t.title}>
              <td>{f.name}{f.viaShortcut && <div className="hint">shortcut{f.owner ? ` · owned by ${f.owner}` : ''}</div>}</td>
              <td>{t.title}</td>
              <td><span className={`pill ${t.kind === 'unknown' ? 'low' : ''}`}>{t.kind}</span></td>
              <td className="hint">{t.reason}</td>
            </tr>
          )))}</tbody>
        </table>
        <div className="hint" style={{ marginTop: 8 }}>New sheets added to the folder (or shortcuts to shared sheets) are picked up on the next refresh — no code changes needed.</div>
      </div>

      {mappings.length > 0 && (
        <>
          <Section title="Column mappings" sub="set in Review for sheets the app couldn't classify" />
          <div className="card table-wrap"><table><tbody>{mappings.map(([k, m]) => {
            const [fid, tab] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
            const name = s.files.find(f => f.id === fid)?.name ?? fid;
            return <tr key={k}><td>{name} › {tab}</td><td>{m.type}</td><td className="hint">{Object.entries(m.columns).map(([r, c]) => `${r}: col ${String.fromCharCode(65 + (c as number))}`).join(', ')}</td>
              <td style={{ textAlign: 'right' }}><button className="btn small ghost" onClick={() => { const x = { ...s.config.columnMappings }; delete x[k]; setConfigKey('columnMappings', x); }}>Remove</button></td></tr>;
          })}</tbody></table></div>
        </>
      )}

      <Section title="Updates" />
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>Version {s.version || '—'}{s.update?.available ? <> · <b>{s.update.version} available</b></> : ''}<div className="hint">Updates download from GitHub Releases. Both computers check on launch.</div></span>
        {s.update?.available
          ? <button className="btn primary" onClick={() => installUpdate()}>Install &amp; restart</button>
          : <button className="btn" disabled={checking} onClick={async () => { setChecking(true); const u = await checkForUpdate(); setChecking(false); toast(u.available ? `Version ${u.version} available` : 'You have the latest version'); }}>{checking ? 'Checking…' : 'Check for updates'}</button>}
      </div>
    </div>
  );
}

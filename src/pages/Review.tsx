import { useMemo, useState } from 'react';
import { useSync, Section, Empty, todayISO, useToast } from '../ui/common';
import { setConfigKey } from '../sync/engine';
import { MUSCLES, type Muscle } from '../core/muscles';
import type { ReviewItem, ExerciseInfo } from '../core/model';
import type { ColumnMapping, ColumnRole } from '../core/config';
import { cellText } from '../core/grid';

export default function Review() {
  const s = useSync();
  const items = s.dataset.review;
  const groups: { kind: ReviewItem['kind']; title: string; sub: string }[] = [
    { kind: 'exercise', title: 'Exercises to confirm', sub: 'the app wasn\'t sure which muscles these work — best guess preselected' },
    { kind: 'merge', title: 'Possible duplicates', sub: 'names that look like the same exercise' },
    { kind: 'undated', title: 'Entries with no date', sub: 'left out of charts until you pick the day' },
    { kind: 'value', title: 'Values to check', sub: 'unclear or unusual values (sheets are never changed)' },
    { kind: 'conflict', title: 'Conflicts', sub: '' },
    { kind: 'sheet', title: 'Sheets that need column mapping', sub: 'map once; saved to _config so both computers use it' },
  ];
  return (
    <>
      {!items.length && <Empty title="Nothing to review">Every exercise is mapped, dated and parsed.</Empty>}
      {groups.map(g => {
        const list = items.filter(i => i.kind === g.kind);
        if (!list.length) return null;
        return (
          <div key={g.kind}>
            <Section title={`${g.title} (${list.length})`} sub={g.sub} />
            <div className="card">{list.map(i => <Item key={i.id} item={i} />)}</div>
          </div>
        );
      })}
      <ExerciseMap />
    </>
  );
}

function Item({ item }: { item: ReviewItem }) {
  const s = useSync();
  const toast = useToast();
  const cfg = s.config;
  const ignore = () => setConfigKey('ignored', [...cfg.ignored, item.id]);
  switch (item.kind) {
    case 'exercise': return <ExerciseReview item={item} />;
    case 'merge': {
      const { a, b } = item.merge!;
      const ea = s.dataset.exercises[a], eb = s.dataset.exercises[b];
      // keep the one with more logged sessions as the canonical name
      const [keep, alias] = (ea?.count ?? 0) >= (eb?.count ?? 0) ? [a, b] : [b, a];
      return (
        <div className="review-item">
          <div><div className="t">{item.title}</div><div className="d">{item.detail} · {ea?.count ?? 0} vs {eb?.count ?? 0} logged sets</div></div>
          <div className="actions">
            <button className="btn primary small" onClick={() => { setConfigKey('merges', { ...cfg.merges, [alias]: keep }); toast(`Merged into "${s.dataset.exercises[keep]?.display ?? keep}"`); }}>Merge</button>
            <button className="btn small" onClick={() => setConfigKey('rejectedMerges', [...cfg.rejectedMerges, [a, b].sort().join('|')])}>Keep separate</button>
          </div>
        </div>
      );
    }
    case 'undated': return <UndatedReview item={item} />;
    case 'value': return <ValueReview item={item} />;
    case 'sheet': return <SheetMapper item={item} />;
    default:
      return (
        <div className="review-item">
          <div><div className="t">{item.title}</div><div className="d">{item.detail}</div></div>
          <div className="actions"><button className="btn small" onClick={ignore}>OK</button></div>
        </div>
      );
  }
}

function MusclePicker({ primary, secondary, onChange }: { primary: Muscle | null; secondary: Muscle[]; onChange: (p: Muscle | null, s: Muscle[]) => void }) {
  return (
    <div className="muscle-select">
      <select value={primary ?? ''} onChange={e => onChange((e.target.value || null) as Muscle | null, secondary.filter(x => x !== e.target.value))} style={{ width: 'auto' }} aria-label="Primary muscle">
        <option value="">— none —</option>
        {MUSCLES.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <span className="hint">secondary (50%):</span>
      {MUSCLES.filter(m => m !== primary).map(m => (
        <button key={m} type="button" className={`chip ${secondary.includes(m) ? 'on' : ''}`} style={{ padding: '2px 8px', fontSize: 12 }}
          onClick={() => onChange(primary, secondary.includes(m) ? secondary.filter(x => x !== m) : [...secondary, m])}>{m}</button>
      ))}
    </div>
  );
}

function ExerciseReview({ item }: { item: ReviewItem }) {
  const s = useSync();
  const [p, setP] = useState<Muscle | null>(item.guess?.primary ?? null);
  const [sec, setSec] = useState<Muscle[]>(item.guess?.secondary ?? []);
  const info = s.dataset.exercises[item.exercise!];
  const confirm = () => setConfigKey('exerciseOverrides', { ...s.config.exerciseOverrides, [item.exercise!]: { primary: p, secondary: sec, confirmed: true } });
  return (
    <div className="review-item">
      <div>
        <div className="t">{item.title} <span className="hint">· {info?.count ?? 0} logged sets</span></div>
        <div className="d" style={{ marginBottom: 6 }}>{item.detail}</div>
        <MusclePicker primary={p} secondary={sec} onChange={(a, b) => { setP(a); setSec(b); }} />
      </div>
      <div className="actions"><button className="btn primary small" onClick={confirm} disabled={!p}>Confirm</button></div>
    </div>
  );
}

function UndatedReview({ item }: { item: ReviewItem }) {
  const s = useSync();
  const [d, setD] = useState(todayISO());
  return (
    <div className="review-item">
      <div><div className="t">{item.title}</div><div className="d">{item.detail}</div><div className="hint">{item.ref}</div></div>
      <div className="actions">
        <input type="date" value={d} onChange={e => setD(e.target.value)} style={{ width: 150 }} aria-label="Date done" />
        <button className="btn primary small" onClick={() => setConfigKey('dateAssignments', { ...s.config.dateAssignments, [item.key!]: d })}>Save date</button>
        <button className="btn small" onClick={() => setConfigKey('ignored', [...s.config.ignored, item.key!, item.id])}>Ignore entry</button>
      </div>
    </div>
  );
}

function ValueReview({ item }: { item: ReviewItem }) {
  const s = useSync();
  const [val, setVal] = useState(item.suggestion ?? '');
  const fix = () => {
    if (!item.fileId || !item.cell || !item.raw) return;
    const to = /^\d+$/.test(val) && /x/i.test(item.raw) ? item.raw.replace(/^\s*\d+(\.\d+)?/, val) : val;
    setConfigKey('corrections', [...s.config.corrections, { sheetId: item.fileId, tab: item.tab, cell: item.cell, from: item.raw, to, note: 'fixed in Review' }]);
  };
  const canFix = !!(item.fileId && item.cell);
  return (
    <div className="review-item">
      <div><div className="t">{item.title}</div><div className="d">{item.detail}</div><div className="hint">Sheet value <code>{item.raw}</code> · {item.ref}</div></div>
      <div className="actions">
        {canFix && <><input value={val} onChange={e => setVal(e.target.value)} placeholder="read it as…" style={{ width: 150 }} aria-label="Corrected value" />
          <button className="btn primary small" disabled={!val} onClick={fix}>Use this</button></>}
        <button className="btn small" onClick={() => setConfigKey('ignored', [...s.config.ignored, item.id])}>Keep as is</button>
      </div>
    </div>
  );
}

const ROLES: ColumnRole[] = ['ignore', 'date', 'exercise', 'bodyweight', 'weight', 'sets', 'reps', 'setsxreps', 'time', 'distance', 'notes'];
const ROLE_LABEL: Record<ColumnRole, string> = { ignore: '—', date: 'Date', exercise: 'Exercise', bodyweight: 'Bodyweight', weight: 'Load (lb)', sets: 'Sets', reps: 'Reps', setsxreps: 'Sets×Reps (3x8)', time: 'Time', distance: 'Distance', notes: 'Notes' };

function SheetMapper({ item }: { item: ReviewItem }) {
  const s = useSync();
  const file = s.files.find(f => f.id === item.fileId);
  const tab = file?.tabs.find(t => t.title === item.tab);
  const [headerRow, setHeaderRow] = useState(0);
  const [roles, setRoles] = useState<Record<number, ColumnRole>>({});
  const [timeUnit, setTimeUnit] = useState<ColumnMapping['timeUnit']>();
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => (tab?.rows ?? []).slice(0, 12), [tab]);
  const width = Math.max(0, ...preview.map(r => r.length));
  const save = (type: ColumnMapping['type']) => {
    const columns: ColumnMapping['columns'] = {};
    Object.entries(roles).forEach(([c, r]) => { if (r !== 'ignore') columns[r] = Number(c); });
    setConfigKey('columnMappings', { ...s.config.columnMappings, [`${item.fileId}:${item.tab}`]: { type, headerRow, columns, timeUnit } });
  };
  const hasBw = Object.values(roles).includes('bodyweight');
  return (
    <div className="review-item" style={{ gridTemplateColumns: '1fr' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div><div className="t">{item.title}</div><div className="d">{item.detail}</div></div>
        <div className="actions"><button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Map columns'}</button><button className="btn small" onClick={() => save('ignore')}>Ignore sheet</button></div>
      </div>
      {open && tab && (
        <div className="table-wrap">
          <div className="form" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: '8px 0' }}>
            <label>Header row<select value={headerRow} onChange={e => setHeaderRow(Number(e.target.value))}>{preview.map((_, i) => <option key={i} value={i}>Row {i + 1}</option>)}</select></label>
            <label>Plain numbers in Time column are<select value={timeUnit ?? ''} onChange={e => setTimeUnit((e.target.value || undefined) as any)}><option value="">(times like 1:30 only)</option><option value="seconds">seconds</option><option value="minutes">minutes</option></select></label>
          </div>
          <table>
            <thead><tr>{Array.from({ length: width }, (_, c) => (
              <th key={c}><select value={roles[c] ?? 'ignore'} onChange={e => setRoles({ ...roles, [c]: e.target.value as ColumnRole })} style={{ width: 'auto', fontSize: 12 }}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></th>
            ))}</tr></thead>
            <tbody>{preview.map((r, i) => <tr key={i} style={i === headerRow ? { fontWeight: 600 } : undefined}>{Array.from({ length: width }, (_, c) => <td key={c}>{cellText(r[c])}</td>)}</tr>)}</tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn primary small" disabled={!Object.values(roles).includes('date')} onClick={() => save(hasBw ? 'bodyweight' : 'workout')}>Save mapping ({hasBw ? 'bodyweight log' : 'workout log'})</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExerciseMap() {
  const s = useSync();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ p: Muscle | null; s: Muscle[] }>({ p: null, s: [] });
  const list = Object.values(s.dataset.exercises).sort((a, b) => (a.primary ?? 'zz').localeCompare(b.primary ?? 'zz') || a.display.localeCompare(b.display));
  const save = (ex: ExerciseInfo) => { setConfigKey('exerciseOverrides', { ...s.config.exerciseOverrides, [ex.name]: { primary: draft.p, secondary: draft.s, confirmed: true } }); setEditing(null); };
  const reset = (ex: ExerciseInfo) => { const o = { ...s.config.exerciseOverrides }; delete o[ex.name]; setConfigKey('exerciseOverrides', o); };
  const merged = Object.entries(s.config.merges);
  return (
    <>
      <Section title="Full exercise → muscle map" sub="your edits always override the automatic rules · synced to both computers" />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Exercise</th><th>Primary</th><th>Secondary (50%)</th><th>Type</th><th>Source</th><th className="n">Sets</th><th /></tr></thead>
          <tbody>{list.map(ex => editing === ex.name ? (
            <tr key={ex.name}><td>{ex.display}</td><td colSpan={5}><MusclePicker primary={draft.p} secondary={draft.s} onChange={(p, sec) => setDraft({ p, s: sec })} /></td>
              <td><div style={{ display: 'flex', gap: 4 }}><button className="btn primary small" onClick={() => save(ex)}>Save</button><button className="btn small ghost" onClick={() => setEditing(null)}>Cancel</button></div></td></tr>
          ) : (
            <tr key={ex.name}>
              <td>{ex.display}{ex.variants.length > 1 && <div className="hint">also: {ex.variants.slice(1).join(', ')}</div>}</td>
              <td>{ex.primary ?? '—'}</td><td>{ex.secondary.join(', ') || '—'}</td>
              <td className="hint">{ex.kind}{ex.enduranceType ? ` · ${ex.enduranceType.replace('_', ' ')}` : ''}</td>
              <td>{ex.confidence === 'confirmed' ? <span className="pill pr">yours</span> : ex.source === 'mandatory' ? <span className="pill">your rule · {ex.rule.split(' ')[0]}</span> : ex.confidence === 'high' ? <span className="pill">auto</span> : <span className="pill low">unconfirmed</span>}</td>
              <td className="n">{ex.count}</td>
              <td><div style={{ display: 'flex', gap: 4 }}><button className="btn small" onClick={() => { setEditing(ex.name); setDraft({ p: ex.primary, s: ex.secondary }); }}>Edit</button>
                {ex.confidence === 'confirmed' && <button className="btn small ghost" onClick={() => reset(ex)} title="Go back to automatic detection">Reset</button>}</div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {merged.length > 0 && (
        <>
          <Section title="Merged names" sub="alias → counted as" />
          <div className="card table-wrap"><table><tbody>{merged.map(([a, b]) => (
            <tr key={a}><td><code>{a}</code></td><td>→ {s.dataset.exercises[b]?.display ?? b}</td>
              <td style={{ textAlign: 'right' }}><button className="btn small ghost" onClick={() => { const m = { ...s.config.merges }; delete m[a]; setConfigKey('merges', m); }}>Un-merge</button></td></tr>
          ))}</tbody></table></div>
        </>
      )}
    </>
  );
}

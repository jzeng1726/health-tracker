import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Area, ComposedChart,
} from 'recharts';
import { getState, subscribe, setConfigKey } from '../sync/engine';
import { toDay, fromDay, bandStatus, type BodyweightStats } from '../core/bodyweight';

export const useSync = () => useSyncExternalStore(subscribe, getState);

// ---------------------------------------------------------------- dates & range
export const todayISO = () => new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
export const shortDate = (iso: string) => { const [, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}`; };
export const longDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export type Preset = '7D' | '30D' | '90D' | 'All' | 'Custom';
export interface Range { preset: Preset; from?: string; to?: string }
export function rangeBounds(r: Range): { start: string | null; end: string | null } {
  const t = todayISO();
  const back = (n: number) => fromDay(toDay(t) - (n - 1));
  switch (r.preset) {
    case '7D': return { start: back(7), end: null };
    case '30D': return { start: back(30), end: null };
    case '90D': return { start: back(90), end: null };
    case 'Custom': return { start: r.from ?? null, end: r.to ?? null };
    default: return { start: null, end: null };
  }
}
export const inRange = (iso: string, b: { start: string | null; end: string | null }) => (!b.start || iso >= b.start) && (!b.end || iso <= b.end);

export const RangeCtx = createContext<{ range: Range; setRange: (r: Range) => void }>({ range: { preset: '30D' }, setRange: () => {} });
export const useRange = () => {
  const { range, setRange } = useContext(RangeCtx);
  const bounds = useMemo(() => rangeBounds(range), [range]);
  return { range, setRange, bounds };
};

export function RangePicker() {
  const { range, setRange } = useContext(RangeCtx);
  const presets: Preset[] = ['7D', '30D', '90D', 'All', 'Custom'];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="seg" role="group" aria-label="Date range">
        {presets.map(p => (
          <button key={p} className={range.preset === p ? 'on' : ''} onClick={() => setRange(p === 'Custom' ? { preset: p, from: range.from ?? fromDay(toDay(todayISO()) - 29), to: range.to ?? todayISO() } : { preset: p })}>{p}</button>
        ))}
      </div>
      {range.preset === 'Custom' && (
        <>
          <input type="date" value={range.from ?? ''} onChange={e => setRange({ ...range, from: e.target.value })} style={{ width: 140 }} aria-label="From" />
          <span className="hint">to</span>
          <input type="date" value={range.to ?? ''} onChange={e => setRange({ ...range, to: e.target.value })} style={{ width: 140 }} aria-label="To" />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- formatting
export const fmt = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? '—' : n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(d)}%`);
export const signed = (n: number | null | undefined, d = 1, unit = '') => (n == null || !isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(d)}${unit}`);

export function Delta({ value, goodWhen = 'up', text }: { value: number | null | undefined; goodWhen?: 'up' | 'down'; text?: string }) {
  if (value == null || !isFinite(value) || value === 0) return <span>{text ?? '—'}</span>;
  const good = goodWhen === 'up' ? value > 0 : value < 0;
  return <span className={good ? 'delta-good' : 'delta-bad'}>{good ? '▲' : '▼'} {text}</span>;
}

// ---------------------------------------------------------------- pieces
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children && <div>{children}</div>}</div>;
}

export function Section({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return <div className="section"><h2>{title}</h2>{sub && <span className="sub">{sub}</span>}<span style={{ marginLeft: 'auto' }}>{right}</span></div>;
}

export function Tile({ label, value, unit, foot, spark, onClick, sparkGood, accent }: {
  label: string; value: ReactNode; unit?: string; foot?: ReactNode; spark?: { x: number; y: number }[]; onClick?: () => void; sparkGood?: boolean; accent?: boolean;
}) {
  return (
    <div className={`card tile ${onClick ? 'click' : ''} ${accent ? 'accent' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => { if (onClick && (e.key === 'Enter' || e.key === ' ')) onClick(); }}>
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}{unit && <small>{unit}</small>}</div>
      {foot && <div className="tile-foot">{foot}</div>}
      {spark && spark.length > 1 && <Sparkline data={spark} />}
      {spark && spark.length <= 1 && <div className="hint" style={{ marginTop: 6, height: 34 }}>{spark.length ? 'Trend appears after 2 data points' : ''}</div>}
      {sparkGood === undefined ? null : null}
    </div>
  );
}

export function Sparkline({ data }: { data: { x: number; y: number }[] }) {
  return (
    <div style={{ height: 34, marginTop: 6 }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 4, bottom: 3, left: 4 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <XAxis hide dataKey="x" type="number" domain={['dataMin', 'dataMax']} />
          <Line dataKey="y" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} strokeLinecap="round" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface TipRow { label: string; value: string; color?: string; dot?: boolean }
export function TipBox({ title, rows, note }: { title: string; rows: TipRow[]; note?: string }) {
  return (
    <div className="tt">
      <div className="d">{title}</div>
      {rows.map((r, i) => (
        <div className="r" key={i}>
          {r.color && <span className="key" style={{ background: r.color, ...(r.dot ? { width: 7, height: 7, borderRadius: '50%' } : {}) }} />}
          <b>{r.value}</b> <span className="lbl">{r.label}</span>
        </div>
      ))}
      {note && <div className="d" style={{ marginTop: 4, marginBottom: 0 }}>{note}</div>}
    </div>
  );
}

export const axisProps = {
  stroke: 'var(--axis)', tick: { fill: 'var(--muted)', fontSize: 11 }, tickLine: false,
} as const;
export const dayTick = (d: number) => shortDate(fromDay(d));

/**
 * One-series time chart (x = day number). Crosshair tooltip; values formatted by caller.
 * Never used with two y-scales.
 */
export function TimeChart({ data, yFmt, tipLabel, height = 220, refLine, zeroLine, lowerIsBetter, area, tipExtra, yDomain, dots = true, compact, hollowKey, xMarks }: {
  data: { day: number; y: number; [k: string]: any }[];
  yFmt: (v: number) => string;
  tipLabel: string;
  height?: number;
  refLine?: { y: number; label: string };
  zeroLine?: boolean;
  lowerIsBetter?: boolean;
  area?: boolean;
  tipExtra?: (p: any) => string | undefined;
  yDomain?: [any, any];
  dots?: boolean;
  compact?: boolean;
  /** points where p[hollowKey] is truthy get an open marker (e.g. converted from another gym) */
  hollowKey?: string;
  /** vertical markers (e.g. setup changes), x = day number */
  xMarks?: { day: number; label: string }[];
}) {
  if (!data.length) return <div className="hint" style={{ height, display: 'grid', placeItems: 'center' }}>No data in this date range</div>;
  const single = data.length === 1;
  const ys = data.map(d => d.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  // flat series: pad the axis instead of letting it explode to ±400%
  const flatPad = Math.max(Math.abs(lo) * 0.05, 0.05);
  const domain = yDomain ?? (lo === hi ? [lo - flatPad, hi + flatPad] : ['auto', 'auto']);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="day" type="number" domain={single ? [data[0].day - 3, data[0].day + 3] : ['dataMin', 'dataMax']} tickFormatter={dayTick} {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} width={compact ? 40 : 52} tickFormatter={yFmt} domain={domain} reversed={!!lowerIsBetter} tickCount={compact ? 3 : 5} />
          {zeroLine && <ReferenceLine y={0} stroke="var(--axis)" />}
          {xMarks?.map((m, i) => <ReferenceLine key={i} x={m.day} stroke="var(--note)" strokeDasharray="3 3" label={{ value: m.label, position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 10 }} />)}
          {refLine && <ReferenceLine y={refLine.y} stroke="var(--muted)" label={{ value: refLine.label, position: 'insideTopRight', fill: 'var(--ink-2)', fontSize: 11 }} />}
          <Tooltip cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload;
              return <TipBox title={longDate(fromDay(p.day))} rows={[{ label: tipLabel, value: yFmt(p.y), color: 'var(--series-1)' }]} note={tipExtra?.(p)} />;
            }} />
          {area && <Area dataKey="y" stroke="none" fill="var(--series-1-wash)" isAnimationActive={false} />}
          <Line dataKey="y" stroke="var(--series-1)" strokeWidth={2} isAnimationActive={false} strokeLinecap="round" strokeLinejoin="round"
            dot={dots && data.length <= 40
              ? (hollowKey
                ? (p: any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={p.payload?.[hollowKey] ? 'var(--surface)' : 'var(--series-1)'} stroke={p.payload?.[hollowKey] ? 'var(--series-1)' : 'var(--surface)'} strokeWidth={2} />
                : { r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 })
              : false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function useToast() {
  return (msg: string) => window.dispatchEvent(new CustomEvent('toast', { detail: msg }));
}

// ---------------------------------------------------------------- gyms

/** The gym you're at right now (remembered on this computer; defaults to where you last trained). */
export function useCurrentGym(): [string, (g: string) => void] {
  const s = useSync();
  const lastUsed = useMemo(() => [...s.dataset.sets].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.gym, [s.dataset.sets]);
  const [g, setG] = useState<string>(() => { try { return localStorage.getItem('gym.current') ?? ''; } catch { return ''; } });
  // a gym remembered under its old name ("Home gym") follows the rename
  const remembered = g && (s.config.gyms.aliases?.[g.toLowerCase()] ?? (g.toLowerCase() === 'home gym' ? s.config.gyms.defaultGym : g));
  const value = remembered || lastUsed || s.dataset.gyms[0] || 'Training Station';
  return [value, (v: string) => { setG(v); try { localStorage.setItem('gym.current', v); } catch { /* per-viewer convenience */ } }];
}

export function GymSelect({ value, onChange, compact }: { value: string; onChange: (g: string) => void; compact?: boolean }) {
  const s = useSync();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const gyms = [...new Set([...s.dataset.gyms, value].filter(Boolean))];
  if (adding) {
    const save = () => {
      const n = name.trim();
      if (!n) { setAdding(false); return; }
      if (!s.config.gyms.names.includes(n)) setConfigKey('gyms', { ...s.config.gyms, names: [...s.config.gyms.names, n] });
      onChange(n); setAdding(false); setName('');
    };
    return (
      <span style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Planet Fitness" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') setAdding(false); }} aria-label="New gym name" />
        <button type="button" className="btn small primary" onClick={save}>Add</button>
      </span>
    );
  }
  return (
    <select value={value} onChange={e => (e.target.value === '__new' ? setAdding(true) : onChange(e.target.value))} style={compact ? { width: 'auto' } : undefined} aria-label="Gym">
      {gyms.map(g => <option key={g} value={g}>{g}</option>)}
      <option value="__new">+ New gym…</option>
    </select>
  );
}

// ---------------------------------------------------------------- Quick Entry prefill (from Gym prep)
let prefill: { exercise: string; weight?: number | null; reps?: number | null } | null = null;
export const setPrefill = (p: typeof prefill) => { prefill = p; };
export const takePrefill = () => { const p = prefill; prefill = null; return p; };

// ---------------------------------------------------------------- bodyweight helpers
export function BandPill({ pct: p, min, max }: { pct: number | null; min: number; max: number }) {
  const st = bandStatus(p, min, max);
  if (st === 'unknown') return null;
  const txt = { in: `✓ on target (${min}–${max}%)`, slow: `↓ slower than ${min}%`, fast: `↑ faster than ${max}%`, gaining: '↑ gaining' }[st];
  return <span className={`pill ${st === 'in' ? 'ok' : 'low'}`}>{txt}</span>;
}

/** Warns when the latest 7-day average is old or built from very few weigh-ins. */
export function StaleNote({ stats }: { stats: BodyweightStats }) {
  if (!stats.lastDate) return null;
  const days = toDay(todayISO()) - toDay(stats.lastDate);
  if (days <= 3 && stats.currentN >= 4) return null;
  return (
    <div className="note warn" role="status">
      <span className="status-icon warn">!</span>
      <span>
        {days > 3 && <>Last weigh-in was <b>{shortDate(stats.lastDate)}</b> ({days} days ago) — the 7-day average and weekly rate stop there. </>}
        {stats.currentN < 4 && <>That 7-day average is built from only <b>{stats.currentN}</b> weigh-in{stats.currentN === 1 ? '' : 's'}, so treat it as rough. </>}
        Log a morning weight in Quick Entry to bring it current.
      </span>
    </div>
  );
}

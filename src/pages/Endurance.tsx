import { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import type { Page } from '../App';
import { useSync, useRange, pct, fmt, shortDate, longDate, Empty, Section, TimeChart, Tile, TipBox, axisProps, dayTick, inRange } from '../ui/common';
import { enduranceSessions, endurancePRs, enduranceWeekly, pctFromBaseline, primaryMetric, ENDURANCE_LABEL, type EnduranceSession } from '../core/endurance';
import { formatDuration, metersTo } from '../core/time';
import type { EnduranceType } from '../core/muscles';
import { toDay } from '../core/bodyweight';

/** round a time axis to clean 15 s / 1 min steps */
function durDomain(vals: number[]): [number, number] | undefined {
  if (!vals.length) return undefined;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const step = hi - lo > 300 ? 60 : 15;
  return [Math.max(0, Math.floor((lo - step) / step) * step), Math.ceil((hi + step) / step) * step];
}

const TYPES: EnduranceType[] = ['run', 'walking_lunge', 'farmer_carry', 'static_hold', 'other'];

export default function Endurance({ go }: { go: (p: Page) => void }) {
  const s = useSync();
  const { bounds } = useRange();
  const set = s.config.settings;
  const [type, setType] = useState<EnduranceType>('run');

  const all = useMemo(() => enduranceSessions(s.dataset.endurance, set.carryWeightPerHand), [s.dataset.endurance, set.carryWeightPerHand]);
  const sessions = all.filter(x => inRange(x.date, bounds));
  const counts = Object.fromEntries(TYPES.map(t => [t, all.filter(x => x.type === t).length]));
  const ofType = sessions.filter(x => x.type === type);
  const exercises = [...new Set(all.filter(x => x.type === type).map(x => x.exercise))];
  const undated = s.dataset.review.filter(r => r.kind === 'undated' && r.exercise && ['walking_lunge', 'farmer_carry', 'static_hold', 'run', 'other'].includes(s.dataset.exercises[r.exercise]?.enduranceType ?? (s.dataset.exercises[r.exercise]?.kind === 'timed' ? 'other' : '')));

  return (
    <>
      <div className="chips" role="tablist" aria-label="Endurance type">
        {TYPES.map(t => (
          <button key={t} role="tab" aria-selected={type === t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
            {ENDURANCE_LABEL[t]}<span className="v">{counts[t]}</span>
          </button>
        ))}
      </div>
      {undated.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>{undated.length} timed entr{undated.length > 1 ? 'ies have' : 'y has'} no date yet (e.g. Plank 2:00) and {undated.length > 1 ? 'are' : 'is'} left out until you date {undated.length > 1 ? 'them' : 'it'}. <a href="#review" onClick={e => { e.preventDefault(); go('review'); }}>Review</a></p>
      )}
      <div style={{ marginTop: 12 }}>
        {!exercises.length ? (
          <Empty title={`No ${ENDURANCE_LABEL[type].toLowerCase()} logged yet`}>
            {type === 'run' ? 'Log a run with its time in Quick Entry (e.g. 8:26 = 8 min 26 s), or write it in a workout sheet.' : 'Entries with a time or distance are picked up automatically from any sheet in the folder.'}
          </Empty>
        ) : exercises.map(ex => <ExerciseBlock key={ex} ex={ex} display={s.dataset.exercises[ex]?.display ?? ex} sessions={ofType.filter(x => x.exercise === ex)} allSessions={all.filter(x => x.exercise === ex)} runUnit={set.distanceUnitRun} carryUnit={set.distanceUnitCarry} perHand={set.carryWeightPerHand} />)}
      </div>
      {type === 'run' && ofType.length > 0 && <RunWeekly sessions={ofType} unit={set.distanceUnitRun} />}
      <PRs sessions={sessions} />
    </>
  );
}

function ExerciseBlock({ ex, display, sessions, allSessions, runUnit, carryUnit, perHand }: {
  ex: string; display: string; sessions: EnduranceSession[]; allSessions: EnduranceSession[]; runUnit: 'mi' | 'km'; carryUnit: 'm' | 'ft' | 'yd'; perHand: boolean;
}) {
  const t = allSessions[0]?.type ?? 'other';
  const change = pctFromBaseline(sessions);
  const metricLabel = sessions.length ? primaryMetric(sessions[0]).label : '';
  const dist = (m: number | null) => (m == null ? '—' : t === 'run' ? `${fmt(metersTo(m, runUnit), 2)} ${runUnit}` : `${Math.round(metersTo(m, carryUnit))} ${carryUnit}`);
  const tiles: { label: string; value: string; foot?: string }[] = [];
  const longest = Math.max(...sessions.map(x => x.longestSeconds ?? 0));
  if (t === 'run') {
    const paces = sessions.filter(x => x.paceSecPerMi != null);
    const fastest = paces.length ? Math.min(...paces.map(x => x.paceSecPerMi!)) : null;
    const recent = paces.slice(-5);
    const avg = recent.length ? recent.reduce((a, x) => a + x.paceSecPerMi!, 0) / recent.length : null;
    const longestRun = Math.max(0, ...sessions.map(x => x.distanceM ?? 0));
    tiles.push({ label: 'Fastest pace', value: fastest ? `${formatDuration(fastest)}/mi` : '—' }, { label: 'Average pace (last 5)', value: avg ? `${formatDuration(avg)}/mi` : '—' },
      { label: 'Longest run', value: longestRun ? dist(longestRun) : '—' }, { label: 'Runs', value: String(sessions.length) });
  } else {
    const heaviest = Math.max(0, ...sessions.map(x => x.weight ?? 0));
    tiles.push({ label: t === 'farmer_carry' || t === 'static_hold' ? `Heaviest${perHand ? ' (per hand)' : ''}` : 'Heaviest', value: heaviest ? `${heaviest} lb` : '—' });
    if (longest) tiles.push({ label: t === 'static_hold' ? 'Longest hold' : 'Longest time', value: formatDuration(longest) });
    const tul = sessions.reduce((a, x) => a + (x.seconds ?? 0), 0);
    if (tul) tiles.push({ label: t === 'static_hold' || t === 'farmer_carry' ? 'Total time under load' : 'Total time', value: formatDuration(tul) });
    const steps = sessions.reduce((a, x) => a + (x.steps ?? 0), 0);
    if (steps) tiles.push({ label: 'Total steps', value: steps.toLocaleString() });
  }
  tiles.push({ label: `% change from baseline`, value: pct(change), foot: metricLabel });

  const chartData = sessions.map(x => ({ day: toDay(x.date), x }));
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>{display}</h2>
      <div className="sub">{sessions.length} session{sessions.length === 1 ? '' : 's'} in range · all times read with X:YY = minutes:seconds</div>
      <div className="grid cards" style={{ marginBottom: 12 }}>
        {tiles.map(tl => <Tile key={tl.label} label={tl.label} value={tl.value} foot={tl.foot} />)}
      </div>
      {sessions.length ? (
        <div className="grid two">
          {t === 'run' && <div><h3>Pace per run (lower is faster)</h3><TimeChart data={chartData.filter(c => c.x.paceSecPerMi != null).map(c => ({ day: c.day, y: c.x.paceSecPerMi! }))} yFmt={v => `${formatDuration(v)}`} tipLabel="per mile" lowerIsBetter height={200} yDomain={durDomain(sessions.filter(x => x.paceSecPerMi != null).map(x => x.paceSecPerMi!))} /></div>}
          {t === 'run' && <div><h3>Distance</h3><TimeChart data={chartData.filter(c => c.x.distanceM != null).map(c => ({ day: c.day, y: metersTo(c.x.distanceM!, runUnit) }))} yFmt={v => `${v.toFixed(2)}`} tipLabel={runUnit} height={200} /></div>}
          {(t === 'static_hold' || t === 'other' || (t === 'farmer_carry' && sessions.some(x => x.longestSeconds))) && (
            <div><h3>{t === 'static_hold' ? 'Longest hold per session' : 'Longest time per session'}</h3>
              <TimeChart data={chartData.filter(c => c.x.longestSeconds != null).map(c => ({ day: c.day, y: c.x.longestSeconds!, w: c.x.weight }))} yFmt={v => formatDuration(v)} tipLabel="longest round" height={200} yDomain={durDomain(sessions.filter(x => x.longestSeconds != null).map(x => x.longestSeconds!))} tipExtra={p => (p.w != null ? `at ${p.w} lb${perHand && t !== 'other' ? ' per hand' : ''}` : undefined)} /></div>
          )}
          {(t === 'farmer_carry' || t === 'static_hold') && sessions.some(x => x.loadTime != null || x.loadDistance != null) && (
            <div><h3>{sessions.some(x => x.loadDistance != null) ? 'Total load × distance' : 'Total load × time'}</h3>
              <TimeChart data={chartData.filter(c => (c.x.loadDistance ?? c.x.loadTime) != null).map(c => ({ day: c.day, y: (c.x.loadDistance ?? c.x.loadTime)! }))} yFmt={v => Math.round(v).toLocaleString()} tipLabel={sessions.some(x => x.loadDistance != null) ? 'lb·m' : 'lb·s'} height={200} /></div>
          )}
          {t === 'walking_lunge' && (
            <div><h3>{sessions.some(x => x.loadDistance != null) ? 'Weight × steps' : 'Steps'} per session</h3>
              <TimeChart data={chartData.map(c => ({ day: c.day, y: (c.x.loadDistance ?? c.x.steps ?? 0) }))} yFmt={v => Math.round(v).toLocaleString()} tipLabel={sessions.some(x => x.loadDistance != null) ? 'lb × steps' : 'steps'} height={200} /></div>
          )}
        </div>
      ) : <div className="hint">No sessions in this date range.</div>}
      <details style={{ marginTop: 10 }}>
        <summary className="hint" style={{ cursor: 'pointer' }}>Sessions table (raw sheet value → parsed)</summary>
        <div className="table-wrap"><table style={{ marginTop: 6 }}>
          <thead><tr><th>Date</th><th>Raw value</th><th className="n">Rounds</th><th className="n">Weight</th><th className="n">Time</th><th className="n">Distance</th><th className="n">Steps</th>{t === 'run' && <th className="n">Pace</th>}<th>Source</th></tr></thead>
          <tbody>{[...sessions].reverse().map(x => (
            <tr key={x.date}>
              <td>{shortDate(x.date)}</td><td><code>{x.raws.join(' / ')}</code></td><td className="n">{x.rounds}</td>
              <td className="n">{x.weight != null ? `${x.weight} lb` : '—'}</td>
              <td className="n">{x.seconds != null ? `${formatDuration(x.seconds)}${x.rounds > 1 ? ` (best ${formatDuration(x.longestSeconds)})` : ''}` : '—'}</td>
              <td className="n">{dist(x.distanceM)}</td><td className="n">{x.steps ?? '—'}</td>
              {t === 'run' && <td className="n">{x.paceSecPerMi != null ? `${formatDuration(x.paceSecPerMi)}/mi` : '—'}</td>}
              <td className="hint">{x.refs.join('; ')}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </details>
    </div>
  );
}

function RunWeekly({ sessions, unit }: { sessions: EnduranceSession[]; unit: 'mi' | 'km' }) {
  const weeks = enduranceWeekly(sessions).map(w => ({ day: toDay(w.week), week: w.week, dist: unit === 'mi' ? w.miles : w.miles * 1.609344 }));
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>Weekly mileage</h2>
      <div className="sub">Monday–Sunday totals</div>
      <div style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeks} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="day" tickFormatter={dayTick} {...axisProps} />
            <YAxis {...axisProps} axisLine={false} width={40} />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} isAnimationActive={false} content={({ active, payload }) => active && payload?.length
              ? <TipBox title={`Week of ${longDate(payload[0].payload.week)}`} rows={[{ label: unit, value: payload[0].payload.dist.toFixed(2), color: 'var(--series-1)' }]} /> : null} />
            <Bar dataKey="dist" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PRs({ sessions }: { sessions: EnduranceSession[] }) {
  const s = useSync();
  const prs = endurancePRs(sessions, s.dataset.exercises);
  const weekly = enduranceWeekly(sessions);
  return (
    <div className="grid two">
      <div className="card table-wrap">
        <h2>Endurance PRs</h2>
        <div className="sub">longest, fastest, heaviest, most load × time</div>
        {prs.length ? <table><thead><tr><th>Date</th><th>Exercise</th><th>Type</th><th className="n">Value</th><th>Detail</th></tr></thead>
          <tbody>{prs.map((p, i) => <tr key={i}><td>{shortDate(p.date)}</td><td>{p.exercise}</td><td><span className="pill pr">{p.kind}</span></td><td className="n">{p.value}</td><td className="hint">{p.detail}</td></tr>)}</tbody></table>
          : <div className="hint">PRs appear once an exercise has 2+ sessions to compare.</div>}
      </div>
      <div className="card table-wrap">
        <h2>Weekly totals</h2>
        <div className="sub">all endurance, Monday–Sunday</div>
        {weekly.length ? <table><thead><tr><th>Week of</th><th className="n">Sessions</th><th className="n">Time</th><th className="n">Run miles</th><th className="n">Lunge steps</th></tr></thead>
          <tbody>{[...weekly].reverse().map(w => <tr key={w.week}><td>{shortDate(w.week)}</td><td className="n">{w.sessions}</td><td className="n">{w.seconds ? formatDuration(w.seconds) : '—'}</td><td className="n">{w.miles ? w.miles.toFixed(2) : '—'}</td><td className="n">{w.steps || '—'}</td></tr>)}</tbody></table>
          : <div className="hint">Nothing in this range.</div>}
      </div>
    </div>
  );
}

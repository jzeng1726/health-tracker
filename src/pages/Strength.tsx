import { useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from 'recharts';
import type { Page } from '../App';
import { useSync, useRange, pct, fmt, shortDate, longDate, Empty, Section, TimeChart, TipBox, axisProps, inRange, todayISO } from '../ui/common';
import { sessionsByExercise, muscleScores, weeklySets, strengthPRs, exerciseProgress, mondayOf, type SessionBest } from '../core/strength';
import { MUSCLES, type Muscle } from '../core/muscles';
import { toDay } from '../core/bodyweight';

type Sel = Muscle | 'Overall';

export default function Strength({ go }: { go: (p: Page) => void }) {
  const s = useSync();
  const { bounds } = useRange();
  const ds = s.dataset;
  const [sel, setSel] = useState<Sel>('Overall');
  const [openEx, setOpenEx] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);

  const d = useMemo(() => {
    const byEx = sessionsByExercise(ds.sets);
    const scores = muscleScores(byEx, ds.exercises, bounds.start, bounds.end ?? undefined);
    const weeks = weeklySets(ds.sets, ds.endurance, ds.exercises, s.config.settings.enduranceCountsTowardVolume, bounds.start);
    const prs = strengthPRs(byEx).filter(p => inRange(p.date, bounds));
    const rows = [...byEx.entries()].map(([ex, list]) => ({ ex, info: ds.exercises[ex], prog: exerciseProgress(list, bounds.start, bounds.end ?? undefined), all: list }))
      .filter(r => r.info && r.info.kind === 'strength');
    return { byEx, scores, weeks, prs, rows };
  }, [ds, bounds, s.config.settings.enduranceCountsTowardVolume]);

  if (!ds.sets.length) return <Empty title="No strength sets found">Workout sheets in the folder are detected automatically.</Empty>;

  const series = d.scores.series[sel];
  const rows = d.rows
    .filter(r => sel === 'Overall' || r.info.primary === sel || r.info.secondary.includes(sel))
    .sort((a, b) => (b.prog.latest?.date ?? '').localeCompare(a.prog.latest?.date ?? '') || a.info.display.localeCompare(b.info.display));
  const weekKeys = d.weeks.map(w => w.week);
  const curWeek = week && weekKeys.includes(week) ? week : weekKeys.includes(mondayOf(todayISO())) ? mondayOf(todayISO()) : weekKeys.at(-1) ?? null;
  const weekRow = d.weeks.find(w => w.week === curWeek);
  const weekBars = MUSCLES.map(m => ({ muscle: m, sets: (weekRow as any)?.[m] ?? 0 }));
  const lowReview = ds.review.filter(r => r.kind === 'exercise' || r.kind === 'merge').length;

  return (
    <>
      <div className="chips" role="tablist" aria-label="Muscle group">
        {(['Overall', ...MUSCLES] as Sel[]).map(m => (
          <button key={m} role="tab" aria-selected={sel === m} className={`chip ${sel === m ? 'on' : ''}`} onClick={() => setSel(m)}>
            {m}<span className="v">{pct(d.scores.current[m], 1)}</span>
          </button>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>{sel === 'Overall' ? 'Overall strength' : sel} · % change in estimated 1RM</h2>
        <div className="sub">
          {sel === 'Overall'
            ? 'Weighted average of all muscle scores. Baseline = each exercise\'s first session in the date range.'
            : `Average % change of the exercises below (primary counts 100%, secondary 50%).`}
        </div>
        <TimeChart data={series.map(p => ({ day: toDay(p.date), y: p.pct }))} yFmt={v => pct(v, 0)} tipLabel="vs baseline" zeroLine area height={240} />
      </div>

      <Section title="Every muscle group" sub="click one to focus" />
      <div className="grid minis">
        {(['Overall', ...MUSCLES] as Sel[]).map(m => {
          const ser = d.scores.series[m];
          return (
            <div key={m} className={`card click`} onClick={() => setSel(m)} style={sel === m ? { borderColor: 'var(--ink-2)' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3>{m}</h3><b className="num">{pct(d.scores.current[m])}</b></div>
              <TimeChart data={ser.map(p => ({ day: toDay(p.date), y: p.pct }))} yFmt={v => pct(v, 0)} tipLabel={m} zeroLine height={110} dots={false} compact />
            </div>
          );
        })}
      </div>

      <Section title="Exercises" sub={sel === 'Overall' ? 'all' : `mapped to ${sel}`} right={lowReview ? <button className="btn small" onClick={() => go('review')}>Review exercises ({lowReview})</button> : <button className="btn small" onClick={() => go('review')}>Exercise map</button>} />
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Exercise</th><th>Muscles</th><th className="n">Sessions</th><th>Latest best set</th><th className="n">Est. 1RM</th><th className="n">% change</th><th className="n">Last volume</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const l = r.prog.latest;
              return [
                <tr key={r.ex} className={`clickable ${openEx === r.ex ? 'sel' : ''}`} onClick={() => setOpenEx(openEx === r.ex ? null : r.ex)}>
                  <td>{r.info.display}{r.info.confidence === 'low' || r.info.confidence === 'none' ? <> <span className="pill low">unconfirmed</span></> : null}</td>
                  <td className="hint">{r.info.primary}{r.info.secondary.length ? ` + ${r.info.secondary.join(', ')} (½)` : ''}</td>
                  <td className="n">{r.prog.sessions.length}</td>
                  <td>{l ? <>{l.weight ?? 'BW'} × {l.reps} <span className="hint">{shortDate(l.date)}</span>{l.isPR && <> <span className="pill pr">PR</span></>}</> : '—'}</td>
                  <td className="n">{l?.e1rm != null ? fmt(l.e1rm) : '—'}</td>
                  <td className="n">{r.prog.pct == null ? '—' : <span className={r.prog.pct > 0 ? 'delta-good' : r.prog.pct < 0 ? 'delta-bad' : ''}>{pct(r.prog.pct)}</span>}</td>
                  <td className="n">{l ? l.volume.toLocaleString() : '—'}</td>
                </tr>,
                openEx === r.ex && <tr key={r.ex + '-d'}><td colSpan={7}><ExerciseDetail sessions={r.all.filter(x => inRange(x.date, bounds))} name={r.info.display} /></td></tr>,
              ];
            })}
          </tbody>
        </table>
        {!rows.length && <div className="hint" style={{ padding: 10 }}>No exercises mapped to {sel} yet.</div>}
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div><h2>Weekly sets per muscle</h2><div className="sub">primary = 1 set, secondary = ½{s.config.settings.enduranceCountsTowardVolume ? ' · endurance included' : ''}</div></div>
            <select value={curWeek ?? ''} onChange={e => setWeek(e.target.value)} style={{ width: 'auto' }} aria-label="Week">
              {[...weekKeys].reverse().map(w => <option key={w} value={w}>Week of {shortDate(w)}</option>)}
            </select>
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekBars} layout="vertical" margin={{ top: 4, right: 36, bottom: 0, left: 8 }} barCategoryGap={6}>
                <CartesianGrid stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" {...axisProps} allowDecimals={false} domain={[0, (max: number) => Math.max(2, Math.ceil(max))]} />
                <YAxis type="category" dataKey="muscle" {...axisProps} width={80} axisLine={false} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} isAnimationActive={false} content={({ active, payload }) => active && payload?.length
                  ? <TipBox title={`Week of ${longDate(curWeek!)}`} rows={[{ label: `${payload[0].payload.muscle} sets`, value: String(payload[0].payload.sets), color: 'var(--series-1)' }]} /> : null} />
                <Bar dataKey="sets" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                  <LabelList dataKey="sets" position="right" fill="var(--ink-2)" fontSize={11} formatter={(v: number) => (v ? v : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card table-wrap">
          <h2>PR tracker</h2>
          <div className="sub">new best estimated 1RM or heaviest weight, in range</div>
          {d.prs.length ? (
            <table>
              <thead><tr><th>Date</th><th>Exercise</th><th>Type</th><th className="n">Value</th><th>Set</th></tr></thead>
              <tbody>{d.prs.slice(0, 25).map((p, i) => (
                <tr key={i}><td>{shortDate(p.date)}</td><td>{ds.exercises[p.exercise]?.display ?? p.exercise}</td><td><span className="pill pr">{p.kind}</span></td><td className="n">{p.value}</td><td className="hint">{p.detail}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="hint">No PRs in this range yet.</div>}
        </div>
      </div>
    </>
  );
}

function ExerciseDetail({ sessions, name }: { sessions: SessionBest[]; name: string }) {
  const withE = sessions.filter(x => x.e1rm != null);
  return (
    <div style={{ padding: '6px 0 10px' }}>
      <div className="grid two">
        <div>
          <h3>{name} · estimated 1RM (best set per session)</h3>
          <TimeChart data={withE.map(x => ({ day: toDay(x.date), y: x.e1rm!, set: `${x.weight} × ${x.reps}` }))} yFmt={v => `${Math.round(v)}`} tipLabel="lb est. 1RM" height={200} tipExtra={p => `best set ${p.set}`} />
        </div>
        <div>
          <h3>Volume per session (sets × reps × weight)</h3>
          <TimeChart data={sessions.map(x => ({ day: toDay(x.date), y: x.volume }))} yFmt={v => v.toLocaleString()} tipLabel="lb volume" height={200} />
        </div>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Date</th><th>Best set</th><th className="n">Est. 1RM</th><th className="n">Sets</th><th className="n">Volume</th><th>Source cell</th></tr></thead>
        <tbody>{[...sessions].reverse().map(x => (
          <tr key={x.date}><td>{shortDate(x.date)}</td><td>{x.weight ?? 'BW'} × {x.reps} {x.isPR && <span className="pill pr">PR</span>}</td><td className="n">{x.e1rm != null ? fmt(x.e1rm) : '—'}</td><td className="n">{x.sets}</td><td className="n">{x.volume.toLocaleString()}</td><td className="hint">{x.ref}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

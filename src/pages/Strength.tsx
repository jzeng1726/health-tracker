import { useMemo, useState } from 'react';
import type { Page } from '../App';
import { useSync, useRange, pct, fmt, shortDate, Empty, Section, TimeChart, inRange, todayISO } from '../ui/common';
import {
  sessionsByExercise, muscleScores, weeklySets, strengthPRs, exerciseProgress, gymFactors, unifiedSessions, relativeSeries,
  findPlateaus, nextTarget, bodyweightOn, stationKey, mainGym, type SessionBest, type GymFactor, type Plateau,
} from '../core/strength';
import { MUSCLES, type Muscle } from '../core/muscles';
import { toDay, movingAverage, type MAPoint } from '../core/bodyweight';
import { VolumeHeatmap } from '../ui/Heatmap';
import type { NoteEntry } from '../core/model';
import { SETUP_TAGS, TAG_LABEL } from '../core/notes';

type Sel = Muscle | 'Overall';

export default function Strength({ go }: { go: (p: Page) => void }) {
  return <StrengthView go={go} scope="all" />;
}

/** Strength charts + exercise table, for every gym ("all") or one gym. */
export function StrengthView({ go, scope, compact }: { go: (p: Page) => void; scope: string; compact?: boolean }) {
  const s = useSync();
  const { bounds } = useRange();
  const full = s.dataset;
  const ds = useMemo(() => (scope === 'all' ? full : { ...full, sets: full.sets.filter(x => x.gym === scope), endurance: full.endurance.filter(x => x.gym === scope) }), [full, scope]);
  const [sel, setSel] = useState<Sel>('Overall');
  const [openEx, setOpenEx] = useState<string | null>(null);

  const defGym = s.config.gyms.defaultGym || 'Training Station';
  const d = useMemo(() => {
    const byEx = sessionsByExercise(ds.sets);
    const factors = gymFactors(byEx, s.config.gyms.factorOverrides, defGym);
    const ma = movingAverage(ds.bodyweight);
    const scores = muscleScores(byEx, ds.exercises, bounds.start, bounds.end ?? undefined, ds.changes);
    const weeks = weeklySets(ds.sets, ds.endurance, ds.exercises, s.config.settings.enduranceCountsTowardVolume, null);
    const prs = strengthPRs(byEx).filter(p => inRange(p.date, bounds));
    const plateaus = findPlateaus(byEx, todayISO(), 3, ds.changes);
    // one row per exercise per gym — each gym's machine is its own scale
    const rows = [...byEx.entries()].flatMap(([ex, list]) => {
      const info = ds.exercises[ex];
      if (!info || info.kind !== 'strength') return [];
      const gyms = [...new Set(list.map(x => x.gym))];
      return gyms.map(g => {
        const st = list.filter(x => x.gym === g);
        const prog = exerciseProgress(st, bounds.start, bounds.end ?? undefined, ds.changes[stationKey(ex, g)]);
        const bw = prog.latest?.e1rm != null ? bodyweightOn(ma, prog.latest.date) : null;
        return { key: stationKey(ex, g), ex, gym: g, multiGym: gyms.length > 1, info, prog, all: list, rel: bw ? prog.latest!.e1rm! / bw : null, plateau: plateaus.find(p => p.exercise === ex && p.gym === g) ?? null };
      });
    });
    return { byEx, factors, ma, scores, weeks, prs, rows, plateaus };
  }, [ds, bounds, s.config.settings.enduranceCountsTowardVolume, s.config.gyms, defGym]);

  if (!ds.sets.length) return <Empty title={scope === 'all' ? 'No strength sets found' : `No sets logged at ${scope} yet`}>{scope === 'all' ? 'Workout sheets in the folder are detected automatically.' : 'Pick this gym in Quick Entry, add a Gym column to a sheet, or set a sheet\'s gym in Settings → Gyms.'}</Empty>;

  const series = d.scores.series[sel];
  const rows = d.rows
    .filter(r => r.prog.latest != null || r.all.some(x => x.gym === r.gym && inRange(x.date, bounds)))
    .filter(r => sel === 'Overall' || r.info.primary === sel || r.info.secondary.includes(sel))
    .sort((a, b) => (b.prog.latest?.date ?? '').localeCompare(a.prog.latest?.date ?? '') || a.info.display.localeCompare(b.info.display));
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
          <thead><tr><th>Exercise</th><th>Muscles</th><th className="n">Sessions</th><th>Latest best set</th><th className="n">Est. 1RM</th><th className="n" title="estimated 1RM ÷ 7-day average bodyweight">× BW</th><th className="n">% change</th><th className="n">Last volume</th></tr></thead>
          <tbody>
            {rows.map(r => {
              const l = r.prog.latest;
              return [
                <tr key={r.key} className={`clickable ${openEx === r.key ? 'sel' : ''}`} onClick={() => setOpenEx(openEx === r.key ? null : r.key)}>
                  <td>{r.info.display}
                    {(r.multiGym || r.gym !== defGym) && <> <span className="pill gym">{r.gym}</span></>}
                    {r.info.confidence === 'low' || r.info.confidence === 'none' ? <> <span className="pill low">unconfirmed</span></> : null}
                    {r.plateau && <> <span className="pill warn" title={`no new best in ${r.plateau.sessions} sessions`}>plateau</span></>}
                    {(ds.changes[r.key]?.length ?? 0) > 0 && <> <span className="pill note" title="a note says the setup changed — progress is measured from the new setup">✎ {ds.changes[r.key].length} setup change{ds.changes[r.key].length > 1 ? 's' : ''}</span></>}
                  </td>
                  <td className="hint">{r.info.primary}{r.info.secondary.length ? ` + ${r.info.secondary.join(', ')} (½)` : ''}</td>
                  <td className="n">{r.prog.sessions.length}</td>
                  <td>{l ? <>{l.weight ?? 'BW'} × {l.reps} <span className="hint">{shortDate(l.date)}</span>{l.isPR && <> <span className="pill pr">PR</span></>}</> : '—'}</td>
                  <td className="n">{l?.e1rm != null ? fmt(l.e1rm) : '—'}</td>
                  <td className="n">{r.rel != null ? `${r.rel.toFixed(2)}×` : '—'}</td>
                  <td className="n">{r.prog.pct == null ? '—' : <span className={r.prog.pct > 0 ? 'delta-good' : r.prog.pct < 0 ? 'delta-bad' : ''}>{pct(r.prog.pct)}</span>}</td>
                  <td className="n">{l ? l.volume.toLocaleString() : '—'}</td>
                </tr>,
                openEx === r.key && <tr key={r.key + '-d'}><td colSpan={8}><ExerciseDetail all={r.all} gym={r.gym} bounds={bounds} name={r.info.display} factors={d.factors} ma={d.ma} defGym={defGym} plateau={r.plateau} notes={ds.notes.filter(n => n.exercise === r.ex)} changes={ds.changes[r.key] ?? []} /></td></tr>,
              ];
            })}
          </tbody>
        </table>
        {!rows.length && <div className="hint" style={{ padding: 10 }}>No exercises mapped to {sel} yet.</div>}
        <div className="hint" style={{ marginTop: 8 }}>× BW = estimated 1RM ÷ your 7-day average bodyweight that day. During a cut, a rising × BW means you're keeping strength while losing weight.</div>
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Weekly sets per muscle</h2>
          <div className="sub">last 8 weeks · primary = 1 set, secondary = ½ · target {s.config.settings.weeklySetsMin}–{s.config.settings.weeklySetsMax} (change in Settings){s.config.settings.enduranceCountsTowardVolume ? ' · endurance included' : ''}</div>
          <VolumeHeatmap weeks={d.weeks} min={s.config.settings.weeklySetsMin} max={s.config.settings.weeklySetsMax} />
        </div>
        <div className="card table-wrap">
          <h2>PR tracker</h2>
          <div className="sub">new best estimated 1RM or heaviest weight at that gym, in range</div>
          {d.prs.length ? (
            <table>
              <thead><tr><th>Date</th><th>Exercise</th><th>Type</th><th className="n" title="e1RM = estimated 1-rep max from that set; weight = heaviest weight used">Est. max / heaviest</th><th>Set</th></tr></thead>
              <tbody>{d.prs.slice(0, 25).map((p, i) => (
                <tr key={i}><td>{shortDate(p.date)}</td><td>{ds.exercises[p.exercise]?.display ?? p.exercise}{p.gym && p.gym !== defGym && <> <span className="pill gym">{p.gym}</span></>}</td><td><span className="pill pr">{p.kind}</span></td><td className="n">{p.value}</td><td className="hint">{p.detail}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="hint">No PRs in this range yet.</div>}
        </div>
      </div>
    </>
  );
}

function ExerciseDetail({ all, gym, bounds, name, factors, ma, defGym, plateau, notes, changes }: {
  all: SessionBest[]; gym: string; bounds: { start: string | null; end: string | null }; name: string;
  factors: Map<string, GymFactor>; ma: MAPoint[]; defGym: string; plateau: Plateau | null; notes: NoteEntry[]; changes: string[];
}) {
  const marks = changes.filter(d => inRange(d, bounds)).map(d => ({ day: toDay(d), label: 'setup change' }));
  const gyms = [...new Set(all.map(x => x.gym))];
  const main = mainGym(all, defGym);
  const unified = unifiedSessions(all, factors, defGym).filter(x => inRange(x.date, bounds));
  const rel = relativeSeries(all, factors, ma, defGym).filter(x => inRange(x.date, bounds));
  const here = all.filter(x => x.gym === gym);
  const sessions = here.filter(x => inRange(x.date, bounds));
  const last = here.filter(x => x.e1rm != null).at(-1);
  const target = last ? nextTarget(last) : null;
  const facts = gyms.filter(g => g !== main).map(g => factors.get(stationKey(all[0].exercise, g))).filter(Boolean) as GymFactor[];
  return (
    <div style={{ padding: '6px 0 10px' }}>
      {(target || plateau) && (
        <div className="callout">
          {target && <>Next time at {gym}: <b>{target.text}</b> <span className="hint">({target.why}; PR = {target.prText})</span></>}
          {plateau && <div className="hint">Plateau: no new best in {plateau.sessions} sessions. Try one extra rep, a slower negative, or a 10% lighter week, then build back.</div>}
        </div>
      )}
      <div className="grid two">
        <div>
          <h3>{name} · est. 1RM{gyms.length > 1 ? ` on the ${main} scale` : ''}</h3>
          {gyms.length > 1 && <div className="hint">Open dots = sessions at another gym, converted. {facts.map(f => `${f.gym}: ${f.factor != null ? `×${f.factor.toFixed(2)} — ${f.detail}` : f.detail}`).join(' · ')}</div>}
          <TimeChart data={unified.map(x => ({ day: toDay(x.date), y: x.e1rmMain, set: `${x.weight} × ${x.reps}`, gym: x.gym, conv: x.converted, f: x.factor }))} yFmt={v => `${Math.round(v)}`} tipLabel="lb est. 1RM" height={200} hollowKey="conv"
            xMarks={marks}
            tipExtra={p => [p.conv ? `${p.gym}: ${p.set} × ${p.f.toFixed(2)} = ${Math.round(p.y)} on the ${main} scale` : `best set ${p.set}${gyms.length > 1 ? ` · ${p.gym}` : ''}`, notes.find(n => toDay(n.date) === p.day)?.text].filter(Boolean).join(' · ')} />
        </div>
        <div>
          <h3>Strength-to-bodyweight · est. 1RM ÷ 7-day avg weight</h3>
          <TimeChart data={rel.map(x => ({ day: toDay(x.date), y: x.ratio, bw: x.bw, e: x.e1rm, conv: x.converted }))} yFmt={v => `${v.toFixed(2)}×`} tipLabel="× bodyweight" height={200} hollowKey="conv"
            tipExtra={p => `${Math.round(p.e)} lb ÷ ${p.bw.toFixed(1)} lb`} />
        </div>
      </div>
      {notes.length > 0 && (
        <div className="notes-list">
          <h3>Your notes on this exercise</h3>
          {notes.map(n => (
            <div key={n.key} className="note-row">
              <span className="hint">{shortDate(n.date)}{n.gym !== gym ? ` · ${n.gym}` : ''}</span>
              <span>“{n.text}”</span>
              {n.setupChange ? <span className="pill note" title="progress is measured from this session on">new baseline · {n.tags.filter(t => SETUP_TAGS.includes(t)).map(t => TAG_LABEL[t]).join(', ')}</span>
                : n.tags.length ? <span className="pill">{n.tags.map(t => TAG_LABEL[t]).join(', ')}</span> : null}
            </div>
          ))}
        </div>
      )}
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>Date</th>{gyms.length > 1 && <th>Gym</th>}<th>Best set</th><th className="n">Est. 1RM</th><th className="n">Sets</th><th className="n">Volume</th><th>Source cell</th></tr></thead>
        <tbody>{[...all.filter(x => inRange(x.date, bounds))].reverse().map(x => (
          <tr key={x.date + x.gym} className={x.gym !== gym ? 'other' : ''}><td>{shortDate(x.date)}</td>{gyms.length > 1 && <td>{x.gym}</td>}<td>{x.weight ?? 'BW'} × {x.reps}{x.rpe != null ? ` @${x.rpe}` : ''} {x.isPR && <span className="pill pr">PR</span>}</td><td className="n">{x.e1rm != null ? fmt(x.e1rm) : '—'}</td><td className="n">{x.sets}</td><td className="n">{x.volume.toLocaleString()}</td><td className="hint">{x.ref}</td></tr>
        ))}</tbody>
      </table>
      {!sessions.length && <div className="hint">No sessions at {gym} in this range.</div>}
    </div>
  );
}

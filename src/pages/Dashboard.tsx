import { useMemo } from 'react';
import type { Page } from '../App';
import { useSync, useRange, Tile, fmt, pct, shortDate, Empty, Section, todayISO, inRange, StaleNote, BandPill } from '../ui/common';
import { movingAverage, bodyweightStats, toDay } from '../core/bodyweight';
import { sessionsByExercise, muscleScores, strengthPRs, mondayOf, findPlateaus } from '../core/strength';
import { currentProgram, dayOptions } from '../core/prep';
import { enduranceSessions, enduranceWeekly, endurancePRs } from '../core/endurance';

export default function Dashboard({ go }: { go: (p: Page) => void }) {
  const s = useSync();
  const { bounds } = useRange();
  const ds = s.dataset;
  const settings = s.config.settings;

  const d = useMemo(() => {
    const ma = movingAverage(ds.bodyweight);
    const maIn = ma.filter(p => inRange(p.date, bounds));
    const bw = bodyweightStats(ma, bounds.start, s.config.goals.goalWeightLb);
    const byEx = sessionsByExercise(ds.sets);
    const scores = muscleScores(byEx, ds.exercises, bounds.start, bounds.end ?? undefined);
    const endS = enduranceSessions(ds.endurance, settings.carryWeightPerHand);
    const weeks = enduranceWeekly(endS.filter(x => x.type === 'run'));
    const thisWeek = mondayOf(todayISO());
    const runThisWeek = weeks.find(w => w.week === thisWeek)?.miles ?? 0;
    const sessionDays = new Set([...ds.sets.map(x => x.date), ...ds.endurance.map(x => x.date)].filter(x => mondayOf(x) === thisWeek));
    const prs = [...strengthPRs(byEx).map(p => ({ ...p, display: ds.exercises[p.exercise]?.display ?? p.exercise, tab: 'strength' as Page })),
      ...endurancePRs(endS, ds.exercises).map(p => ({ ...p, display: p.exercise, tab: 'endurance' as Page }))]
      .filter(p => inRange(p.date, bounds)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
    const workoutsPerWeek = new Map<string, Set<string>>();
    for (const x of [...ds.sets, ...ds.endurance]) {
      const w = mondayOf(x.date);
      workoutsPerWeek.set(w, (workoutsPerWeek.get(w) ?? new Set()).add(x.date));
    }
    const plateaus = findPlateaus(byEx, todayISO());
    const prog = currentProgram(ds.programs);
    const next = prog ? dayOptions(prog)[0] ?? null : null;
    return { ma, maIn, bw, scores, weeks, runThisWeek, sessionDays, prs, workoutsPerWeek, plateaus, prog, next };
  }, [ds, bounds, s.config.goals.goalWeightLb, settings.carryWeightPerHand]);

  if (!s.files.length) {
    return <Empty title={s.syncing ? 'Loading your sheets…' : 'No sheets loaded yet'}>{s.syncing ? 'First sync can take a few seconds.' : 'Press Refresh, or check the folder in Settings.'}</Empty>;
  }

  const bw = d.bw;
  const overall = d.scores.current.Overall;
  return (
    <>
      <StaleNote stats={bw} />
      <div className="grid cards">
        <Tile label="Current weight · 7-day average" value={fmt(bw.current)} unit="lb" onClick={() => go('bodyweight')}
          foot={<>{bw.currentPartial && <span className="pill low">partial average</span>}{bw.lastDate && <>last weigh-in {shortDate(bw.lastDate)}</>}</>}
          spark={d.maIn.map(p => ({ x: toDay(p.date), y: p.ma }))} />
        <Tile label="Total lost" value={bw.totalLost == null ? '—' : fmt(bw.totalLost)} unit="lb" onClick={() => go('bodyweight')}
          foot={<>{bw.pctLost != null && <span>{(bw.pctLost * 100).toFixed(1)}% of bodyweight</span>}{bw.startDate && <span>since {shortDate(bw.startDate)}</span>}</>} />
        <Tile label="Weekly loss rate" value={bw.weeklyRate == null ? '—' : fmt(bw.weeklyRate, 2)} unit="lb/wk" onClick={() => go('bodyweight')}
          foot={bw.weeklyRatePct != null ? <><span>{(bw.weeklyRatePct * 100).toFixed(2)}% BW/week</span><BandPill pct={bw.weeklyRatePct} min={settings.lossRateMinPct} max={settings.lossRateMaxPct} /></> : 'Needs a weigh-in from a week ago'} />
        <Tile label="Overall strength" value={overall == null ? '—' : pct(overall)} onClick={() => go('strength')}
          foot={<span>est. 1RM change since the first session in range</span>}
          spark={d.scores.series.Overall.map(p => ({ x: toDay(p.date), y: p.pct }))} />
        {d.next && (
          <Tile label="Next session" value={d.next.label.replace(/^FB\s+/i, '').replace(/\s*DAY$/i, ' day').toLowerCase().replace(/^./, c => c.toUpperCase())} onClick={() => go('prep')} accent
            foot={<span>{d.next.week != null ? `Week ${d.next.week} · ` : ''}{d.next.block.items.length} exercises · open Gym prep for the numbers to beat</span>} />
        )}
        <Tile label="Workouts this week" value={d.sessionDays.size} unit={d.sessionDays.size === 1 ? 'day' : 'days'} onClick={() => go('strength')}
          foot={<span>Mon–Sun, strength + endurance</span>}
          spark={[...d.workoutsPerWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([w, set]) => ({ x: toDay(w), y: set.size }))} />
        <Tile label="Run mileage this week" value={fmt(d.runThisWeek, 2)} unit="mi" onClick={() => go('endurance')}
          foot={d.weeks.length ? <span>{d.weeks.length} week{d.weeks.length > 1 ? 's' : ''} with runs logged</span> : <span>No runs with a time logged yet</span>}
          spark={d.weeks.slice(-8).map(w => ({ x: toDay(w.week), y: w.miles }))} />
      </div>

      {d.plateaus.length > 0 && (
        <>
          <Section title="Stalled lifts" sub="no new best estimated 1RM in 3+ sessions at that gym" right={<button className="btn small" onClick={() => go('strength')}>Strength</button>} />
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Exercise</th><th>Gym</th><th className="n">Sessions since best</th><th className="n">Best est. 1RM</th><th>Try</th></tr></thead>
              <tbody>{d.plateaus.slice(0, 6).map(p => (
                <tr key={p.exercise + p.gym} className="clickable" onClick={() => go('strength')}>
                  <td>{ds.exercises[p.exercise]?.display ?? p.exercise}</td><td className="hint">{p.gym}</td><td className="n">{p.sessions}</td><td className="n">{fmt(p.best, 0)} <span className="hint">{shortDate(p.bestDate)}</span></td>
                  <td className="hint">one extra rep, slower negatives, or a 10% lighter week then build back</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <Section title="Recent PRs" sub="strength and endurance, in the selected range" />
      {d.prs.length ? (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Exercise</th><th>Record</th><th className="n">Value</th><th>Set</th></tr></thead>
            <tbody>
              {d.prs.map((p, i) => (
                <tr key={i} className="clickable" onClick={() => go(p.tab)}>
                  <td>{shortDate(p.date)}</td><td>{p.display}{'gym' in p && p.gym && p.gym !== (s.config.gyms.defaultGym || 'Home gym') && <> <span className="pill gym">{p.gym}</span></>}</td><td><span className="pill pr">{p.kind}</span></td><td className="n">{p.value}</td><td className="hint">{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title="No new PRs in this range">Widen the date range to see earlier records.</Empty>}
    </>
  );
}

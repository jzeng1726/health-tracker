import { useMemo } from 'react';
import type { Page } from '../App';
import { useSync, useRange, Tile, fmt, pct, shortDate, Empty, Section, todayISO, inRange } from '../ui/common';
import { movingAverage, bodyweightStats, toDay } from '../core/bodyweight';
import { sessionsByExercise, muscleScores, strengthPRs, mondayOf } from '../core/strength';
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
    return { ma, maIn, bw, scores, weeks, runThisWeek, sessionDays, prs, workoutsPerWeek };
  }, [ds, bounds, s.config.goals.goalWeightLb, settings.carryWeightPerHand]);

  if (!s.files.length) {
    return <Empty title={s.syncing ? 'Loading your sheets…' : 'No sheets loaded yet'}>{s.syncing ? 'First sync can take a few seconds.' : 'Press Refresh, or check the folder in Settings.'}</Empty>;
  }

  const bw = d.bw;
  const overall = d.scores.current.Overall;
  return (
    <>
      <div className="grid cards">
        <Tile label="Current weight · 7-day average" value={fmt(bw.current)} unit="lb" onClick={() => go('bodyweight')}
          foot={<>{bw.currentPartial && <span className="pill low">partial average</span>}{bw.lastDate && <>last weigh-in {shortDate(bw.lastDate)}</>}</>}
          spark={d.maIn.map(p => ({ x: toDay(p.date), y: p.ma }))} />
        <Tile label="Total lost" value={bw.totalLost == null ? '—' : fmt(bw.totalLost)} unit="lb" onClick={() => go('bodyweight')}
          foot={<>{bw.pctLost != null && <span>{(bw.pctLost * 100).toFixed(1)}% of bodyweight</span>}{bw.startDate && <span>since {shortDate(bw.startDate)}</span>}</>} />
        <Tile label="Weekly loss rate" value={bw.weeklyRate == null ? '—' : fmt(bw.weeklyRate, 2)} unit="lb/wk" onClick={() => go('bodyweight')}
          foot={bw.weeklyRatePct != null ? <span>{(bw.weeklyRatePct * 100).toFixed(2)}% BW/week · 7-day avg vs a week earlier</span> : 'Needs a weigh-in from a week ago'} />
        <Tile label="Overall strength" value={overall == null ? '—' : pct(overall)} onClick={() => go('strength')}
          foot={<span>est. 1RM change since the first session in range</span>}
          spark={d.scores.series.Overall.map(p => ({ x: toDay(p.date), y: p.pct }))} />
        <Tile label="Workouts this week" value={d.sessionDays.size} unit={d.sessionDays.size === 1 ? 'day' : 'days'} onClick={() => go('strength')}
          foot={<span>Mon–Sun, strength + endurance</span>}
          spark={[...d.workoutsPerWeek.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-8).map(([w, set]) => ({ x: toDay(w), y: set.size }))} />
        <Tile label="Run mileage this week" value={fmt(d.runThisWeek, 2)} unit="mi" onClick={() => go('endurance')}
          foot={d.weeks.length ? <span>{d.weeks.length} week{d.weeks.length > 1 ? 's' : ''} with runs logged</span> : <span>No runs with a time logged yet</span>}
          spark={d.weeks.slice(-8).map(w => ({ x: toDay(w.week), y: w.miles }))} />
      </div>

      <Section title="Recent PRs" sub="strength and endurance, in the selected range" />
      {d.prs.length ? (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Exercise</th><th>Record</th><th className="n">Value</th><th>Set</th></tr></thead>
            <tbody>
              {d.prs.map((p, i) => (
                <tr key={i} className="clickable" onClick={() => go(p.tab)}>
                  <td>{shortDate(p.date)}</td><td>{p.display}</td><td><span className="pill pr">{p.kind}</span></td><td className="n">{p.value}</td><td className="hint">{p.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title="No new PRs in this range">Widen the date range to see earlier records.</Empty>}
    </>
  );
}

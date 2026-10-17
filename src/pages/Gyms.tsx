import { useMemo, useState } from 'react';
import type { Page } from '../App';
import { useSync, useRange, pct, shortDate, inRange, Sparkline } from '../ui/common';
import { sessionsByExercise, muscleScores } from '../core/strength';
import { toDay } from '../core/bodyweight';
import { StrengthView } from './Strength';

/** Progress per gym: Training Station, Firehouse Gym and Overall (every gym, Vacation included). */
export default function Gyms({ go }: { go: (p: Page) => void }) {
  const s = useSync();
  const { bounds } = useRange();
  const ds = s.dataset;
  const g = s.config.gyms;
  const scopes = useMemo(() => {
    const own = [g.defaultGym || 'Training Station', ...g.names].filter((x, i, a) => a.indexOf(x) === i && !/vacation/i.test(x));
    return [{ id: 'all', label: 'Overall', sub: 'every gym, Vacation included' }, ...own.map(x => ({ id: x, label: x, sub: x === g.defaultGym ? 'your main gym' : '' }))];
  }, [g]);
  const [sel, setSel] = useState('all');

  const cards = useMemo(() => scopes.map(sc => {
    const sets = sc.id === 'all' ? ds.sets : ds.sets.filter(x => x.gym === sc.id);
    const scores = muscleScores(sessionsByExercise(sets), ds.exercises, bounds.start, bounds.end ?? undefined, ds.changes);
    const days = [...new Set(sets.map(x => x.date))].sort();
    const inR = days.filter(d => inRange(d, bounds));
    const top = Object.entries(scores.current).filter(([m, v]) => m !== 'Overall' && v != null).sort((a, b) => b[1]! - a[1]!)[0];
    return { ...sc, overall: scores.current.Overall, series: scores.series.Overall, sessions: inR.length, last: days.at(-1), top };
  }), [scopes, ds, bounds]);

  return (
    <>
      <div className="grid cards gym-cards">
        {cards.map(c => (
          <div key={c.id} className={`card tile click ${sel === c.id ? 'accent' : ''}`} onClick={() => setSel(c.id)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSel(c.id); }} aria-pressed={sel === c.id}>
            <div className="tile-label">{c.label}{c.sub && <span className="hint"> · {c.sub}</span>}</div>
            <div className="tile-value">{c.overall == null ? '—' : pct(c.overall)}</div>
            <div className="tile-foot">
              {c.sessions ? <span>{c.sessions} session{c.sessions > 1 ? 's' : ''} in range</span> : <span>no sessions in range</span>}
              {c.last && <span>last {shortDate(c.last)}</span>}
              {c.top && <span>best: {c.top[0]} {pct(c.top[1])}</span>}
            </div>
            {c.series.length > 1 ? <Sparkline data={c.series.map(p => ({ x: toDay(p.date), y: p.pct }))} /> : <div className="hint" style={{ marginTop: 6, height: 34 }}>{c.sessions ? 'Trend appears after 2 sessions' : ''}</div>}
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '8px 0 14px' }}>
        Each gym is compared only to itself (its machines are its own scale). Overall combines every gym's progress, Vacation included. Notes like "changed grip" or "seat moved up" start a new baseline for that exercise.
      </p>
      <StrengthView key={sel} go={go} scope={sel} />
    </>
  );
}

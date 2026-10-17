import { useState } from 'react';
import { MUSCLES, type Muscle } from '../core/muscles';
import { mondayOf } from '../core/strength';
import { toDay, fromDay } from '../core/bodyweight';
import { shortDate, longDate, todayISO } from './common';

/**
 * Weekly working sets per muscle: rows = muscles, columns = the last N weeks.
 * Shade = how many sets (one blue, light → dark). Outline = against your target:
 * dashed = under, solid = in range, ▲ = over.
 */
export function VolumeHeatmap({ weeks, min, max, n = 8 }: { weeks: ({ week: string } & Partial<Record<Muscle, number>>)[]; min: number; max: number; n?: number }) {
  const thisWeek = mondayOf(todayISO());
  const cols = Array.from({ length: n }, (_, i) => fromDay(toDay(thisWeek) - (n - 1 - i) * 7));
  const byWeek = new Map(weeks.map(w => [w.week, w]));
  const top = Math.max(max * 1.25, 1, ...weeks.flatMap(w => MUSCLES.map(m => w[m] ?? 0)));
  const step = (v: number) => (v <= 0 ? 0 : Math.min(6, Math.max(1, Math.ceil((v / top) * 6))));
  const [hover, setHover] = useState<{ week: string; m: Muscle; v: number } | null>(null);
  const status = (v: number) => (v < min ? 'under' : v > max ? 'over' : 'in');
  const label = (v: number) => (v < min ? `under target (${min}–${max})` : v > max ? `over target (${min}–${max})` : `in target (${min}–${max})`);
  return (
    <div>
      <div className="heat" style={{ gridTemplateColumns: `86px repeat(${n}, minmax(28px, 1fr))` }} role="table" aria-label="Weekly sets per muscle">
        <div role="row" style={{ display: 'contents' }}>
          <div />
          {cols.map(c => <div key={c} className={`heat-col ${c === thisWeek ? 'now' : ''}`} role="columnheader">{c === thisWeek ? 'this wk' : shortDate(c)}</div>)}
        </div>
        {MUSCLES.map(m => (
          <div key={m} role="row" style={{ display: 'contents' }}>
            <div className="heat-row" role="rowheader">{m}</div>
            {cols.map(c => {
              const v = (byWeek.get(c) as any)?.[m] ?? 0;
              const st = status(v);
              return (
                <div key={c} role="cell" tabIndex={0} className={`heat-cell s${step(v)} ${st}`} aria-label={`Week of ${shortDate(c)}, ${m}: ${v} sets, ${label(v)}`}
                  onMouseEnter={() => setHover({ week: c, m, v })} onFocus={() => setHover({ week: c, m, v })} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}>
                  {v ? (Number.isInteger(v) ? v : v.toFixed(1)) : ''}{st === 'over' && v ? <span className="up">▲</span> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat-foot">
        <span className="hint" aria-live="polite">{hover ? <>Week of {longDate(hover.week)} · <b>{hover.m}</b>: {hover.v} set{hover.v === 1 ? '' : 's'} — {label(hover.v)}</> : 'Hover a cell for details.'}</span>
        <span className="heat-legend">
          <span className="k"><span className="sw under" />under</span>
          <span className="k"><span className="sw in" />in target</span>
          <span className="k"><span className="sw over">▲</span>over</span>
          <span className="k ramp"><span className="s1" /><span className="s3" /><span className="s5" />more sets</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Endurance metrics (runs, walking lunges, farmer carries, static holds, timed core, anything new).
 * Never feeds e1RM. Durations are seconds; distances are meters internally.
 */
import type { EnduranceEntry, ExerciseInfo } from './model';
import type { EnduranceType } from './muscles';
import { metersTo } from './time';
import { mondayOf, type PR } from './strength';
import { formatDuration } from './time';

export interface EnduranceSession {
  date: string;
  exercise: string;
  type: EnduranceType;
  rounds: number;
  weight: number | null;          // per hand for carries/holds when configured
  totalLoad: number | null;       // both hands (carries/holds) or weight (lunges)
  seconds: number | null;         // total across rounds
  longestSeconds: number | null;  // best single round
  distanceM: number | null;
  steps: number | null;           // total steps (per-leg counts doubled)
  paceSecPerMi: number | null;    // runs
  loadTime: number | null;        // totalLoad × seconds
  loadDistance: number | null;    // totalLoad × distance (m) or × steps
  refs: string[];
  raws: string[];
}

export function enduranceSessions(entries: EnduranceEntry[], perHand: boolean): EnduranceSession[] {
  const groups = new Map<string, EnduranceEntry[]>();
  for (const e of entries) groups.set(`${e.exercise}|${e.date}`, [...(groups.get(`${e.exercise}|${e.date}`) ?? []), e]);
  const out: EnduranceSession[] = [];
  for (const [k, es] of groups) {
    const [exercise, date] = k.split('|');
    const type = es[0].type;
    const sum = (f: (e: EnduranceEntry) => number | null) => { const v = es.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
    const max = (f: (e: EnduranceEntry) => number | null) => { const v = es.map(f).filter((x): x is number => x != null); return v.length ? Math.max(...v) : null; };
    const weight = max(e => e.weight);
    const handMult = (type === 'farmer_carry' || type === 'static_hold') && perHand ? 2 : 1;
    const totalLoad = weight != null ? weight * handMult : null;
    const seconds = sum(e => e.seconds);
    const distanceM = sum(e => e.distanceM);
    const steps = sum(e => (e.steps != null ? e.steps * (e.perSide ? 2 : 1) : null));
    const miles = distanceM != null ? metersTo(distanceM, 'mi') : null;
    // load × time: per round, summed (rounds may use different weights)
    const loadTime = es.some(e => e.weight != null && e.seconds != null)
      ? es.reduce((s, e) => s + (e.weight != null && e.seconds != null ? e.weight * handMult * e.seconds : 0), 0) : null;
    const loadDistance = es.some(e => e.weight != null && (e.distanceM != null || e.steps != null))
      ? es.reduce((s, e) => s + (e.weight != null ? e.weight * handMult * (e.distanceM ?? (e.steps != null ? e.steps * (e.perSide ? 2 : 1) : 0)) : 0), 0) : null;
    out.push({
      date, exercise, type, rounds: es.length, weight, totalLoad, seconds, longestSeconds: max(e => e.seconds), distanceM, steps,
      paceSecPerMi: type === 'run' && seconds && miles ? seconds / miles : null,
      loadTime, loadDistance, refs: [...new Set(es.map(e => e.ref))], raws: [...new Set(es.map(e => e.raw))],
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The metric used for "% change from baseline" per type (higher = better unless noted). */
export function primaryMetric(s: EnduranceSession): { value: number | null; label: string; lowerIsBetter?: boolean } {
  switch (s.type) {
    case 'run': return s.paceSecPerMi != null ? { value: s.paceSecPerMi, label: 'pace', lowerIsBetter: true } : { value: s.distanceM, label: 'distance' };
    case 'walking_lunge': return { value: s.loadDistance ?? s.steps, label: s.loadDistance != null ? 'weight × steps' : 'steps' };
    case 'farmer_carry': return s.loadDistance != null ? { value: s.loadDistance, label: 'load × distance' } : { value: s.loadTime, label: 'load × time' };
    case 'static_hold': return { value: s.loadTime ?? s.longestSeconds, label: s.loadTime != null ? 'load × time' : 'time held' };
    default: return { value: s.longestSeconds ?? s.seconds, label: 'time' };
  }
}

export function pctFromBaseline(sessions: EnduranceSession[]): number | null {
  const vals = sessions.map(s => ({ s, m: primaryMetric(s) })).filter(x => x.m.value != null);
  if (vals.length < 1) return null;
  const a = vals[0].m.value!, b = vals[vals.length - 1].m.value!;
  if (vals.length === 1) return 0;
  return vals[0].m.lowerIsBetter ? a / b - 1 : b / a - 1;
}

export function endurancePRs(sessions: EnduranceSession[], exercises: Record<string, ExerciseInfo>): PR[] {
  const out: PR[] = [];
  const byEx = new Map<string, EnduranceSession[]>();
  for (const s of sessions) byEx.set(s.exercise, [...(byEx.get(s.exercise) ?? []), s]);
  for (const [ex, list] of byEx) {
    const name = exercises[ex]?.display ?? ex;
    let bestLong = -Infinity, bestPace = Infinity, bestW = -Infinity, bestLT = -Infinity, bestDist = -Infinity;
    list.forEach((s, i) => {
      const first = i === 0;
      if (s.longestSeconds != null && s.longestSeconds > bestLong) { if (!first) out.push({ date: s.date, exercise: name, kind: 'longest', value: formatDuration(s.longestSeconds), detail: s.weight != null ? `@ ${s.weight} lb` : '' }); bestLong = s.longestSeconds; }
      if (s.distanceM != null && s.type !== 'run' && s.distanceM > bestDist) { if (!first) out.push({ date: s.date, exercise: name, kind: 'longest', value: `${Math.round(s.distanceM)} m`, detail: '' }); bestDist = s.distanceM; }
      if (s.type === 'run' && s.distanceM != null && s.distanceM > bestDist) { if (!first) out.push({ date: s.date, exercise: name, kind: 'longest', value: `${metersTo(s.distanceM, 'mi').toFixed(2)} mi`, detail: 'longest run' }); bestDist = s.distanceM; }
      if (s.paceSecPerMi != null && s.paceSecPerMi < bestPace) { if (!first) out.push({ date: s.date, exercise: name, kind: 'fastest', value: `${formatDuration(s.paceSecPerMi)}/mi`, detail: '' }); bestPace = s.paceSecPerMi; }
      if (s.weight != null && s.weight > bestW) { if (!first) out.push({ date: s.date, exercise: name, kind: 'heaviest', value: `${s.weight} lb`, detail: s.longestSeconds != null ? `for ${formatDuration(s.longestSeconds)}` : s.steps != null ? `× ${s.steps} steps` : '' }); bestW = s.weight; }
      if (s.loadTime != null && s.loadTime > bestLT) { if (!first) out.push({ date: s.date, exercise: name, kind: 'load×time', value: `${Math.round(s.loadTime).toLocaleString()} lb·s`, detail: '' }); bestLT = s.loadTime; }
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export interface EnduranceWeek { week: string; seconds: number; miles: number; steps: number; sessions: number }
export function enduranceWeekly(sessions: EnduranceSession[]): EnduranceWeek[] {
  const m = new Map<string, EnduranceWeek>();
  for (const s of sessions) {
    const w = mondayOf(s.date);
    const row = m.get(w) ?? { week: w, seconds: 0, miles: 0, steps: 0, sessions: 0 };
    row.seconds += s.seconds ?? 0;
    row.miles += s.type === 'run' && s.distanceM ? metersTo(s.distanceM, 'mi') : 0;
    row.steps += s.steps ?? 0;
    row.sessions += 1;
    m.set(w, row);
  }
  return [...m.values()].sort((a, b) => a.week.localeCompare(b.week));
}

export const ENDURANCE_LABEL: Record<EnduranceType, string> = {
  run: 'Runs', walking_lunge: 'Walking Lunges', farmer_carry: 'Farmer Carries', static_hold: 'Static Holds', other: 'Timed / Other',
};

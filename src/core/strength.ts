/**
 * Strength metrics.
 *  - best set per session = highest Epley e1RM  (weight × (1 + reps/30))
 *  - exercise % change = latest best e1RM ÷ baseline best e1RM − 1,
 *    baseline = first session inside the selected date range
 *  - muscle score = weighted average of exercise % changes (primary 1.0, secondary 0.5)
 *  - overall = weighted average of all muscle scores (weight = each muscle's total exercise weight)
 * Endurance never feeds e1RM.
 */
import type { StrengthSet, ExerciseInfo, EnduranceEntry } from './model';
import { MUSCLES, type Muscle } from './muscles';
import { epley } from './results';
import { toDay, fromDay } from './bodyweight';

export interface SessionBest {
  date: string;
  exercise: string;
  e1rm: number | null;     // null for bodyweight-only sessions
  weight: number | null;
  reps: number;
  volume: number;          // Σ weight × reps (loaded sets only)
  sets: number;
  isPR: boolean;           // new all-time best e1RM on this day
  isWeightPR: boolean;     // heaviest weight ever used on this day
  ref: string;
}

export function sessionsByExercise(sets: StrengthSet[]): Map<string, SessionBest[]> {
  const groups = new Map<string, StrengthSet[]>();
  for (const s of sets) {
    const k = `${s.exercise}|${s.date}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out = new Map<string, SessionBest[]>();
  for (const [k, ss] of groups) {
    const [exercise, date] = k.split('|');
    let best: StrengthSet | null = null, bestE: number | null = null;
    for (const s of ss) {
      const e = s.weight != null ? epley(s.weight, s.reps) : null;
      if (e != null && (bestE == null || e > bestE)) { best = s; bestE = e; }
    }
    if (!best) best = [...ss].sort((a, b) => b.reps - a.reps)[0];
    out.set(exercise, [...(out.get(exercise) ?? []), {
      date, exercise, e1rm: bestE, weight: best.weight, reps: best.reps,
      volume: ss.reduce((v, s) => v + (s.weight ?? 0) * s.reps, 0), sets: ss.length,
      isPR: false, isWeightPR: false, ref: best.ref,
    }]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    let maxE = -Infinity, maxW = -Infinity;
    list.forEach((s, i) => {
      if (s.e1rm != null) { if (i > 0 && s.e1rm > maxE) s.isPR = true; maxE = Math.max(maxE, s.e1rm); }
      if (s.weight != null) { if (i > 0 && s.weight > maxW) s.isWeightPR = true; maxW = Math.max(maxW, s.weight); }
    });
  }
  return out;
}

export interface ExerciseProgress { exercise: string; baseline: SessionBest | null; latest: SessionBest | null; pct: number | null; sessions: SessionBest[] }

export function exerciseProgress(sessions: SessionBest[], rangeStart: string | null, rangeEnd?: string): ExerciseProgress {
  const inRange = sessions.filter(s => (!rangeStart || s.date >= rangeStart) && (!rangeEnd || s.date <= rangeEnd) && s.e1rm != null);
  const baseline = inRange[0] ?? null, latest = inRange[inRange.length - 1] ?? null;
  const pct = baseline && latest && baseline !== latest ? latest.e1rm! / baseline.e1rm! - 1 : baseline ? 0 : null;
  return { exercise: sessions[0]?.exercise ?? '', baseline, latest, pct, sessions: inRange };
}

export type ScoreSeries = { date: string; pct: number }[];

function weightsFor(ex: ExerciseInfo, m: Muscle): number {
  if (ex.kind !== 'strength') return 0;
  if (ex.primary === m) return 1;
  if (ex.secondary.includes(m)) return 0.5;
  return 0;
}

/** % change series per muscle and overall, carried forward between sessions. */
export function muscleScores(
  byEx: Map<string, SessionBest[]>, exercises: Record<string, ExerciseInfo>, rangeStart: string | null, rangeEnd?: string,
): { series: Record<Muscle | 'Overall', ScoreSeries>; current: Record<Muscle | 'Overall', number | null>; contributors: Record<Muscle, { exercise: string; weight: number; pct: number | null }[]> } {
  const progress = new Map<string, SessionBest[]>();
  for (const [ex, list] of byEx) {
    const inRange = list.filter(s => (!rangeStart || s.date >= rangeStart) && (!rangeEnd || s.date <= rangeEnd) && s.e1rm != null);
    if (inRange.length) progress.set(ex, inRange);
  }
  const dates = [...new Set([...progress.values()].flat().map(s => s.date))].sort();
  const series = Object.fromEntries([...MUSCLES, 'Overall'].map(m => [m, [] as ScoreSeries])) as Record<Muscle | 'Overall', ScoreSeries>;
  const pctAt = (list: SessionBest[], date: string): number | null => {
    const upto = list.filter(s => s.date <= date);
    if (!upto.length) return null;
    return upto[upto.length - 1].e1rm! / list[0].e1rm! - 1;
  };
  for (const date of dates) {
    let oNum = 0, oDen = 0;
    for (const m of MUSCLES) {
      let num = 0, den = 0;
      for (const [ex, list] of progress) {
        const info = exercises[ex];
        if (!info) continue;
        const w = weightsFor(info, m);
        if (!w) continue;
        const p = pctAt(list, date);
        if (p == null) continue;
        num += w * p; den += w;
      }
      if (den) {
        series[m].push({ date, pct: num / den });
        oNum += num; oDen += den;
      }
    }
    if (oDen) series.Overall.push({ date, pct: oNum / oDen });
  }
  const current = Object.fromEntries(Object.entries(series).map(([m, s]) => [m, s.length ? s[s.length - 1].pct : null])) as Record<Muscle | 'Overall', number | null>;
  const contributors = Object.fromEntries(MUSCLES.map(m => [m, [] as any[]])) as Record<Muscle, { exercise: string; weight: number; pct: number | null }[]>;
  for (const [ex, list] of progress) {
    const info = exercises[ex];
    if (!info) continue;
    for (const m of MUSCLES) {
      const w = weightsFor(info, m);
      if (w) contributors[m].push({ exercise: ex, weight: w, pct: list.length > 1 ? list[list.length - 1].e1rm! / list[0].e1rm! - 1 : 0 });
    }
  }
  return { series, current, contributors };
}

export const mondayOf = (iso: string) => { const d = toDay(iso); return fromDay(d - ((new Date(d * 86400000).getUTCDay() + 6) % 7)); };

/** Weekly working sets per muscle (primary 1, secondary 0.5). */
export function weeklySets(
  sets: StrengthSet[], endurance: EnduranceEntry[], exercises: Record<string, ExerciseInfo>, includeEndurance: boolean,
  rangeStart: string | null,
): ({ week: string } & Partial<Record<Muscle, number>>)[] {
  const weeks = new Map<string, Partial<Record<Muscle, number>>>();
  const add = (date: string, ex: ExerciseInfo | undefined) => {
    if (!ex || (rangeStart && date < rangeStart)) return;
    const w = mondayOf(date);
    const row = weeks.get(w) ?? {};
    if (ex.primary) row[ex.primary] = (row[ex.primary] ?? 0) + 1;
    for (const s of ex.secondary) row[s] = (row[s] ?? 0) + 0.5;
    weeks.set(w, row);
  };
  for (const s of sets) {
    // L and R of a single-arm set = one set
    if (s.side === 'R' && sets.some(o => o.key.split('#')[0] === s.key.split('#')[0] && o.side === 'L')) continue;
    add(s.date, exercises[s.exercise]);
  }
  for (const e of endurance) {
    const ex = exercises[e.exercise];
    if (!ex) continue;
    if (ex.kind === 'timed' || includeEndurance) add(e.date, ex);
  }
  return [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, ...v }));
}

export interface PR { date: string; exercise: string; kind: 'e1RM' | 'weight' | 'longest' | 'fastest' | 'heaviest' | 'load×time' | 'load×distance'; value: string; detail: string }

export function strengthPRs(byEx: Map<string, SessionBest[]>): PR[] {
  const out: PR[] = [];
  for (const [ex, list] of byEx) {
    for (const s of list) {
      if (s.isPR) out.push({ date: s.date, exercise: ex, kind: 'e1RM', value: `${s.e1rm!.toFixed(1)} lb`, detail: `${s.weight} × ${s.reps}` });
      else if (s.isWeightPR) out.push({ date: s.date, exercise: ex, kind: 'weight', value: `${s.weight} lb`, detail: `${s.weight} × ${s.reps}` });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

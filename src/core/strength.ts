/**
 * Strength metrics.
 *  - best set per session = highest Epley e1RM  (weight × (1 + reps/30))
 *  - exercise % change = latest best e1RM ÷ baseline best e1RM − 1,
 *    baseline = first session inside the selected date range
 *  - muscle score = weighted average of exercise % changes (primary 1.0, secondary 0.5);
 *    each exercise is tracked per gym, and one that starts later joins once it has a 2nd session
 *  - overall = weighted average of all muscle scores (weight = each muscle's total exercise weight)
 * Endurance never feeds e1RM.
 */
import type { StrengthSet, ExerciseInfo, EnduranceEntry } from './model';
import { MUSCLES, type Muscle } from './muscles';
import { epley } from './results';
import { toDay, fromDay, type MAPoint } from './bodyweight';

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
  /** where — PRs and % change are judged per gym, because machines differ */
  gym: string;
  rpe?: number;
}

export const stationKey = (exercise: string, gym: string) => `${exercise}|${gym}`;

export function sessionsByExercise(sets: StrengthSet[]): Map<string, SessionBest[]> {
  const groups = new Map<string, StrengthSet[]>();
  for (const s of sets) {
    const k = `${s.exercise}|${s.gym ?? ''}|${s.date}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const out = new Map<string, SessionBest[]>();
  for (const [k, ss] of groups) {
    const [exercise, gym, date] = k.split('|');
    let best: StrengthSet | null = null, bestE: number | null = null;
    for (const s of ss) {
      const e = s.weight != null ? epley(s.weight, s.reps) : null;
      if (e != null && (bestE == null || e > bestE)) { best = s; bestE = e; }
    }
    if (!best) best = [...ss].sort((a, b) => b.reps - a.reps)[0];
    out.set(exercise, [...(out.get(exercise) ?? []), {
      date, exercise, e1rm: bestE, weight: best.weight, reps: best.reps,
      volume: ss.reduce((v, s) => v + (s.weight ?? 0) * s.reps, 0), sets: ss.length,
      isPR: false, isWeightPR: false, ref: best.ref, gym, rpe: best.rpe,
    }]);
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.gym.localeCompare(b.gym));
    // PRs per gym: a lighter machine at another gym must not create (or hide) a PR
    const maxE = new Map<string, number>(), maxW = new Map<string, number>(), seenGym = new Set<string>();
    for (const s of list) {
      const first = !seenGym.has(s.gym);
      seenGym.add(s.gym);
      if (s.e1rm != null) { if (!first && s.e1rm > (maxE.get(s.gym) ?? -Infinity)) s.isPR = true; maxE.set(s.gym, Math.max(maxE.get(s.gym) ?? -Infinity, s.e1rm)); }
      if (s.weight != null) { if (!first && s.weight > (maxW.get(s.gym) ?? -Infinity)) s.isWeightPR = true; maxW.set(s.gym, Math.max(maxW.get(s.gym) ?? -Infinity, s.weight)); }
    }
  }
  return out;
}

/** The gym you use most for this exercise — other gyms are converted to it. */
export function mainGym(list: SessionBest[], preferred?: string): string {
  const n = new Map<string, number>();
  for (const s of list) n.set(s.gym, (n.get(s.gym) ?? 0) + 1);
  const ranked = [...n].sort((a, b) => b[1] - a[1] || (a[0] === preferred ? -1 : b[0] === preferred ? 1 : 0));
  return ranked[0]?.[0] ?? preferred ?? '';
}

export interface GymFactor {
  exercise: string; gym: string; mainGym: string;
  /** multiply this gym's weight by factor to get the main-gym equivalent */
  factor: number | null;
  pairs: number;
  source: 'auto' | 'yours' | 'off' | 'none';
  detail: string;
}

/**
 * Conversion between gyms, learned from your own all-out sets: for every session at the other gym,
 * the closest main-gym session within `windowDays` is paired (both assumed RPE 8–10 unless an RPE
 * under 8 was written). factor = median(main-gym est. 1RM ÷ other-gym est. 1RM).
 */
export function gymFactors(byEx: Map<string, SessionBest[]>, overrides: Record<string, number | null> = {}, preferredGym?: string, windowDays = 14): Map<string, GymFactor> {
  const out = new Map<string, GymFactor>();
  for (const [ex, list] of byEx) {
    const gyms = [...new Set(list.map(s => s.gym))];
    if (gyms.length < 2) continue;
    const main = mainGym(list, preferredGym);
    const allOut = (s: SessionBest) => s.e1rm != null && (s.rpe == null || s.rpe >= 8);
    const mainS = list.filter(s => s.gym === main && allOut(s));
    for (const g of gyms) {
      if (g === main) continue;
      const key = stationKey(ex, g);
      if (key in overrides) {
        const v = overrides[key];
        out.set(key, { exercise: ex, gym: g, mainGym: main, factor: v ?? null, pairs: 0, source: v == null ? 'off' : 'yours', detail: v == null ? 'you turned conversion off' : `your factor ×${v}` });
        continue;
      }
      const ratios: number[] = [];
      for (const s of list.filter(x => x.gym === g && allOut(x))) {
        const near = mainS.map(m => ({ m, d: Math.abs(toDay(m.date) - toDay(s.date)) })).filter(x => x.d <= windowDays).sort((a, b) => a.d - b.d)[0];
        if (near) ratios.push(near.m.e1rm! / s.e1rm!);
      }
      if (!ratios.length) {
        out.set(key, { exercise: ex, gym: g, mainGym: main, factor: null, pairs: 0, source: 'none', detail: `needs a ${main} session within ${windowDays} days of a ${g} session` });
        continue;
      }
      const sorted = [...ratios].sort((a, b) => a - b);
      const f = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
      const heavier = f > 1 ? `${g}'s machine is ~${Math.round((f - 1) * 100)}% heavier` : f < 1 ? `${g}'s machine is ~${Math.round((1 - f) * 100)}% lighter` : 'same feel';
      out.set(key, { exercise: ex, gym: g, mainGym: main, factor: f, pairs: ratios.length, source: 'auto', detail: `${heavier} (from ${ratios.length} pair${ratios.length > 1 ? 's' : ''} of all-out sets)` });
    }
  }
  return out;
}

/** Sessions on one scale: main-gym est. 1RM (other gyms converted when a factor exists, else left out). */
export function unifiedSessions(list: SessionBest[], factors: Map<string, GymFactor>, preferredGym?: string): (SessionBest & { e1rmMain: number; converted: boolean; factor?: number })[] {
  const main = mainGym(list, preferredGym);
  const out: (SessionBest & { e1rmMain: number; converted: boolean; factor?: number })[] = [];
  for (const s of list) {
    if (s.e1rm == null) continue;
    if (s.gym === main) { out.push({ ...s, e1rmMain: s.e1rm, converted: false }); continue; }
    const f = factors.get(stationKey(s.exercise, s.gym))?.factor;
    if (f != null) out.push({ ...s, e1rmMain: s.e1rm * f, converted: true, factor: f });
  }
  return out;
}

export interface ExerciseProgress { exercise: string; baseline: SessionBest | null; latest: SessionBest | null; pct: number | null; sessions: SessionBest[] }

/**
 * % change for each session of ONE exercise at ONE gym, chained across setup changes:
 * on a session where a note says the setup changed (grip, straps, seat position, form…), that
 * session becomes the new baseline and carries over the progress made so far — a lighter
 * weight right after a change isn't counted as getting weaker.
 */
export function chainedPct(list: SessionBest[], changes?: Set<string> | string[]): number[] {
  const ch = changes instanceof Set ? changes : new Set(changes ?? []);
  let cum = 1, base = list[0]?.e1rm ?? 1;
  return list.map((s, i) => {
    if (i > 0 && ch.has(s.date) && s.e1rm != null && list[i - 1].e1rm != null) {
      cum *= list[i - 1].e1rm! / base;
      base = s.e1rm;
    }
    return cum * (s.e1rm! / base) - 1;
  });
}

export function exerciseProgress(sessions: SessionBest[], rangeStart: string | null, rangeEnd?: string, changes?: string[]): ExerciseProgress {
  const inRange = sessions.filter(s => (!rangeStart || s.date >= rangeStart) && (!rangeEnd || s.date <= rangeEnd) && s.e1rm != null);
  const baseline = inRange[0] ?? null, latest = inRange[inRange.length - 1] ?? null;
  const pct = baseline && latest && baseline !== latest ? chainedPct(inRange, changes).at(-1)! : baseline ? 0 : null;
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
  changes: Record<string, string[]> = {},
): { series: Record<Muscle | 'Overall', ScoreSeries>; current: Record<Muscle | 'Overall', number | null>; contributors: Record<Muscle, { exercise: string; gym: string; weight: number; pct: number | null }[]> } {
  // each gym is its own station: a vacation machine is compared only to itself
  const progress = new Map<string, SessionBest[]>();
  for (const [, list] of byEx) {
    for (const s of list) {
      if (s.e1rm == null || (rangeStart && s.date < rangeStart) || (rangeEnd && s.date > rangeEnd)) continue;
      const k = stationKey(s.exercise, s.gym);
      progress.set(k, [...(progress.get(k) ?? []), s]);
    }
  }
  const exOf = (k: string) => k.slice(0, k.lastIndexOf('|'));
  const dates = [...new Set([...progress.values()].flat().map(s => s.date))].sort();
  const series = Object.fromEntries([...MUSCLES, 'Overall'].map(m => [m, [] as ScoreSeries])) as Record<Muscle | 'Overall', ScoreSeries>;
  const firstDate = dates[0];
  const chains = new Map<SessionBest[], number[]>();
  for (const [st, list] of progress) chains.set(list, chainedPct(list, changes[st]));
  const pctAt = (list: SessionBest[], date: string): number | null => {
    let i = -1;
    while (i + 1 < list.length && list[i + 1].date <= date) i++;
    if (i < 0) return null;
    // a lift (or a new gym) that joins later only counts once it has something to compare with,
    // so starting at a vacation gym doesn't drag the score toward 0%
    if (i === 0 && list[0].date !== firstDate) return null;
    return chains.get(list)![i];
  };
  for (const date of dates) {
    let oNum = 0, oDen = 0;
    for (const m of MUSCLES) {
      let num = 0, den = 0;
      for (const [st, list] of progress) {
        const info = exercises[exOf(st)];
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
  const contributors = Object.fromEntries(MUSCLES.map(m => [m, [] as any[]])) as Record<Muscle, { exercise: string; gym: string; weight: number; pct: number | null }[]>;
  for (const [st, list] of progress) {
    const info = exercises[exOf(st)];
    if (!info) continue;
    for (const m of MUSCLES) {
      const w = weightsFor(info, m);
      if (w) contributors[m].push({ exercise: exOf(st), gym: list[0].gym, weight: w, pct: list.length > 1 ? chains.get(list)!.at(-1)! : 0 });
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

export interface PR { gym?: string; date: string; exercise: string; kind: 'e1RM' | 'weight' | 'longest' | 'fastest' | 'heaviest' | 'load×time' | 'load×distance'; value: string; detail: string }

export function strengthPRs(byEx: Map<string, SessionBest[]>): PR[] {
  const out: PR[] = [];
  for (const [ex, list] of byEx) {
    for (const s of list) {
      if (s.isPR) out.push({ date: s.date, exercise: ex, gym: s.gym, kind: 'e1RM', value: `${s.e1rm!.toFixed(1)} lb`, detail: `${s.weight} × ${s.reps}` });
      else if (s.isWeightPR) out.push({ date: s.date, exercise: ex, gym: s.gym, kind: 'weight', value: `${s.weight} lb`, detail: `${s.weight} × ${s.reps}` });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ------------------------------------------------------------- relative strength

/** 7-day average bodyweight on (or up to 7 days before) a date. */
export function bodyweightOn(ma: MAPoint[], iso: string): number | null {
  const d = toDay(iso);
  for (let i = ma.length - 1; i >= 0; i--) {
    const pd = toDay(ma[i].date);
    if (pd <= d) return d - pd <= 7 ? ma[i].ma : null;
  }
  return null;
}

/** est. 1RM ÷ 7-day average bodyweight, per session (main-gym scale). */
export function relativeSeries(list: SessionBest[], factors: Map<string, GymFactor>, ma: MAPoint[], preferredGym?: string) {
  return unifiedSessions(list, factors, preferredGym)
    .map(s => ({ date: s.date, ratio: (() => { const bw = bodyweightOn(ma, s.date); return bw ? s.e1rmMain / bw : null; })(), bw: bodyweightOn(ma, s.date), e1rm: s.e1rmMain, converted: s.converted, gym: s.gym, set: `${s.weight} × ${s.reps}` }))
    .filter((x): x is typeof x & { ratio: number; bw: number } => x.ratio != null);
}

// ------------------------------------------------------------- plateau + progression

export interface Plateau { exercise: string; gym: string; sessions: number; best: number; bestDate: string; lastDate: string }

/**
 * No new best est. 1RM in the last `n` sessions at that gym (within 0.5%), and you're still doing it
 * (last session within 4 weeks of `today`).
 */
export function findPlateaus(byEx: Map<string, SessionBest[]>, today: string, n = 3, changes: Record<string, string[]> = {}): Plateau[] {
  const out: Plateau[] = [];
  for (const [ex, list] of byEx) {
    const gyms = new Set(list.map(s => s.gym));
    for (const g of gyms) {
      // only sessions since the last setup change count — a new grip/position is a fresh start
      const lastChange = (changes[stationKey(ex, g)] ?? []).at(-1);
      const st = list.filter(s => s.gym === g && s.e1rm != null && (!lastChange || s.date >= lastChange));
      if (st.length < n + 1) continue;
      const last = st[st.length - 1];
      if (toDay(today) - toDay(last.date) > 28) continue;
      let bestI = 0;
      st.forEach((s, i) => { if (s.e1rm! > st[bestI].e1rm! * 1.005) bestI = i; });
      const since = st.length - 1 - bestI;
      if (since >= n) out.push({ exercise: ex, gym: g, sessions: since, best: st[bestI].e1rm!, bestDate: st[bestI].date, lastDate: last.date });
    }
  }
  return out.sort((a, b) => b.sessions - a.sessions);
}

/** Rep range from a prescription like "1x8-10" / "3 x 12-15" (null if none). */
export function repRange(prescription?: string): { lo: number; hi: number } | null {
  const m = (prescription ?? '').match(/x\s*(\d+)\s*-\s*(\d+)/i);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  const one = (prescription ?? '').match(/x\s*(\d+)\s*$/i);
  return one ? { lo: Number(one[1]), hi: Number(one[1]) } : null;
}

/** Fewest whole reps at `weight` that beat est. 1RM `e1rm`. */
export const repsToBeat = (weight: number, e1rm: number) => Math.max(1, Math.floor(30 * (e1rm / weight - 1) + 1e-9) + 1);

export interface Target {
  weight: number; reps: number;
  /** what to aim for today, e.g. "230 × 8+" */
  text: string;
  why: string;
  /** est. 1RM to beat for a PR, and one set that does it */
  beat: number;
  prText: string;
}

/**
 * Double progression: work up to the top of the rep range, then add weight and drop to the bottom.
 * Always also states the est. 1RM to beat (a PR) and a set at last time's weight that beats it.
 */
export function nextTarget(last: SessionBest, prescription?: string): Target | null {
  if (last.weight == null || last.e1rm == null) return null;
  const w = last.weight, r = Math.floor(last.reps);
  const step = w >= 40 ? 5 : 2.5;
  const prText = `${w} × ${repsToBeat(w, last.e1rm)}`;
  const parsed = repRange(prescription);
  if (!parsed) {
    // no rep range written for this exercise: just beat last time, with a heavier option
    const need = repsToBeat(w, last.e1rm), heavier = repsToBeat(w + step, last.e1rm);
    return { weight: w, reps: need, text: `${w} × ${need}`, why: `a PR — beats last time · or ${w + step} × ${heavier}`, beat: last.e1rm, prText };
  }
  const range = parsed;
  if (r >= range.hi) {
    const nw = w + step;
    return { weight: nw, reps: range.lo, text: `${nw} × ${range.lo}+`, why: `you hit ${last.reps} (top of ${range.lo}–${range.hi}) — add ${step} lb`, beat: last.e1rm, prText };
  }
  const need = repsToBeat(w, last.e1rm);
  return { weight: w, reps: need, text: `${w} × ${need}`, why: r < range.lo ? `below ${range.lo} reps last time — same weight, one more rep` : `in range (${range.lo}–${range.hi}) — same weight, one more rep`, beat: last.e1rm, prText };
}

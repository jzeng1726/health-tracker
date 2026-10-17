/**
 * Gym prep: what's on today's program and the number to beat for each exercise,
 * judged against the last session AT THE GYM YOU'RE GOING TO.
 */
import type { Dataset, Program, ProgramBlock, ProgramItem } from './model';
import { sessionsByExercise, gymFactors, nextTarget, mainGym, findPlateaus, stationKey, type SessionBest, type Target, type GymFactor, type Plateau } from './strength';
import { enduranceSessions, type EnduranceSession } from './endurance';
import { formatDuration } from './time';

export const isCoreBlock = (b: ProgramBlock) => /core|endurance|cardio|abs/i.test(b.dayLabel);

/** The program you're on now: the one with the most recent logged session (a brand-new, newer sheet wins). */
export function currentProgram(programs: Program[]): Program | null {
  const score = (p: Program) => {
    const last = p.blocks.map(b => b.date).filter(Boolean).sort().at(-1);
    return last ?? p.modifiedTime.slice(0, 10);
  };
  return [...programs].sort((a, b) => score(b).localeCompare(score(a)) || b.modifiedTime.localeCompare(a.modifiedTime))[0] ?? null;
}

/** Week numbers from a name like "Weeks 5,6,7" or "Week 01". */
export function weeksFromName(name: string): number[] {
  const m = name.match(/weeks?\s*([\d][\d,\s&and-]*)/i);
  if (!m) return [];
  return m[1].split(/[^\d]+/).filter(Boolean).map(Number);
}

export interface DayOption { label: string; block: ProgramBlock; week: number | null; isNext: boolean }

/** For each day type (A day, B day, core day): the next block of that type that hasn't been logged yet. */
export function dayOptions(p: Program): DayOption[] {
  const strengthRows = [...new Set(p.blocks.filter(b => !isCoreBlock(b)).map(b => b.headerRow))].sort((a, b) => a - b);
  const weeks = weeksFromName(p.fileName);
  const weekOf = (b: ProgramBlock) => {
    let i = strengthRows.filter(r => r <= b.headerRow).length - 1;
    if (i < 0) i = 0;
    return weeks.length === strengthRows.length ? weeks[i] : weeks.length ? weeks[0] + i : null;
  };
  const ordered = [...p.blocks].sort((a, b) => a.headerRow - b.headerRow || a.exCol - b.exCol);
  const lastLoggedIdx = ordered.reduce((m, b, i) => (b.logged > 0 && !isCoreBlock(b) ? i : m), -1);
  const after = ordered.slice(lastLoggedIdx + 1);
  const labels = [...new Set(ordered.map(b => b.dayLabel))];
  const out: DayOption[] = [];
  const nextStrength = after.find(b => !isCoreBlock(b) && b.logged === 0);
  for (const label of labels) {
    const pool = ordered.filter(b => b.dayLabel === label);
    const block = after.find(b => b.dayLabel === label && b.logged === 0) ?? pool.find(b => b.logged === 0) ?? pool.at(-1)!;
    out.push({ label, block, week: weekOf(block), isNext: block === nextStrength });
  }
  return out.sort((a, b) => Number(b.isNext) - Number(a.isNext) || a.label.localeCompare(b.label));
}

export interface PrepRow {
  item: ProgramItem;
  kind: 'strength' | 'endurance';
  last: SessionBest | null;          // last session at this gym
  lastElsewhere: SessionBest | null; // when there's none here
  estimateHere: { weight: number; factor: number; from: SessionBest } | null;
  target: Target | null;
  plateau: Plateau | null;
  endurance: EnduranceSession | null;
  enduranceText: string | null;
}

const round = (w: number) => Math.round(w / 2.5) * 2.5;

export function prepRows(items: ProgramItem[], ds: Dataset, gym: string, opts: { today: string; factorOverrides?: Record<string, number | null>; defaultGym?: string; perHand: boolean }): PrepRow[] {
  const byEx = sessionsByExercise(ds.sets);
  const factors = gymFactors(byEx, opts.factorOverrides, opts.defaultGym);
  const plateaus = findPlateaus(byEx, opts.today, 3, ds.changes);
  const endS = enduranceSessions(ds.endurance, opts.perHand);
  return items.map(item => {
    const info = ds.exercises[item.exercise];
    const kind = info && info.kind !== 'strength' ? 'endurance' : 'strength';
    if (kind === 'endurance') {
      const e = endS.filter(x => x.exercise === item.exercise).at(-1) ?? null;
      return { item, kind, last: null, lastElsewhere: null, estimateHere: null, target: null, plateau: null, endurance: e, enduranceText: e ? describeEndurance(e) : null };
    }
    const list = byEx.get(item.exercise) ?? [];
    const here = list.filter(s => s.gym === gym && s.e1rm != null);
    const last = here.at(-1) ?? null;
    let lastElsewhere: SessionBest | null = null;
    let estimateHere: PrepRow['estimateHere'] = null;
    if (!last) {
      lastElsewhere = list.filter(s => s.e1rm != null).at(-1) ?? null;
      if (lastElsewhere?.weight != null) {
        const main = mainGym(list, opts.defaultGym);
        const f = conversion(factors, item.exercise, lastElsewhere.gym, gym, main);
        if (f != null) estimateHere = { weight: round(lastElsewhere.weight * f), factor: f, from: lastElsewhere };
      }
    }
    return {
      item, kind, last, lastElsewhere, estimateHere,
      target: last ? nextTarget(last, item.prescription) : null,
      plateau: plateaus.find(p => p.exercise === item.exercise && p.gym === gym) ?? null,
      endurance: null, enduranceText: null,
    };
  });
}

/** factor that turns a weight at gym `from` into gym `to` (through the main gym). */
function conversion(factors: Map<string, GymFactor>, ex: string, from: string, to: string, main: string): number | null {
  const toMain = (g: string) => (g === main ? 1 : factors.get(stationKey(ex, g))?.factor ?? null);
  const a = toMain(from), b = toMain(to);
  return a != null && b != null ? a / b : null;
}

function describeEndurance(e: EnduranceSession): string {
  const bits: string[] = [];
  if (e.weight != null) bits.push(`${e.weight} lb`);
  if (e.longestSeconds != null) bits.push(`best ${formatDuration(e.longestSeconds)}`);
  if (e.distanceM != null && e.type === 'run') bits.push(`${(e.distanceM / 1609.344).toFixed(2)} mi`);
  if (e.steps != null) bits.push(`${e.steps} steps`);
  if (e.rounds > 1) bits.push(`${e.rounds} rounds`);
  return bits.join(' · ') || e.raws.join(' / ');
}

/** No coach program for this gym? Repeat the last session you did there. */
export function lastSessionItems(ds: Dataset, gym: string): { date: string; items: ProgramItem[] } | null {
  const days = [...new Set([...ds.sets, ...ds.endurance].filter(s => s.gym === gym).map(s => s.date))].sort();
  const d = days.at(-1);
  if (!d) return null;
  const names = [...new Set([...ds.sets, ...ds.endurance].filter(s => s.gym === gym && s.date === d).map(s => s.exercise))];
  return { date: d, items: names.map(n => ({ exercise: n, display: ds.exercises[n]?.display ?? n, prescription: '', notes: [], result: '' })) };
}

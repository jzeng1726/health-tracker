/**
 * Bodyweight metrics. The 7-DAY MOVING AVERAGE is the primary metric: every
 * stat (current, lost, % lost, weekly rate, projection) is computed from it.
 * MA(d) = mean of weigh-ins dated d-6 … d. During the first 6 days of a sheet the
 * window has fewer days — that point is labelled "partial average".
 */
import type { BodyweightEntry } from './model';

export interface MAPoint {
  date: string;
  raw: number;
  ma: number;
  partial: boolean;
  /** weigh-ins inside the 7-day window */
  n: number;
}

const DAY = 86400000;
export const toDay = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
export const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

export function movingAverage(entries: BodyweightEntry[]): MAPoint[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const firstByFile = new Map<string, number>();
  for (const e of sorted) if (!firstByFile.has(e.fileId)) firstByFile.set(e.fileId, toDay(e.date));
  return sorted.map(e => {
    const d = toDay(e.date);
    const win = sorted.filter(x => { const xd = toDay(x.date); return xd <= d && xd >= d - 6; });
    const ma = win.reduce((s, x) => s + x.weight, 0) / win.length;
    const partial = d - (firstByFile.get(e.fileId) ?? d) < 6;
    return { date: e.date, raw: e.weight, ma, partial, n: win.length };
  });
}

export interface BodyweightStats {
  current: number | null;
  currentPartial: boolean;
  start: number | null;
  startDate: string | null;
  totalLost: number | null;
  pctLost: number | null;
  /** lb per week, positive = losing */
  weeklyRate: number | null;
  weeklyRatePct: number | null;
  goal?: number;
  projectedDate: string | null;
  projectionNote: string;
  lastDate: string | null;
}

/** Linear-regression slope (lb/day) of the MA over the last `days` days. */
export function maSlope(points: MAPoint[], days = 21): number | null {
  if (!points.length) return null;
  const end = toDay(points[points.length - 1].date);
  const pts = points.filter(p => toDay(p.date) > end - days);
  if (pts.length < 5) return null;
  const xs = pts.map(p => toDay(p.date)), ys = pts.map(p => p.ma);
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den ? num / den : null;
}

/** MA value on or before `day` (nearest earlier weigh-in, max 3 days back). */
function maAtOrBefore(points: MAPoint[], day: number): MAPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const d = toDay(points[i].date);
    if (d <= day) return day - d <= 3 ? points[i] : null;
  }
  return null;
}

export function bodyweightStats(all: MAPoint[], rangeStart: string | null, goal?: number): BodyweightStats {
  const pts = rangeStart ? all.filter(p => p.date >= rangeStart) : all;
  const empty: BodyweightStats = {
    current: null, currentPartial: false, start: null, startDate: null, totalLost: null, pctLost: null,
    weeklyRate: null, weeklyRatePct: null, goal, projectedDate: null, projectionNote: 'No weigh-ins yet', lastDate: null,
  };
  if (!pts.length) return empty;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const weekAgo = maAtOrBefore(all, toDay(last.date) - 7);
  const weeklyRate = weekAgo ? weekAgo.ma - last.ma : null;
  let projectedDate: string | null = null;
  let projectionNote = '';
  const slope = maSlope(all);
  if (goal == null) projectionNote = 'Set a goal weight in Settings';
  else if (last.ma <= goal) projectionNote = 'Goal reached';
  else if (slope == null) projectionNote = 'Need ~5 weigh-ins in the last 3 weeks';
  else if (slope >= 0) projectionNote = '7-day average is not trending down';
  else {
    const days = (last.ma - goal) / -slope;
    projectedDate = new Date((toDay(last.date) + Math.ceil(days)) * DAY).toISOString().slice(0, 10);
    projectionNote = `At the last 3 weeks' trend (${(-slope * 7).toFixed(2)} lb/week)`;
  }
  return {
    current: last.ma, currentPartial: last.partial, start: first.ma, startDate: first.date,
    totalLost: first.ma - last.ma, pctLost: (first.ma - last.ma) / first.ma,
    weeklyRate, weeklyRatePct: weekAgo && weeklyRate != null ? weeklyRate / weekAgo.ma : null,
    goal, projectedDate, projectionNote, lastDate: last.date,
  };
}

export interface WeekRow { weekStart: string; weekEnd: string; avg: number; n: number; change: number | null }

/** Monday–Sunday weekly averages of the daily weigh-ins. */
export function weeklyAverages(entries: BodyweightEntry[]): WeekRow[] {
  const byWeek = new Map<number, number[]>();
  for (const e of entries) {
    const d = toDay(e.date);
    const dow = (new Date(d * DAY).getUTCDay() + 6) % 7; // Mon=0
    const monday = d - dow;
    byWeek.set(monday, [...(byWeek.get(monday) ?? []), e.weight]);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0] - b[0]);
  let prev: number | null = null;
  return weeks.map(([monday, ws]) => {
    const avg = ws.reduce((a, b) => a + b, 0) / ws.length;
    const row: WeekRow = { weekStart: fromDay(monday), weekEnd: fromDay(monday + 6), avg, n: ws.length, change: prev == null ? null : avg - prev };
    prev = avg;
    return row;
  });
}

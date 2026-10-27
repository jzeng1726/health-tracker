/**
 * Classify a sheet tab by its HEADERS and CONTENTS — never by its name.
 *   program-grid : coach layout ("SETS / REPS" + result column)
 *   bodyweight   : Date + (Morning/Body) Weight, no Exercise column
 *   workout-log  : Date + Exercise + load/sets/reps and/or time/distance
 *   derived      : mostly formula output (e.g. ChartData) — skipped to avoid double counting
 *   unknown      : has data but no recognisable header -> "Needs review" column mapper
 */
import type { SheetCell } from './time';
import type { SheetTab, TabKind } from './model';
import type { ColumnMapping, ColumnRole } from './config';
import { cellText, cellDate, isProgramGrid } from './grid';

export interface Classification {
  kind: TabKind;
  reason: string;
  mapping?: ColumnMapping;
}

const IGNORE_RX = /(lost|goal|change|delta|diff|avg|average|trend|%|^week)/i;

export function headerRole(text: string, rowHasExercise: boolean): { role: ColumnRole; unit?: string } | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/sets?\s*[x×\/]\s*reps?/.test(t)) return { role: 'setsxreps' };
  if (/^(muscle|muscles|muscle group|muscle groups|body ?part|target( muscle)?|group)\b/.test(t)) return { role: 'muscle' };
  if (/^(gym|location|place|where|facility)\b/.test(t)) return { role: 'gym' };
  if (/^(until|end date|end|through|thru|to date)\b/.test(t)) return { role: 'until' };
  if (/^(life note|life|event|what happened)\b/.test(t)) return { role: 'notes' };
  if (/^(rpe|rir|effort|intensity|reps in reserve)\b/.test(t)) return { role: 'rpe', unit: /rir|reserve/.test(t) ? 'rir' : 'rpe' };
  if (IGNORE_RX.test(t) && !/^date/.test(t)) return { role: 'ignore' };
  if (/^(date|day|when)\b/.test(t)) return { role: 'date' };
  if (/^(exercise|movement|lift|activity|workout|exercise name)\b/.test(t)) return { role: 'exercise' };
  if (/^sets?$|^# ?sets$|^number of sets$/.test(t)) return { role: 'sets' };
  if (/^reps?$|^# ?reps$|^repetitions$/.test(t)) return { role: 'reps' };
  if (/(body ?weight|morning weight|\bbw\b|weigh[- ]?in|scale)/.test(t)) return { role: 'bodyweight' };
  if (/^(weight|load|lbs?|kg)\b/.test(t)) return { role: rowHasExercise ? 'weight' : 'bodyweight' };
  if (/(time|duration|\bsec|seconds|\bmins?\b|minutes|hold|hours?|\bhrs?\b)/.test(t)) {
    const unit = /\bsec|seconds/.test(t) ? 'seconds' : /\bmins?\b|minutes/.test(t) ? 'minutes' : /hours?|\bhrs?\b/.test(t) ? 'hours' : undefined;
    return { role: 'time', unit };
  }
  if (/(distance|miles?|\bmi\b|\bkm\b|kilomet|met(er|re)s?|\byards?\b|\byds?\b|feet|\bft\b|steps)/.test(t)) {
    const unit = /miles?|\bmi\b/.test(t) ? 'mi' : /\bkm\b|kilomet/.test(t) ? 'km' : /met(er|re)s?|\bm\b/.test(t) ? 'm'
      : /yards?|yds?/.test(t) ? 'yd' : /feet|\bft\b/.test(t) ? 'ft' : /steps/.test(t) ? 'steps' : undefined;
    return { role: 'distance', unit };
  }
  if (/(note|comment)/.test(t)) return { role: 'notes' };
  return null;
}

export function detectHeaderRow(rows: SheetCell[][], from = 0, limit = 60): ColumnMapping | null {
  for (let r = from; r < Math.min(rows.length, from + limit); r++) {
    const m = headerMappingForRow(rows[r] ?? []);
    if (m) return { ...m, headerRow: r };
  }
  return null;
}

export function headerMappingForRow(row: SheetCell[]): Omit<ColumnMapping, 'headerRow'> | null {
  const texts = row.map(c => cellText(c));
  const hasExercise = texts.some(t => /^(exercise|movement|lift|activity|workout)\b/i.test(t.trim()));
  const columns: Partial<Record<ColumnRole, number>> = {};
  let timeUnit: ColumnMapping['timeUnit'];
  let distanceUnit: ColumnMapping['distanceUnit'];
  let rpeUnit: ColumnMapping['rpeUnit'];
  let found = 0;
  texts.forEach((t, c) => {
    const role = headerRole(t, hasExercise);
    if (!role || role.role === 'ignore') return;
    if (columns[role.role] == null) {
      columns[role.role] = c;
      found++;
      if (role.role === 'time' && role.unit) timeUnit = role.unit as any;
      if (role.role === 'distance' && role.unit) distanceUnit = role.unit as any;
      if (role.role === 'rpe' && role.unit) rpeUnit = role.unit as any;
    }
  });
  if (found < 2) return null;
  // "Date | Until | Note" (Life Log) has only date + notes roles that count
  if (columns.exercise != null && columns.date != null) return { type: 'workout', columns, timeUnit, distanceUnit, ...(rpeUnit ? { rpeUnit } : {}) };
  if (columns.exercise == null && columns.date != null && columns.bodyweight != null) return { type: 'bodyweight', columns };
  if (columns.exercise == null && columns.date != null && columns.notes != null && columns.bodyweight == null && columns.weight == null) return { type: 'life', columns };
  return null;
}

function formulaShare(rows: SheetCell[][], fromRow: number): number {
  let total = 0, fx = 0;
  for (let r = fromRow; r < rows.length; r++)
    for (const c of rows[r] ?? []) {
      if (!cellText(c)) continue;
      total++;
      if (c.fx) fx++;
    }
  return total ? fx / total : 0;
}

export function classifyTab(tab: SheetTab, fileName: string, override?: ColumnMapping): Classification {
  if (/^_config\b/i.test(fileName.trim())) return { kind: 'config', reason: 'app settings file' };
  if (override) {
    if (override.type === 'ignore') return { kind: 'empty', reason: 'ignored by you' };
    return { kind: override.type === 'bodyweight' ? 'bodyweight' : override.type === 'life' ? 'life-log' : 'workout-log', reason: 'your column mapping', mapping: override };
  }
  const nonEmpty = tab.rows.some(r => r.some(c => cellText(c)));
  if (!nonEmpty) return { kind: 'empty', reason: 'no data' };
  if (isProgramGrid(tab.rows)) return { kind: 'program-grid', reason: 'found "SETS / REPS" program layout' };
  const mapping = detectHeaderRow(tab.rows);
  if (mapping) {
    if (formulaShare(tab.rows, mapping.headerRow + 1) > 0.5) {
      return { kind: 'derived', reason: 'values are formula output copied from another tab — skipped so nothing is counted twice' };
    }
    return {
      kind: mapping.type === 'bodyweight' ? 'bodyweight' : mapping.type === 'life' ? 'life-log' : 'workout-log',
      reason: `headers on row ${mapping.headerRow + 1}: ${Object.entries(mapping.columns).map(([k, v]) => `${k}=${cellText(tab.rows[mapping.headerRow][v!])}`).join(', ')}`,
      mapping,
    };
  }
  const list = detectExerciseList(tab.rows);
  if (list) {
    return { kind: 'exercise-list', reason: `exercise library — ${list.groups.length} muscle-group columns on row ${list.headerRow + 1}; used to tag exercises with their muscle group, nothing is logged from it` };
  }
  return { kind: 'unknown', reason: 'no recognisable header row — map its columns in Review' };
}

// ------------------------------------------------------------------ exercise library tabs

/** Words that can make up a muscle-group column heading ("Glutes / Hips", "Rear Delts", "Upper Back"). */
const MUSCLE_WORDS = new Set([
  'chest', 'pec', 'pecs', 'back', 'lat', 'lats', 'trap', 'traps', 'shoulder', 'shoulders', 'delt', 'delts',
  'bicep', 'biceps', 'tricep', 'triceps', 'arm', 'arms', 'forearm', 'forearms', 'quad', 'quads', 'hamstring', 'hamstrings',
  'glute', 'glutes', 'hip', 'hips', 'calf', 'calves', 'leg', 'legs', 'core', 'ab', 'abs', 'oblique', 'obliques',
  'upper', 'lower', 'rear', 'front', 'side', 'mid', 'middle', 'and',
]);
const MUSCLE_CORE = new Set([...MUSCLE_WORDS].filter(w => !['upper', 'lower', 'rear', 'front', 'side', 'mid', 'middle', 'and'].includes(w)));

export function isMuscleHeading(text: string): boolean {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.length <= 4 && words.every(w => MUSCLE_WORDS.has(w)) && words.some(w => MUSCLE_CORE.has(w));
}

export interface ExerciseList {
  headerRow: number;
  groups: { col: number; label: string }[];
  /** exercise name -> the muscle-group heading it sits under */
  entries: { exercise: string; group: string; row: number; col: number }[];
}

/**
 * An exercise library: a row of muscle-group headings (Chest | Back | Shoulders | …) with exercise
 * names listed underneath, no dates and no numbers. Often the source of a Log tab's dropdown.
 */
export function detectExerciseList(rows: SheetCell[][], limit = 40): ExerciseList | null {
  for (let r = 0; r < Math.min(rows.length, limit); r++) {
    const cells = (rows[r] ?? []).map(c => cellText(c).trim());
    const filled = cells.filter(Boolean);
    const groups = cells.map((label, col) => ({ col, label })).filter(g => g.label && isMuscleHeading(g.label));
    if (groups.length < 3 || groups.length < filled.length * 0.6) continue;
    const entries: ExerciseList['entries'] = [];
    let dated = 0, numeric = 0;
    for (let rr = r + 1; rr < rows.length; rr++) {
      const row = rows[rr] ?? [];
      if (row.some(c => cellDate(c, 2026))) dated++;
      for (const g of groups) {
        const c = row[g.col];
        const t = cellText(c).trim();
        if (!t) continue;
        if (typeof c?.n === 'number' || /^-?\d+(\.\d+)?$/.test(t)) { numeric++; continue; }
        if (isMuscleHeading(t)) continue;
        entries.push({ exercise: t, group: g.label, row: rr, col: g.col });
      }
    }
    if (entries.length >= 3 && dated === 0 && numeric <= entries.length * 0.1) return { headerRow: r, groups, entries };
  }
  return null;
}

/** Read a numeric value from a cell (number, or text like "160.2" / "160.2 lb"). */
export function cellNumber(c?: SheetCell): number | null {
  if (!c) return null;
  if (typeof c.n === 'number' && c.t !== 'DATE' && c.t !== 'TIME') return c.n;
  const m = cellText(c).match(/^(-?\d+(?:\.\d+)?)\s*(lbs?|kg)?$/i);
  return m ? Number(m[1]) : null;
}

export { cellDate };

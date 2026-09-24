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
  let found = 0;
  texts.forEach((t, c) => {
    const role = headerRole(t, hasExercise);
    if (!role || role.role === 'ignore') return;
    if (columns[role.role] == null) {
      columns[role.role] = c;
      found++;
      if (role.role === 'time' && role.unit) timeUnit = role.unit as any;
      if (role.role === 'distance' && role.unit) distanceUnit = role.unit as any;
    }
  });
  if (found < 2) return null;
  if (columns.exercise != null && columns.date != null) return { type: 'workout', columns, timeUnit, distanceUnit };
  if (columns.exercise == null && columns.date != null && columns.bodyweight != null) return { type: 'bodyweight', columns };
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
    return { kind: override.type === 'bodyweight' ? 'bodyweight' : 'workout-log', reason: 'your column mapping', mapping: override };
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
      kind: mapping.type === 'bodyweight' ? 'bodyweight' : 'workout-log',
      reason: `headers on row ${mapping.headerRow + 1}: ${Object.entries(mapping.columns).map(([k, v]) => `${k}=${cellText(tab.rows[mapping.headerRow][v!])}`).join(', ')}`,
      mapping,
    };
  }
  return { kind: 'unknown', reason: 'no recognisable header row — map its columns in Review' };
}

/** Read a numeric value from a cell (number, or text like "160.2" / "160.2 lb"). */
export function cellNumber(c?: SheetCell): number | null {
  if (!c) return null;
  if (typeof c.n === 'number' && c.t !== 'DATE' && c.t !== 'TIME') return c.n;
  const m = cellText(c).match(/^(-?\d+(?:\.\d+)?)\s*(lbs?|kg)?$/i);
  return m ? Number(m[1]) : null;
}

export { cellDate };

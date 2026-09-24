/**
 * Duration + distance parsing.
 *
 * JEFFREY'S RULE: any two-part time "X:YY" is ALWAYS X minutes YY seconds.
 * Only a three-part "H:MM:SS" is hours:minutes:seconds.
 * Durations are stored internally in whole/decimal SECONDS.
 */

export type HeaderUnit = 'seconds' | 'minutes' | 'hours';

export interface DurationResult {
  seconds: number | null;
  /** true when the value could not be resolved by the rules and needs the user */
  ambiguous: boolean;
  /** best guess (seconds) shown preselected when ambiguous */
  guess?: number;
  reason?: string;
}

const ok = (seconds: number): DurationResult => ({ seconds, ambiguous: false });
const amb = (reason: string, guess?: number): DurationResult => ({ seconds: null, ambiguous: true, guess, reason });

const UNIT_SECONDS: Record<string, number> = {
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
};

/**
 * Parse a duration typed by a human (Quick Entry field, sheet text, or the
 * formatted display value of a sheet cell).
 */
export function parseDuration(input: string, headerUnit?: HeaderUnit): DurationResult {
  if (input == null) return amb('empty');
  let s = String(input).trim().toLowerCase();
  if (!s) return amb('empty');

  // Sheets display of a time-of-day cell may carry AM/PM ("2:00 AM"). The clock
  // meaning is never used — strip it and apply the X:YY rule to the digits.
  const hadMeridiem = /\s*(am|pm)$/.test(s);
  s = s.replace(/\s*(am|pm)$/, '');

  // Colon forms, optionally suffixed with a minute marker ("1:40m", "1:40 min")
  let m = s.match(/^(\d+):(\d{1,2})(?:\.(\d+))?\s*(m|min|mins|minutes?)?$/);
  if (m) {
    const mins = Number(m[1]);
    const secs = Number(`${m[2]}${m[3] ? '.' + m[3] : ''}`);
    if (secs >= 60) return amb(`"${input}": seconds part ${m[2]} is 60 or more`);
    return ok(mins * 60 + secs);
  }
  m = s.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (m) {
    const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(`${m[3]}${m[4] ? '.' + m[4] : ''}`)];
    if (mi >= 60 || se >= 60) return amb(`"${input}": minutes/seconds part is 60 or more`);
    if (hadMeridiem && se === 0) {
      // "1:30:00 AM" = Sheets turned a typed "1:30" into a clock time. Per rule, 1:30 = 1m30s.
      return amb(`"${input}" looks like Sheets converted a typed ${h}:${m[2]} into a clock time`, h * 60 + mi);
    }
    return ok(h * 3600 + mi * 60 + se);
  }

  // Unit forms: "90s", "90 sec", "2 min", "2m30s", "1h 5m", "1 hour 5 minutes"
  const unitRe = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/g;
  const stripped = s.replace(/[,]/g, ' ').replace(/\band\b/g, ' ');
  let total = 0;
  let consumed = '';
  let any = false;
  for (const u of stripped.matchAll(unitRe)) {
    total += Number(u[1]) * UNIT_SECONDS[u[2]];
    consumed += u[0];
    any = true;
  }
  if (any && stripped.replace(/\s+/g, '') === consumed.replace(/\s+/g, '')) return ok(total);

  // "8.26" style (period used instead of colon) with no header unit — plausible m.ss, but not covered by the rules
  const dot = s.match(/^(\d{1,2})\.(\d{2})$/);
  if (dot && !headerUnit && Number(dot[2]) < 60) {
    return amb(`"${input}" uses a period — could be ${dot[1]}:${dot[2]} (min:sec)`, Number(dot[1]) * 60 + Number(dot[2]));
  }

  // Plain number: only valid when the column header supplies the unit
  m = s.match(/^\d+(?:\.\d+)?$/);
  if (m) {
    const n = Number(s);
    if (headerUnit === 'seconds') return ok(n);
    if (headerUnit === 'minutes') return ok(n * 60);
    if (headerUnit === 'hours') return ok(n * 3600);
    return amb(`"${input}" is a bare number with no unit`);
  }

  return amb(`"${input}" is not a recognised time format`);
}

/**
 * Resolve a duration from a Google Sheets cell.
 * Sheets auto-converts a typed "1:30" into a TIME value (01:30:00 = 1.5 hours).
 * Per the rule we trust the FORMATTED display text; when the display is a
 * three-part time with :00 seconds on a TIME-formatted cell, the user most likely
 * typed two parts, so we flag it (best guess = minutes:seconds).
 */
export interface SheetCell {
  /** formattedValue — what the user sees */
  f?: string;
  /** effective numeric value (serial for dates/times) */
  n?: number;
  /** effective string value */
  s?: string;
  /** numberFormat.type from Sheets: DATE | TIME | DATE_TIME | NUMBER | TEXT | ... */
  t?: string;
  /** value produced by a formula (own formula or spilled from an array formula) */
  fx?: boolean;
}

export function parseDurationCell(cell: SheetCell, headerUnit?: HeaderUnit): DurationResult & { source: string } {
  const display = (cell.f ?? cell.s ?? '').trim();
  const isTimeTyped = cell.t === 'TIME' || cell.t === 'DATE_TIME';
  if (isTimeTyped && typeof cell.n === 'number') {
    const serialSeconds = Math.round(cell.n * 86400);
    const r = parseDuration(display, headerUnit);
    if (!r.ambiguous && /^\d+:\d{1,2}(\s*(am|pm))?$/i.test(display)) {
      return { ...r, source: `time value (Sheets stored ${fmtClock(serialSeconds)} = ${serialSeconds} s); read display "${display}" as min:sec` };
    }
    if (r.ambiguous) return { ...r, source: `time value, display "${display}"` };
    // three-part display on a time-typed cell with zero seconds -> possibly a converted "X:YY"
    const three = display.match(/^(\d+):(\d{2}):00$/);
    if (three) {
      return {
        ...amb(`"${display}" — Sheets may have converted a typed ${three[1]}:${three[2]}`, Number(three[1]) * 60 + Number(three[2])),
        source: 'time value',
      };
    }
    return { ...r, source: 'time value' };
  }
  if (typeof cell.n === 'number' && !display) return { ...parseDuration(String(cell.n), headerUnit), source: 'number' };
  return { ...parseDuration(display, headerUnit), source: 'text' };
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Display seconds as m:ss, or h:mm:ss when an hour or more. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- distance

export type DistanceUnit = 'mi' | 'km' | 'm' | 'yd' | 'ft' | 'steps';
export interface DistanceResult {
  value: number | null;
  unit: DistanceUnit | null;
  meters: number | null; // null for steps
  ambiguous: boolean;
  reason?: string;
}

const DIST_UNITS: [RegExp, DistanceUnit, number | null][] = [
  [/^(miles?|mi)$/, 'mi', 1609.344],
  [/^(kilometers?|kilometres?|km|k)$/, 'km', 1000],
  [/^(meters?|metres?|m)$/, 'm', 1],
  [/^(yards?|yds?|yd)$/, 'yd', 0.9144],
  [/^(feet|foot|ft)$/, 'ft', 0.3048],
  [/^(steps?)$/, 'steps', null],
];

export function parseDistance(input: string, headerUnit?: DistanceUnit): DistanceResult {
  const s = String(input ?? '').trim().toLowerCase();
  const none: DistanceResult = { value: null, unit: null, meters: null, ambiguous: true };
  if (!s) return { ...none, reason: 'empty' };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) return { ...none, reason: `"${input}" is not a recognised distance` };
  const value = Number(m[1]);
  const unitText = m[2] || '';
  if (!unitText) {
    if (!headerUnit) return { ...none, reason: `"${input}" has no unit` };
    const row = DIST_UNITS.find(d => d[1] === headerUnit)!;
    return { value, unit: headerUnit, meters: row[2] == null ? null : value * row[2], ambiguous: false };
  }
  const row = DIST_UNITS.find(d => d[0].test(unitText));
  if (!row) return { ...none, reason: `unknown unit "${unitText}"` };
  return { value, unit: row[1], meters: row[2] == null ? null : value * row[2], ambiguous: false };
}

export const metersTo = (meters: number, unit: Exclude<DistanceUnit, 'steps'>): number =>
  meters / ({ mi: 1609.344, km: 1000, m: 1, yd: 0.9144, ft: 0.3048 } as const)[unit];

/**
 * Parse a workout result cell such as:
 *   "210x10.5"  "L-40x20 R-40x20"  "50 Lx20 Rx20"  "150x15,10,8"  "55x12-13"
 *   "R1-45x8 R2-45x8"  "R1-70x1:40m R2-70x1:00m"  "R1. 80x1:33  R2. 80x1:44"
 *   "140x6.5-7 (no straps and different form)"  "45x10 each"  "Skipped-pain on warmup"
 * Rep ranges use the LOWER number (Jeffrey's decision, 2026-09-24).
 */
import { parseDuration } from './time';

export interface ParsedSet {
  weight: number | null;       // lb; null = bodyweight / not given
  reps: number | null;
  seconds: number | null;      // for timed sets
  side?: 'L' | 'R';
  round?: number;
  perSide?: boolean;           // "each" = per leg / per side
  repsRaw?: string;            // e.g. "12-13" when a range was collapsed
}

export interface ParsedResult {
  raw: string;
  sets: ParsedSet[];
  note?: string;
  skipped?: boolean;
  flags: string[];
  /** true if nothing numeric could be extracted */
  empty: boolean;
}

const NUM = String.raw`\d+(?:\.\d+)?`;

interface ValueParse { reps: number[]; seconds: number | null; repsRaw?: string; flags: string[] }

function parseValue(v: string): ValueParse {
  const flags: string[] = [];
  const t = v.trim();
  if (/:/.test(t)) {
    const d = parseDuration(t);
    if (d.ambiguous) flags.push(`time "${t}": ${d.reason}`);
    return { reps: [], seconds: d.seconds ?? null, flags };
  }
  if (/,/.test(t)) {
    return { reps: t.split(/\s*,\s*/).filter(Boolean).map(Number), seconds: null, flags };
  }
  const range = t.match(new RegExp(`^(${NUM})\\s*-\\s*(${NUM})$`));
  if (range) {
    const lo = Number(range[1]), hi = Number(range[2]);
    if (hi < lo || hi - lo > 5) flags.push(`unclear rep range "${t}" — used ${lo}`);
    return { reps: [lo], seconds: null, repsRaw: t, flags };
  }
  return { reps: [Number(t)], seconds: null, flags };
}

// weight x value, where value = time | list | range | number
const VALUE = String.raw`(\d+:\d{2}(?:\s*m(?:in)?)?|${NUM}(?:\s*,\s*${NUM})+|${NUM}\s*-\s*${NUM}|${NUM})`;
const WX = new RegExp(String.raw`(?:(${NUM})\s*)?x\s*${VALUE}`, 'i');

export function parseResult(rawIn: string, opts: { bodyweight?: boolean } = {}): ParsedResult {
  const raw = (rawIn ?? '').trim();
  const res: ParsedResult = { raw, sets: [], flags: [], empty: true };
  if (!raw) return res;
  if (/skip/i.test(raw) && !WX.test(raw)) {
    res.skipped = true;
    res.note = raw;
    return res;
  }

  let rest = raw;
  const push = (weight: number | null, vp: ValueParse, extra: Partial<ParsedSet> = {}) => {
    res.flags.push(...vp.flags);
    if (vp.seconds != null || (vp.reps.length === 0 && vp.flags.length)) {
      res.sets.push({ weight, reps: null, seconds: vp.seconds, ...extra });
    } else {
      for (const r of vp.reps) res.sets.push({ weight, reps: r, seconds: null, repsRaw: vp.repsRaw, ...extra });
    }
  };

  // ---- rounds: "R1-45x8 R2-45x8", "R1. 80x1:33  R2. 80x1:44"
  const roundRe = new RegExp(String.raw`\bR(\d{1,2})\s*[.\-]\s*(${NUM})\s*x\s*${VALUE}`, 'gi');
  const rounds = [...raw.matchAll(roundRe)];
  if (rounds.length) {
    for (const m of rounds) push(Number(m[2]), parseValue(m[3]), { round: Number(m[1]) });
    rest = raw.replace(roundRe, ' ');
  } else {
    // ---- sides: "L-40x20 R-40x20", "L 40x17 R40x17", "50 Lx20 Rx20"
    const sideRe = new RegExp(String.raw`(?<![A-Za-z])([LR])(?![a-wyz])\s*-?\s*(${NUM})?\s*x\s*${VALUE}`, 'g');
    const sides = [...raw.matchAll(sideRe)];
    if (sides.length) {
      const lead = raw.match(new RegExp(String.raw`^(${NUM})\s+[LR]`));
      for (const m of sides) {
        const w = m[2] != null ? Number(m[2]) : lead ? Number(lead[1]) : null;
        push(w, parseValue(m[3]), { side: m[1] as 'L' | 'R' });
      }
      rest = raw.replace(sideRe, ' ').replace(lead ? new RegExp(`^${lead[1]}`) : /^$/, ' ');
    } else {
      const m = raw.match(WX);
      if (m) {
        const vp = parseValue(m[2]);
        let weight = m[1] != null ? Number(m[1]) : null;
        if (opts.bodyweight && weight != null && weight <= 5 && vp.seconds == null && vp.reps.length === 1) {
          // "1x8" on a bodyweight move = 1 set x 8 reps
          const sets = weight;
          res.flags.push(`bodyweight move: read "${m[0]}" as ${sets} set(s) × ${vp.reps[0]} reps`);
          for (let i = 0; i < sets; i++) res.sets.push({ weight: null, reps: vp.reps[0], seconds: null });
        } else {
          push(weight, vp);
        }
        rest = raw.replace(m[0], ' ');
      }
    }
  }

  const note = rest.replace(/^[\s,;.\-]+|[\s,;.\-]+$/g, '').replace(/\s+/g, ' ');
  if (note) {
    res.note = note;
    if (/\beach\b/i.test(note)) res.sets.forEach(s => (s.perSide = true));
    if (/\bx\s*\d/i.test(note)) res.flags.push(`note contains another set ("${note}") — not counted`);
  }
  res.empty = res.sets.length === 0;
  if (res.empty && !res.skipped) res.flags.push('no weight × reps/time found');
  return res;
}

/** Epley estimated 1RM. */
export const epley = (weight: number, reps: number): number => weight * (1 + reps / 30);

import { parseDurationCell, formatDuration, type SheetCell } from './time';

export interface EntryResult extends ParsedResult { timeAmbiguous?: boolean; guessSeconds?: number }

/**
 * Cell-aware entry point used by ingestion. A cell that is ONLY a time
 * (a Sheets TIME value, or text like "2:00" / "1:05:20", or "8.26" on an
 * endurance/timed exercise) is read with the X:YY = min:sec rule.
 */
export function parseEntryResult(text: string, cell: SheetCell | null, opts: { bodyweight?: boolean; kind?: string } = {}): EntryResult {
  const t = (text ?? '').trim();
  const timeOnly = /^\d+:\d{2}(:\d{2})?(\s*(am|pm|m|min))?$/i.test(t) || (opts.kind !== 'strength' && /^\d{1,2}\.\d{2}$/.test(t));
  if (cell?.t === 'TIME' || cell?.t === 'DATE_TIME' || timeOnly) {
    const d = parseDurationCell(cell && cell.t ? cell : { f: t, t: 'TEXT' });
    return {
      raw: t, sets: [{ weight: null, reps: null, seconds: d.seconds }], empty: false,
      flags: d.ambiguous ? [`${d.reason} → best guess ${formatDuration(d.guess)} (${d.guess} s)`] : [],
      timeAmbiguous: d.ambiguous, guessSeconds: d.guess,
    };
  }
  return parseResult(t, opts);
}

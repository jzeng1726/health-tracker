/**
 * Coach "program grid" parser.
 * Detected by header cells "SETS / REPS" — never by sheet name.
 * Each header at (r,c) defines a 3-column block: [c-1]=exercise, [c]=prescription, [c+1]=result.
 * Dates found in the result column (on label rows or empty rows) set the session date
 * for every entry below them in that block.
 */
import type { SheetCell } from './time';

export interface GridEntry {
  sheetId: string;
  sheetTitle: string;
  tab: string;
  exercise: string;
  prescription: string;
  resultCell: SheetCell | null;
  resultText: string;
  extraNotes: string[];
  date: string | null;      // ISO yyyy-mm-dd
  dayLabel: string;
  row: number;              // 0-based
  col: number;              // result column, 0-based
  offset: number;           // rows below block header
  flags: string[];
}

const SECTION_LABELS = /^(prioritize|upper portion|lower portion|endurance portion|abs circuit|cardio|core|warm ?up)\s*:?$/i;
const HEADER_RX = /^sets\s*\/\s*reps$/i;

export const cellText = (c?: SheetCell | null) => (c?.f ?? c?.s ?? '').trim();

export function colName(c: number): string {
  let s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

/** Sheets serial (days since 1899-12-30) -> ISO date */
export function serialToISO(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}

/** A date cell: real DATE value, or text like 8/25, 8/25/26, 2026-08-25 (year inferred). */
export function cellDate(c: SheetCell | undefined, inferYear: number): string | null {
  if (!c) return null;
  if ((c.t === 'DATE' || c.t === 'DATE_TIME') && typeof c.n === 'number') return serialToISO(c.n);
  const t = cellText(c);
  let m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : inferYear;
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return t;
  return null;
}

export interface GridSheet { id: string; title: string; tab: string; modifiedYear: number; rows: SheetCell[][] }

export function isProgramGrid(rows: SheetCell[][]): boolean {
  return rows.some(r => r.some(c => HEADER_RX.test(cellText(c))));
}

export function parseGrid(sheet: GridSheet): GridEntry[] {
  const { rows } = sheet;
  const at = (r: number, c: number) => rows[r]?.[c];
  // find headers, grouped by exercise column
  const headers: { r: number; c: number }[] = [];
  rows.forEach((row, r) => row.forEach((cell, c) => { if (HEADER_RX.test(cellText(cell)) && c >= 1) headers.push({ r, c: c - 1 }); }));
  const byCol = new Map<number, number[]>();
  for (const h of headers) byCol.set(h.c, [...(byCol.get(h.c) ?? []), h.r]);

  const entries: GridEntry[] = [];
  for (const [exCol, hdrRows] of byCol) {
    hdrRows.sort((a, b) => a - b);
    hdrRows.forEach((hr, i) => {
      const end = i + 1 < hdrRows.length ? hdrRows[i + 1] : rows.length;
      const dayLabel = cellText(at(hr, exCol));
      let date: string | null = cellDate(at(hr, exCol + 2), sheet.modifiedYear);
      let last: GridEntry | null = null;
      for (let r = hr + 1; r < end; r++) {
        const ex = cellText(at(r, exCol));
        const rx = cellText(at(r, exCol + 1));
        const resCell = at(r, exCol + 2);
        const res = cellText(resCell);
        const d = cellDate(resCell, sheet.modifiedYear);

        if (!ex || SECTION_LABELS.test(ex)) {
          if (d) { date = d; continue; }
          if (!ex && res && last) {
            // result or note that landed one row below its exercise
            if (!last.resultText && /\d\s*x\s*\d|^\d/.test(res)) {
              last.resultText = res;
              last.resultCell = resCell ?? null;
              last.flags.push(`result was one row below the exercise (${colName(exCol + 2)}${r + 1})`);
            } else {
              last.extraNotes.push(res);
            }
          }
          continue;
        }
        const entry: GridEntry = {
          sheetId: sheet.id, sheetTitle: sheet.title, tab: sheet.tab,
          exercise: ex, prescription: rx, resultCell: d ? null : resCell ?? null, resultText: d ? '' : res,
          extraNotes: [], date, dayLabel, row: r, col: exCol + 2, offset: r - hr, flags: [],
        };
        if (d) {
          // a date sitting in an exercise's result cell starts a new session from here
          date = d;
          entry.date = d;
          entry.flags.push(`date ${res} was in this exercise's result cell`);
        }
        entries.push(entry);
        last = entry;
      }
    });
  }
  return entries;
}

/** Suggest what an unrecognised name probably is, from the same slot in other blocks of the same day type. */
export function slotSuggestion(e: GridEntry, all: GridEntry[]): string | null {
  const same = all.filter(o => o !== e && o.sheetId === e.sheetId && o.dayLabel === e.dayLabel && Math.abs(o.offset - e.offset) <= 1 && o.exercise.length > 2);
  const counts = new Map<string, number>();
  for (const o of same) counts.set(o.exercise.trim(), (counts.get(o.exercise.trim()) ?? 0) + (o.offset === e.offset ? 2 : 1));
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

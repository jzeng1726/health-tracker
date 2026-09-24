/**
 * Raw sheets + synced config  ->  one clean Dataset.
 * Nothing here invents data: unparseable or ambiguous values are left out of the
 * charts and surfaced as Review items instead.
 */
import type { SheetCell } from './time';
import { parseDurationCell, parseDistance, formatDuration } from './time';
import { fnv1a, type AppConfig, type ColumnMapping } from './config';
import type {
  BodyweightEntry, Dataset, EnduranceEntry, ExerciseInfo, ReviewItem, SheetFile, SheetTab, StrengthSet, FileSummary,
} from './model';
import { classifyTab, headerMappingForRow, cellNumber } from './classify';
import { parseGrid, cellText, cellDate, colName } from './grid';
import { detectMuscles, normalizeExerciseName, suggestMerges, type MuscleMapping } from './muscles';
import { parseEntryResult, type ParsedSet } from './results';

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseA1(ref: string): { r: number; c: number } | null {
  const m = ref.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function applyCorrections(file: SheetFile, tab: SheetTab, config: AppConfig): { rows: SheetCell[][]; corrected: Map<string, string> } {
  const corrected = new Map<string, string>();
  const idHash = fnv1a(file.id);
  const list = config.corrections.filter(c => (c.sheetId === file.id || c.sheetIdHash === idHash) && (!c.tab || c.tab === tab.title));
  if (!list.length) return { rows: tab.rows, corrected };
  const rows = tab.rows.map(r => r.slice());
  for (const c of list) {
    const p = parseA1(c.cell);
    if (!p) continue;
    const current = cellText(rows[p.r]?.[p.c]);
    // only apply while the sheet still holds the value the correction was made for
    if (current !== c.from.trim()) continue;
    while (rows.length <= p.r) rows.push([]);
    rows[p.r][p.c] = { f: c.to, s: c.to, t: 'TEXT' };
    corrected.set(c.cell.toUpperCase(), c.from);
  }
  return { rows, corrected };
}

function resolveCanonical(norm: string, merges: Record<string, string>): string {
  let cur = norm;
  for (let i = 0; i < 6 && merges[cur] && merges[cur] !== cur; i++) cur = merges[cur];
  return cur;
}

function fixYear(iso: string | null, modifiedTime: string): string | null {
  if (!iso) return iso;
  const mod = modifiedTime?.slice(0, 10);
  if (mod && iso > mod) {
    // "12/28" in a sheet last edited in January belongs to the previous year
    const d = new Date(iso + 'T00:00:00Z');
    const m = new Date(mod + 'T00:00:00Z');
    if ((d.getTime() - m.getTime()) / 86400000 > 31) return `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
  }
  return iso;
}

const distanceFromName = (norm: string): number | null => {
  const m = norm.match(/(\d+(?:\.\d+)?)\s*(mile|mi|k|km)\b/);
  if (!m) return /\bmile\b/.test(norm) ? 1609.344 : null;
  const v = Number(m[1]);
  return m[2].startsWith('m') ? v * 1609.344 : v * 1000;
};

export function buildDataset(files: SheetFile[], config: AppConfig): Dataset {
  const bodyweight: BodyweightEntry[] = [];
  const sets: StrengthSet[] = [];
  const endurance: EnduranceEntry[] = [];
  const review: ReviewItem[] = [];
  const fileSummaries: FileSummary[] = [];
  const rawNames = new Map<string, Map<string, number>>(); // canonical -> raw -> count
  const ignored = new Set(config.ignored);
  const addReview = (item: ReviewItem) => { if (!ignored.has(item.id)) review.push(item); };

  const mappingCache = new Map<string, ExerciseInfo>();
  const mappingFor = (canonical: string): { m: MuscleMapping; confirmed: boolean } => {
    const o = config.exerciseOverrides[canonical];
    if (o?.confirmed) {
      const auto = detectMuscles(canonical);
      return {
        m: { ...auto, primary: o.primary, secondary: o.secondary, kind: o.kind ?? auto.kind, enduranceType: o.enduranceType ?? auto.enduranceType, bodyweight: o.bodyweight ?? auto.bodyweight, confidence: 'high', source: 'user', rule: 'your edit', reason: 'confirmed by you' },
        confirmed: true,
      };
    }
    return { m: detectMuscles(canonical), confirmed: false };
  };
  const seen = (canonical: string, raw: string) => {
    const m = rawNames.get(canonical) ?? new Map();
    m.set(raw.trim(), (m.get(raw.trim()) ?? 0) + 1);
    rawNames.set(canonical, m);
  };

  const pushParsed = (
    p: { sets: ParsedSet[]; note?: string }, canonical: string, m: MuscleMapping,
    base: { key: string; ref: string; fileId: string; date: string; raw: string },
    extra: { distanceM?: number | null } = {},
  ) => {
    const isEndurance = m.kind !== 'strength' || p.sets.some(s => s.seconds != null);
    p.sets.forEach((s, i) => {
      const key = p.sets.length > 1 ? `${base.key}#${i}` : base.key;
      if (isEndurance) {
        const type = m.enduranceType ?? 'other';
        endurance.push({
          ...base, key, exercise: canonical, type,
          weight: s.weight, seconds: s.seconds,
          distanceM: extra.distanceM ?? (type === 'run' ? distanceFromName(canonical) : null),
          steps: type === 'walking_lunge' ? s.reps : null,
          perSide: s.perSide, round: s.round, note: p.note,
        });
      } else if (s.reps != null) {
        sets.push({ ...base, key, exercise: canonical, weight: s.weight, reps: s.reps, side: s.side, round: s.round, perSide: s.perSide, note: p.note });
      }
    });
  };

  for (const file of files) {
    const summary: FileSummary = { id: file.id, name: file.name, modifiedTime: file.modifiedTime, viaShortcut: file.viaShortcut, owner: file.owner, tabs: [] };
    fileSummaries.push(summary);
    for (const tab of file.tabs) {
      const mapKey = `${file.id}:${tab.title}`;
      const cls = classifyTab(tab, file.name, config.columnMappings[mapKey]);
      summary.tabs.push({ title: tab.title, kind: cls.kind, reason: cls.reason, rows: tab.rows.length });
      if (tab.hidden && cls.kind !== 'config') continue;
      const { rows, corrected } = applyCorrections(file, tab, config);
      const year = Number((file.modifiedTime || new Date().toISOString()).slice(0, 4));
      const refOf = (r: number, c: number) => `${file.name} › ${tab.title}!${a1(r, c)}${corrected.has(a1(r, c)) ? ' (corrected)' : ''}`;
      const keyOf = (r: number, c: number) => `${file.id}!${tab.title}!${a1(r, c)}`;

      if (cls.kind === 'unknown') {
        addReview({ id: `sheet:${mapKey}`, kind: 'sheet', title: `${file.name} › ${tab.title}`, detail: cls.reason, fileId: file.id, tab: tab.title });
        continue;
      }

      if (cls.kind === 'bodyweight') {
        let cols = cls.mapping!.columns;
        for (let r = 0; r < rows.length; r++) {
          const hdr = headerMappingForRow(rows[r] ?? []);
          if (hdr?.type === 'bodyweight') { cols = hdr.columns; continue; }
          const date = fixYear(cellDate(rows[r]?.[cols.date!], year), file.modifiedTime);
          const w = cellNumber(rows[r]?.[cols.bodyweight!]);
          if (!date || w == null) continue;
          if (w < 50 || w > 700) {
            addReview({ id: `bw:${keyOf(r, cols.bodyweight!)}`, kind: 'value', title: `Bodyweight ${date}`, detail: `${w} lb is outside 50–700 lb — left out`, ref: refOf(r, cols.bodyweight!), raw: String(w) });
            continue;
          }
          bodyweight.push({ date, weight: w, fileId: file.id, ref: refOf(r, cols.bodyweight!) });
        }
        continue;
      }

      if (cls.kind === 'program-grid') {
        const entries = parseGrid({ id: file.id, title: file.name, tab: tab.title, modifiedYear: year, rows });
        for (const e of entries) {
          const norm = normalizeExerciseName(e.exercise);
          if (!norm) continue;
          const canonical = resolveCanonical(norm, config.merges);
          seen(canonical, e.exercise);
          if (!e.resultText) continue; // planned but not logged
          const key = keyOf(e.row, e.col);
          if (ignored.has(key)) continue;
          const { m } = mappingFor(canonical);
          const parsed = parseEntryResult(e.resultText, e.resultCell, { bodyweight: m.bodyweight, kind: m.kind });
          const date = fixYear(e.date, file.modifiedTime) ?? config.dateAssignments[key] ?? null;
          const ref = refOf(e.row, e.col);
          if (parsed.skipped) continue;
          if (!date) {
            addReview({ id: `undated:${key}`, kind: 'undated', title: `${e.exercise.trim()} — no date`, detail: `"${e.resultText}" has no session date in the sheet. Pick the day you did it.`, ref, key, raw: e.resultText, exercise: canonical });
            continue;
          }
          const valueFlags = parsed.flags.filter(f => !/^bodyweight move/.test(f));
          if (valueFlags.length) {
            addReview({
              id: `value:${key}`, kind: 'value', title: `${e.exercise.trim()} · ${date}`, detail: valueFlags.join('; '),
              ref, key, fileId: file.id, tab: tab.title, cell: a1(e.row, e.col), raw: e.resultText,
              suggestion: parsed.timeAmbiguous && parsed.guessSeconds != null ? formatDuration(parsed.guessSeconds) : undefined,
            });
          }
          pushParsed(parsed, canonical, m, { key, ref, fileId: file.id, date, raw: e.resultText });
        }
        continue;
      }

      if (cls.kind === 'workout-log') {
        const map: ColumnMapping = cls.mapping!;
        const C = map.columns;
        let lastDate: string | null = null;
        for (let r = map.headerRow + 1; r < rows.length; r++) {
          const row = rows[r] ?? [];
          if (headerMappingForRow(row)) continue; // repeated header
          const d = C.date != null ? fixYear(cellDate(row[C.date], year), file.modifiedTime) : null;
          if (d) lastDate = d;
          const exRaw = C.exercise != null ? cellText(row[C.exercise]) : '';
          if (!exRaw) continue;
          const norm = normalizeExerciseName(exRaw);
          const canonical = resolveCanonical(norm, config.merges);
          seen(canonical, exRaw);
          const key = keyOf(r, C.exercise!);
          if (ignored.has(key)) continue;
          const date = lastDate ?? config.dateAssignments[key] ?? null;
          const ref = refOf(r, C.exercise!);
          const rawBits = row.map(c => cellText(c)).filter(Boolean).join(' | ');
          if (!date) {
            addReview({ id: `undated:${key}`, kind: 'undated', title: `${exRaw} — no date`, detail: 'Row has no date.', ref, key, raw: rawBits, exercise: canonical });
            continue;
          }
          const { m } = mappingFor(canonical);
          const weight = C.weight != null ? cellNumber(row[C.weight]) : null;
          const timeCell = C.time != null ? row[C.time] : undefined;
          const distText = C.distance != null ? cellText(row[C.distance]) : '';
          const note = C.notes != null ? cellText(row[C.notes]) || undefined : undefined;
          const flags: string[] = [];
          let seconds: number | null = null;
          if (timeCell && cellText(timeCell)) {
            const t = parseDurationCell(timeCell, map.timeUnit);
            if (t.ambiguous) flags.push(`${t.reason}${t.guess != null ? ` → best guess ${formatDuration(t.guess)}` : ''}`);
            seconds = t.seconds;
          }
          let distanceM: number | null = null, steps: number | null = null;
          if (distText) {
            const dd = parseDistance(distText, map.distanceUnit);
            if (dd.ambiguous) flags.push(`distance ${dd.reason}`);
            else if (dd.unit === 'steps') steps = dd.value;
            else distanceM = dd.meters;
          }
          // sets / reps
          let setCount = C.sets != null ? cellNumber(row[C.sets]) : null;
          let repsList: number[] = [];
          if (C.setsxreps != null) {
            const sx = cellText(row[C.setsxreps]).match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*-\s*\d+)?$/i);
            if (sx) { setCount = Number(sx[1]); repsList = [Number(sx[2])]; }
          }
          if (C.reps != null) {
            const rt = cellText(row[C.reps]);
            const list = rt.split(/\s*,\s*/).map(x => x.match(/^(\d+(?:\.\d+)?)/)?.[1]).filter(Boolean).map(Number);
            if (list.length) repsList = list;
          }
          if (flags.length) addReview({ id: `value:${key}`, kind: 'value', title: `${exRaw} · ${date}`, detail: flags.join('; '), ref, key, raw: rawBits });
          const isEndurance = m.kind !== 'strength' || seconds != null || distanceM != null;
          if (isEndurance) {
            const type = m.enduranceType ?? 'other';
            const n = Math.max(1, setCount ?? 1);
            for (let i = 0; i < n; i++) {
              endurance.push({
                key: n > 1 ? `${key}#${i}` : key, ref, fileId: file.id, date, exercise: canonical, type, weight, seconds,
                distanceM: distanceM ?? (type === 'run' ? distanceFromName(canonical) : null),
                steps: steps ?? (type === 'walking_lunge' && repsList[0] ? repsList[0] : null), raw: rawBits, note,
              });
            }
          } else if (repsList.length) {
            const expanded = repsList.length === 1 && setCount && setCount > 1 ? Array(setCount).fill(repsList[0]) : repsList;
            expanded.forEach((reps, i) => sets.push({ key: `${key}#${i}`, ref, fileId: file.id, date, exercise: canonical, weight: m.bodyweight && !weight ? null : weight, reps, raw: rawBits, note }));
          } else {
            addReview({ id: `value:${key}`, kind: 'value', title: `${exRaw} · ${date}`, detail: 'no reps, time or distance found', ref, key, raw: rawBits });
          }
        }
      }
    }
  }

  // ---- bodyweight: one value per date; conflicting duplicates go to review
  bodyweight.sort((a, b) => a.date.localeCompare(b.date));
  const bwByDate = new Map<string, BodyweightEntry>();
  for (const e of bodyweight) {
    const prev = bwByDate.get(e.date);
    if (!prev) bwByDate.set(e.date, e);
    else if (Math.abs(prev.weight - e.weight) > 0.001) {
      addReview({ id: `conflict:bw:${e.date}`, kind: 'conflict', title: `Two different weigh-ins on ${e.date}`, detail: `${prev.weight} lb (${prev.ref}) vs ${e.weight} lb (${e.ref}). Using the first.`, ref: e.ref });
    }
  }

  // ---- possible typos: weight far from this exercise's median
  const byEx = new Map<string, number[]>();
  for (const s of sets) if (s.weight != null) byEx.set(s.exercise, [...(byEx.get(s.exercise) ?? []), s.weight]);
  for (const s of sets) {
    const ws = byEx.get(s.exercise)!;
    if (s.weight == null || !ws || ws.length < 3) continue;
    const sorted = [...ws].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    if (s.weight < med * 0.5 || s.weight > med * 2) {
      const parts = s.key.split('#')[0].split('!');
      addReview({ id: `typo:${s.key}`, kind: 'value', title: `${s.exercise} · ${s.date}`, fileId: s.fileId, tab: parts.slice(1, -1).join('!'), cell: parts.at(-1), detail: `${s.weight} lb is far from your usual ~${med} lb — possible typo (still counted until you fix it)`, ref: s.ref, key: s.key, raw: s.raw, suggestion: s.weight < med ? `${s.weight * 10}` : undefined });
    }
  }

  // ---- exercise registry
  const exercises: Record<string, ExerciseInfo> = {};
  const autoMappings: Dataset['autoMappings'] = {};
  const counts = new Map<string, number>();
  for (const s of sets) counts.set(s.exercise, (counts.get(s.exercise) ?? 0) + 1);
  for (const e of endurance) counts.set(e.exercise, (counts.get(e.exercise) ?? 0) + 1);
  for (const [canonical, raws] of rawNames) {
    const { m, confirmed } = mappingFor(canonical);
    const variants = [...raws.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    exercises[canonical] = {
      name: canonical, display: variants[0], variants, primary: m.primary, secondary: m.secondary, kind: m.kind,
      enduranceType: m.enduranceType, bodyweight: m.bodyweight, confidence: confirmed ? 'confirmed' : m.confidence,
      source: m.source, rule: m.rule, reason: m.reason, count: counts.get(canonical) ?? 0,
    };
    const auto = detectMuscles(canonical);
    autoMappings[canonical] = { primary: auto.primary, secondary: auto.secondary, kind: auto.kind, confidence: auto.confidence, rule: auto.rule, confirmed: false };
    if (!confirmed && m.confidence !== 'high') {
      addReview({
        id: `exercise:${canonical}`, kind: 'exercise', title: variants[0],
        detail: m.confidence === 'none' ? 'Could not tell which muscle this works.' : `Best guess ${m.primary} — ${m.reason}.`,
        guess: { primary: m.primary, secondary: m.secondary }, exercise: canonical,
      });
    }
  }
  // merges for canonical names that were merged away are resolved; also include merged aliases' raw names
  for (const [alias, target] of Object.entries(config.merges)) {
    const t = resolveCanonical(target, config.merges);
    if (exercises[t] && !exercises[t].variants.some(v => normalizeExerciseName(v) === alias)) exercises[t].variants.push(`${alias} (merged)`);
  }

  const rejected = new Set(config.rejectedMerges);
  for (const s of suggestMerges(Object.keys(exercises))) {
    const id = [s.a, s.b].sort().join('|');
    if (rejected.has(id)) continue;
    addReview({ id: `merge:${id}`, kind: 'merge', title: `Same exercise? "${exercises[s.a]?.display ?? s.a}" and "${exercises[s.b]?.display ?? s.b}"`, detail: s.why, merge: { a: s.a, b: s.b } });
  }

  return {
    bodyweight: [...bwByDate.values()], sets, endurance, exercises, review, files: fileSummaries, autoMappings,
  };
}

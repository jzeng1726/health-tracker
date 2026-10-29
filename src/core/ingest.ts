/**
 * Raw sheets + synced config  ->  one clean Dataset.
 * Nothing here invents data: unparseable or ambiguous values are left out of the
 * charts and surfaced as Review items instead.
 */
import type { SheetCell } from './time';
import { parseDurationCell, parseDistance, formatDuration } from './time';
import { fnv1a, type AppConfig, type ColumnMapping, type Correction } from './config';
import type {
  BodyweightEntry, Dataset, EnduranceEntry, ExerciseInfo, ReviewItem, SheetFile, SheetTab, StrengthSet, FileSummary, Program, ProgramBlock,
  NoteEntry, LifeEntry, NameFix,
} from './model';
import { readNote, readLifeNote } from './notes';
import { cleanExerciseName } from './names';
import { classifyTab, headerMappingForRow, cellNumber, detectExerciseList } from './classify';
import { parseGrid, cellText, cellDate, colName, isProgramGrid, type GridEntry } from './grid';
import { detectMuscles, normalizeExerciseName, suggestMerges, withSheetMuscle, wordSetKey, type MuscleMapping } from './muscles';
import { parseEntryResult, type ParsedSet } from './results';

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseA1(ref: string): { r: number; c: number } | null {
  const m = ref.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

function applyCorrections(file: SheetFile, tab: SheetTab, config: AppConfig, orphans: Correction[]): { rows: SheetCell[][]; corrected: Map<string, string> } {
  const corrected = new Map<string, string>();
  const idHash = fnv1a(file.id);
  const direct = config.corrections.filter(c => (c.sheetId === file.id || c.sheetIdHash === idHash) && (!c.tab || c.tab === tab.title));
  // corrections made on a copy that's since been deleted still apply to the sheet that has the same text in the same cell
  const cells = new Set(direct.map(c => c.cell.toUpperCase()));
  const fallback = orphans.filter(c => !cells.has(c.cell.toUpperCase()) && (!c.tab || c.tab === tab.title));
  const list = [...direct, ...fallback];
  if (!list.length) return { rows: tab.rows, corrected };
  const rows = tab.rows.map(r => r.slice());
  for (const c of list) {
    const p = parseA1(c.cell);
    if (!p) continue;
    if (corrected.has(c.cell.toUpperCase())) continue;
    const current = cellText(rows[p.r]?.[p.c]);
    // only apply while the sheet still holds the value the correction was made for
    if (current !== c.from.trim()) continue;
    while (rows.length <= p.r) rows.push([]);
    rows[p.r][p.c] = { f: c.to, s: c.to, t: 'TEXT' };
    corrected.set(c.cell.toUpperCase(), c.from);
  }
  return { rows, corrected };
}

/** Default gym for a sheet: your Settings choice, else "Vacation gym" for vacation/travel sheets, else your main gym. */
export function gymForFile(file: { id: string; name: string }, config: AppConfig): string {
  const g = config.gyms ?? { defaultGym: 'Training Station', bySheet: {} as Record<string, string> };
  const set = g.bySheet?.[file.id];
  if (set) return normalizeGym(set, config);
  // a sheet named after a gym you've added ("Firehouse Gym", "Firehouse log") belongs to that gym
  const name = ` ${file.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const named = [...(g.names ?? []), g.defaultGym].filter(Boolean).find(k => {
    const core = k.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\bgym\b/g, '').trim();
    return core.length >= 3 && name.includes(` ${core} `);
  });
  if (named) return named;
  return /\b(vacation|travel|trip|hotel|away|visiting)\b/i.test(file.name) ? 'Vacation gym' : g.defaultGym || 'Home gym';
}

/** "home gym" -> "Training Station" after a rename; "firehouse" -> "Firehouse Gym"; otherwise as typed. */
export function normalizeGym(name: string, config: AppConfig): string {
  const n = name.trim();
  const low = n.toLowerCase();
  const g = config.gyms;
  if (!n) return g?.defaultGym || 'Training Station';
  if (g?.aliases?.[low]) return g.aliases[low];
  // logs written before the rename say "Home gym"
  if ((low === 'home gym' || low === 'home') && g?.defaultGym) return g.defaultGym;
  const known = [g?.defaultGym, ...(g?.names ?? []), 'Vacation gym'].filter(Boolean) as string[];
  return known.find(k => k.toLowerCase() === low) ?? known.find(k => k.toLowerCase().replace(/\s*gym$/, '') === low.replace(/\s*gym$/, '')) ?? n;
}

/** Logged-result cells of a file ("C15=130x9"), used to spot copies of the same sheet. Planned prescriptions don't count. */
function resultFingerprint(file: SheetFile): Set<string> {
  const out = new Set<string>();
  for (const t of file.tabs) {
    if (isProgramGrid(t.rows)) {
      for (const e of parseGrid({ id: file.id, title: file.name, tab: t.title, modifiedYear: 2000, rows: t.rows })) if (e.resultText) out.add(`${a1(e.row, e.col)}=${e.resultText}`);
    } else if (detectHeaderRowSafe(t)) {
      t.rows.forEach((row, r) => { const x = row.map(c => cellText(c)).join('|'); if (/\d/.test(x)) out.add(`${r}=${x}`); });
    }
  }
  return out;
}

/** fileId -> the file it duplicates (≥80% of its logged cells are identical). The fuller / newer copy is kept. */
export function findDuplicates(files: SheetFile[]): Map<string, string> {
  const fps = files.map(f => ({ f, fp: resultFingerprint(f) })).filter(x => x.fp.size >= 5)
    .sort((a, b) => b.fp.size - a.fp.size || b.f.modifiedTime.localeCompare(a.f.modifiedTime));
  const kept: typeof fps = [];
  const dup = new Map<string, string>();
  for (const x of fps) {
    const of = kept.find(k => { let same = 0; for (const v of x.fp) if (k.fp.has(v)) same++; return same / x.fp.size >= 0.8; });
    if (of) dup.set(x.f.id, of.f.id); else kept.push(x);
  }
  return dup;
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
  const programs: Program[] = [];
  const life: LifeEntry[] = [];
  const nameCells: { fileId: string; fileName: string; tab: string; row: number; col: number; raw: string; canonical: string; own: boolean }[] = [];
  const rawNames = new Map<string, Map<string, number>>(); // canonical -> raw -> count
  const sheetMuscle = new Map<string, string>();            // canonical -> muscle named by the sheet
  const ignored = new Set(config.ignored);
  const addReview = (item: ReviewItem) => { if (!ignored.has(item.id)) review.push(item); };
  const gymsSeen = new Set<string>([config.gyms?.defaultGym || 'Training Station', ...(config.gyms?.names ?? [])]);

  const present = new Set(files.map(f => f.id));
  const presentHash = new Set(files.map(f => fnv1a(f.id)));
  const orphans = config.corrections.filter(c => (c.sheetId ? !present.has(c.sheetId) : !!c.sheetIdHash && !presentHash.has(c.sheetIdHash)));
  const duplicates = findDuplicates(files.filter(f => f.tabs.some(t => isProgramGrid(t.rows) || detectHeaderRowSafe(t))));

  const mappingFor = (canonical: string): { m: MuscleMapping; confirmed: boolean } => {
    const o = config.exerciseOverrides[canonical];
    const auto = withSheetMuscle(detectMuscles(canonical), sheetMuscle.get(canonical));
    if (o?.confirmed) {
      return {
        m: { ...auto, primary: o.primary, secondary: o.secondary, kind: o.kind ?? auto.kind, enduranceType: o.enduranceType ?? auto.enduranceType, bodyweight: o.bodyweight ?? auto.bodyweight, confidence: 'high', source: 'user', rule: 'your edit', reason: 'confirmed by you' },
        confirmed: true,
      };
    }
    return { m: auto, confirmed: false };
  };
  const seen = (canonical: string, raw: string) => {
    const m = rawNames.get(canonical) ?? new Map();
    m.set(raw.trim(), (m.get(raw.trim()) ?? 0) + 1);
    rawNames.set(canonical, m);
  };

  const pushParsed = (
    p: { sets: ParsedSet[]; note?: string; rpe?: number }, canonical: string, m: MuscleMapping,
    base: { key: string; ref: string; fileId: string; date: string; raw: string; gym: string },
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
        sets.push({ ...base, key, exercise: canonical, weight: s.weight, reps: s.reps, side: s.side, round: s.round, perSide: s.perSide, note: p.note, rpe: p.rpe });
      }
    });
  };

  // Exercise library tabs (muscle-group columns with exercise names underneath) tag exercises with
  // their muscle group before any sets are read, so the Log tab's rows get the right muscle.
  for (const file of files) {
    if (duplicates.has(file.id)) continue;
    for (const tab of file.tabs) {
      if (classifyTab(tab, file.name, config.columnMappings[`${file.id}:${tab.title}`]).kind !== 'exercise-list') continue;
      for (const e of detectExerciseList(tab.rows)?.entries ?? []) {
        const norm = normalizeExerciseName(e.exercise);
        if (!norm) continue;
        const canonical = resolveCanonical(norm, config.merges);
        if (!sheetMuscle.has(canonical)) sheetMuscle.set(canonical, e.group);
      }
    }
  }

  for (const file of files) {
    const summary: FileSummary = { id: file.id, name: file.name, modifiedTime: file.modifiedTime, viaShortcut: file.viaShortcut, owner: file.owner, tabs: [] };
    fileSummaries.push(summary);
    const dupOf = duplicates.get(file.id);
    if (dupOf) {
      const other = files.find(f => f.id === dupOf);
      for (const tab of file.tabs) summary.tabs.push({ title: tab.title, kind: 'duplicate', reason: `same logged sets as "${other?.name ?? 'another sheet'}" — skipped so nothing counts twice`, rows: tab.rows.length });
      continue;
    }
    const fileGym = gymForFile(file, config);
    gymsSeen.add(fileGym);
    const own = file.canEdit !== false && !file.viaShortcut;
    for (const tab of file.tabs) {
      const mapKey = `${file.id}:${tab.title}`;
      const cls = classifyTab(tab, file.name, config.columnMappings[mapKey]);
      summary.tabs.push({ title: tab.title, kind: cls.kind, reason: cls.reason, rows: tab.rows.length });
      if (tab.hidden && cls.kind !== 'config') continue;
      const { rows, corrected } = applyCorrections(file, tab, config, cls.kind === 'program-grid' || cls.kind === 'workout-log' ? orphans : []);
      const year = Number((file.modifiedTime || new Date().toISOString()).slice(0, 4));
      const refOf = (r: number, c: number) => `${file.name} › ${tab.title}!${a1(r, c)}${corrected.has(a1(r, c)) ? ' (corrected)' : ''}`;
      const keyOf = (r: number, c: number) => `${file.id}!${tab.title}!${a1(r, c)}`;

      if (cls.kind === 'exercise-list') continue; // read in the pass above; nothing is logged from it

      if (cls.kind === 'unknown') {
        addReview({ id: `sheet:${mapKey}`, kind: 'sheet', title: `${file.name} › ${tab.title}`, detail: cls.reason, fileId: file.id, tab: tab.title });
        continue;
      }

      if (cls.kind === 'life-log') {
        const C = cls.mapping!.columns;
        for (let r = cls.mapping!.headerRow + 1; r < rows.length; r++) {
          const row = rows[r] ?? [];
          const date = fixYear(cellDate(row[C.date!], year), file.modifiedTime);
          const text = cellText(row[C.notes!]);
          if (!date || !text) continue;
          const until = C.until != null ? fixYear(cellDate(row[C.until], year), file.modifiedTime) ?? undefined : undefined;
          life.push({ date, until: until && until > date ? until : undefined, text, tags: readLifeNote(text), ref: refOf(r, C.notes!) });
        }
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
        const blocks = new Map<string, ProgramBlock>();
        const undatedByBlock = new Map<string, { keys: string[]; names: string[]; e: GridEntry }>();
        for (const e of entries) {
          const norm = normalizeExerciseName(e.exercise);
          if (!norm) continue;
          const canonical = resolveCanonical(norm, config.merges);
          seen(canonical, e.exercise);
          if (!rows[e.row]?.[e.col - 2]?.fx) nameCells.push({ fileId: file.id, fileName: file.name, tab: tab.title, row: e.row, col: e.col - 2, raw: e.exercise, canonical, own });
          const bk = `${e.block.headerRow}:${e.block.exCol}`;
          const block = blocks.get(bk) ?? { dayLabel: e.dayLabel, headerRow: e.block.headerRow, exCol: e.block.exCol, date: null, items: [], logged: 0 };
          block.items.push({ exercise: canonical, display: e.exercise.trim(), prescription: e.prescription, notes: e.extraNotes, result: e.resultText });
          if (e.resultText) { block.logged++; block.date = block.date ?? fixYear(e.date, file.modifiedTime) ?? null; }
          blocks.set(bk, block);
          if (!e.resultText) continue; // planned but not logged
          const key = keyOf(e.row, e.col);
          if (ignored.has(key)) continue;
          const { m } = mappingFor(canonical);
          const parsed = parseEntryResult(e.resultText, e.resultCell, { bodyweight: m.bodyweight, kind: m.kind });
          const date = fixYear(e.date, file.modifiedTime) ?? config.dateAssignments[key] ?? null;
          const ref = refOf(e.row, e.col);
          if (parsed.skipped) continue;
          if (!date) {
            const u = undatedByBlock.get(bk) ?? { keys: [], names: [], e };
            u.keys.push(key); u.names.push(`${e.exercise.trim()} "${e.resultText}"`);
            undatedByBlock.set(bk, u);
            continue;
          }
          const valueFlags = parsed.flags.filter(f => !/^bodyweight move/.test(f));
          if (valueFlags.length) {
            addReview({
              id: `value:${key}`, kind: 'value', title: `${e.exercise.trim()} · ${date}`, detail: valueFlags.join('; '),
              ref, key, fileId: file.id, tab: tab.title, cell: a1(e.row, e.col), raw: e.resultText,
              suggestion: parsed.timeAmbiguous && parsed.guessSeconds != null ? formatDuration(parsed.guessSeconds) : (parsed as any).suggestion,
            });
          }
          // notes: text after the numbers + lines written under the exercise ("1 Higher pad position")
          const note = [parsed.note, ...e.extraNotes].filter(x => x && !/^(each|per (side|leg|arm))$/i.test(x.trim())).join(' · ') || undefined;
          pushParsed({ ...parsed, note }, canonical, m, { key, ref, fileId: file.id, date, raw: e.resultText, gym: fileGym });
        }
        // one date picker per block instead of one per exercise
        for (const [, u] of undatedByBlock) {
          const label = u.e.dayLabel || 'block';
          addReview({
            id: `undated:${u.keys[0]}`, kind: 'undated', title: `${label} — ${u.keys.length} entr${u.keys.length > 1 ? 'ies' : 'y'} without a date`,
            detail: `${u.names.join(', ')}. The sheet has no session date for ${u.keys.length > 1 ? 'these' : 'this'}; pick the day once and it applies to all.`,
            ref: refOf(u.e.row, u.e.col), key: u.keys[0], keys: u.keys, raw: u.names.join(' · '),
          });
        }
        programs.push({ fileId: file.id, fileName: file.name, modifiedTime: file.modifiedTime, blocks: [...blocks.values()].sort((a, b) => a.headerRow - b.headerRow || a.exCol - b.exCol) });
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
          if (!row[C.exercise!]?.fx) nameCells.push({ fileId: file.id, fileName: file.name, tab: tab.title, row: r, col: C.exercise!, raw: exRaw, canonical, own });
          const label = C.muscle != null ? cellText(row[C.muscle]) : '';
          if (label && !sheetMuscle.has(canonical)) sheetMuscle.set(canonical, label);
          const key = keyOf(r, C.exercise!);
          if (ignored.has(key)) continue;
          const date = lastDate ?? config.dateAssignments[key] ?? null;
          const ref = refOf(r, C.exercise!);
          const rawBits = row.map(c => cellText(c)).filter(Boolean).join(' | ');
          if (!date) {
            addReview({ id: `undated:${key}`, kind: 'undated', title: `${exRaw} — no date`, detail: 'Row has no date.', ref, key, raw: rawBits, exercise: canonical });
            continue;
          }
          const gymCell = C.gym != null ? cellText(row[C.gym]) : '';
          const gym = gymCell ? normalizeGym(gymCell, config) : fileGym;
          gymsSeen.add(gym);
          let rpe: number | undefined;
          if (C.rpe != null) {
            const v = cellNumber(row[C.rpe]);
            if (v != null && v >= 0 && v <= 10) rpe = map.rpeUnit === 'rir' ? 10 - v : v;
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
                steps: steps ?? (type === 'walking_lunge' && repsList[0] ? repsList[0] : null), raw: rawBits, note, gym,
              });
            }
          } else if (repsList.length) {
            const expanded = repsList.length === 1 && setCount && setCount > 1 ? Array(setCount).fill(repsList[0]) : repsList;
            expanded.forEach((reps, i) => sets.push({ key: `${key}#${i}`, ref, fileId: file.id, date, exercise: canonical, weight: m.bodyweight && !weight ? null : weight, reps, raw: rawBits, note, gym, rpe }));
          } else {
            addReview({ id: `value:${key}`, kind: 'value', title: `${exRaw} · ${date}`, detail: 'no reps, time or distance found', ref, key, raw: rawBits });
          }
        }
      }
    }
  }

  // ---- automatic merges: same words in a different order, or the same letters spaced differently
  const autoMerge = autoMerges([...rawNames.keys()], config, (n) => [...(rawNames.get(n)?.values() ?? [])].reduce((a, b) => a + b, 0));
  if (autoMerge.size) {
    const remap = (n: string) => autoMerge.get(n) ?? n;
    for (const x of sets) x.exercise = remap(x.exercise);
    for (const x of endurance) x.exercise = remap(x.exercise);
    for (const p of programs) for (const b of p.blocks) for (const it of b.items) it.exercise = remap(it.exercise);
    for (const c of nameCells) c.canonical = remap(c.canonical);
    for (const [alias, target] of autoMerge) {
      const a = rawNames.get(alias)!, t = rawNames.get(target) ?? new Map<string, number>();
      for (const [raw, n] of a) t.set(raw, (t.get(raw) ?? 0) + n);
      rawNames.set(target, t);
      rawNames.delete(alias);
      if (sheetMuscle.has(alias) && !sheetMuscle.has(target)) sheetMuscle.set(target, sheetMuscle.get(alias)!);
    }
    for (const r of review) if (r.exercise && autoMerge.has(r.exercise)) r.exercise = autoMerge.get(r.exercise);
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

  // ---- exercise registry
  const exercises: Record<string, ExerciseInfo> = {};
  const autoMappings: Dataset['autoMappings'] = {};
  const counts = new Map<string, number>();
  for (const s of sets) counts.set(s.exercise, (counts.get(s.exercise) ?? 0) + 1);
  for (const e of endurance) counts.set(e.exercise, (counts.get(e.exercise) ?? 0) + 1);
  for (const [canonical, raws] of rawNames) {
    const { m, confirmed } = mappingFor(canonical);
    const variants = [...raws.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    // the name it's shown (and written) as: your chosen name, else the most common spelling of this exact
    // exercise (not of a name merged into it), cleaned up: "Rope pushdown" -> "Rope Pushdown"
    const own = variants.find(v => normalizeExerciseName(v) === canonical) ?? variants[0];
    const display = config.displayNames?.[canonical] ?? cleanExerciseName(own);
    exercises[canonical] = {
      name: canonical, display, variants, primary: m.primary, secondary: m.secondary, kind: m.kind,
      enduranceType: m.enduranceType, bodyweight: m.bodyweight, confidence: confirmed ? 'confirmed' : m.confidence,
      source: m.source, rule: m.rule, reason: m.reason, count: counts.get(canonical) ?? 0,
    };
    const auto = mappingFor(canonical).m;
    autoMappings[canonical] = { primary: auto.primary, secondary: auto.secondary, kind: auto.kind, confidence: auto.confidence, rule: auto.rule, confirmed: false };
    // only ask about exercises that actually have logged data
    if (!confirmed && m.confidence !== 'high' && (counts.get(canonical) ?? 0) > 0) {
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

  // ---- notes written next to sets: read them, and turn setup changes into new baselines
  const notes: NoteEntry[] = [];
  const changes: Record<string, string[]> = {};
  const seenNote = new Set<string>();
  for (const x of [...sets, ...endurance]) {
    if (!x.note) continue;
    const base = x.key.split('#')[0];
    if (seenNote.has(base)) continue;
    seenNote.add(base);
    const r = readNote(x.note);
    const w = 'reps' in x ? `${x.weight ?? 'BW'} × ${x.reps}` : x.raw;
    notes.push({ date: x.date, exercise: x.exercise, gym: x.gym, text: x.note, tags: r.tags, setupChange: r.setupChange, ref: x.ref, key: base, set: w });
    if (r.setupChange) {
      const st = `${x.exercise}|${x.gym}`;
      if (!(changes[st] ?? []).includes(x.date)) changes[st] = [...(changes[st] ?? []), x.date].sort();
    }
  }
  notes.sort((a, b) => b.date.localeCompare(a.date));
  life.sort((a, b) => b.date.localeCompare(a.date));

  // ---- possible typos, judged against the sessions just before and after (same exercise, same gym)
  for (const t of typoSuspects(sets, changes)) {
    const s = t.set;
    const parts = s.key.split('#')[0].split('!');
    addReview({
      id: `typo:${s.key}`, kind: 'value', title: `${s.exercise} · ${s.date}`, fileId: s.fileId, tab: parts.slice(1, -1).join('!'), cell: parts.at(-1),
      detail: `${s.weight} lb is far from the sessions around it (${t.context}) — possible typo (still counted until you fix it)`,
      ref: s.ref, key: s.key, raw: s.raw, suggestion: t.suggestion != null ? s.raw.replace(String(s.weight), String(t.suggestion)) : undefined,
    });
  }

  // ---- exercise names to tidy up in sheets you own (never your coach's)
  const nameFixes: NameFix[] = [];
  for (const c of nameCells) {
    if (!c.own) continue;
    const to = exercises[c.canonical]?.display;
    if (to && c.raw.trim() !== to) nameFixes.push({ fileId: c.fileId, fileName: c.fileName, tab: c.tab, row: c.row, col: c.col, from: c.raw, to });
  }

  const def = config.gyms?.defaultGym || 'Training Station';
  return {
    bodyweight: [...bwByDate.values()], sets, endurance, exercises, review, files: fileSummaries, autoMappings, programs,
    gyms: [def, ...[...gymsSeen].filter(g => g !== def)], notes, life, changes, nameFixes,
  };
}

function detectHeaderRowSafe(t: SheetTab): boolean {
  try { return classifyTab(t, '').kind === 'workout-log'; } catch { return false; }
}

/**
 * Names that are clearly the same exercise get merged without asking:
 * same words in any order ("chest press machine" / "machine chest press") or
 * the same letters with different spacing. Your merges and "not the same" choices always win.
 */
export function autoMerges(names: string[], config: AppConfig, weight: (n: string) => number): Map<string, string> {
  const parent = new Map<string, string>(names.map(n => [n, n]));
  const find = (x: string): string => { while (parent.get(x) !== x) x = parent.get(x)!; return x; };
  const rejected = new Set(config.rejectedMerges);
  const byKey = new Map<string, string>();
  for (const n of names) {
    for (const k of [`w:${wordSetKey(n)}`, `s:${n.replace(/\s+/g, '')}`]) {
      const other = byKey.get(k);
      if (!other) { byKey.set(k, n); continue; }
      if (rejected.has([n, other].sort().join('|'))) continue;
      const a = find(n), b = find(other);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<string, string[]>();
  for (const n of names) groups.set(find(n), [...(groups.get(find(n)) ?? []), n]);
  const out = new Map<string, string>();
  const preferred = (n: string) => (config.exerciseOverrides[n]?.confirmed ? 1000000 : 0) + (Object.values(config.merges).includes(n) ? 100000 : 0) + weight(n);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const target = [...g].sort((a, b) => preferred(b) - preferred(a) || a.localeCompare(b))[0];
    for (const n of g) if (n !== target) out.set(n, target);
  }
  return out;
}

/** Sets whose weight is ≥2× off BOTH the session before and the session after (≥3× when only one neighbour exists). */
export function typoSuspects(sets: StrengthSet[], changes: Record<string, string[]> = {}): { set: StrengthSet; context: string; suggestion: number | null }[] {
  const byStation = new Map<string, Map<string, number[]>>();
  for (const s of sets) {
    if (s.weight == null || s.weight <= 0) continue;
    const st = `${s.exercise}|${s.gym}`;
    const days = byStation.get(st) ?? new Map<string, number[]>();
    days.set(s.date, [...(days.get(s.date) ?? []), s.weight]);
    byStation.set(st, days);
  }
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const out: { set: StrengthSet; context: string; suggestion: number | null }[] = [];
  for (const s of sets) {
    if (s.weight == null || s.weight <= 0) continue;
    // a note said the setup changed that day — a big jump is expected, not a typo
    if ((changes[`${s.exercise}|${s.gym}`] ?? []).includes(s.date)) continue;
    const days = byStation.get(`${s.exercise}|${s.gym}`)!;
    const dates = [...days.keys()].sort();
    const i = dates.indexOf(s.date);
    // at the start or end of the history, compare with the nearest few sessions so one odd value can't flag its neighbour
    const side = (from: number, to: number) => { const xs = dates.slice(Math.max(0, from), Math.max(0, to)).map(d => med(days.get(d)!)); return xs.length ? med(xs) : null; };
    const both = i > 0 && i < dates.length - 1;
    const prev = i > 0 ? (both ? med(days.get(dates[i - 1])!) : side(i - 3, i)) : null;
    const next = i < dates.length - 1 ? (both ? med(days.get(dates[i + 1])!) : side(i + 1, i + 4)) : null;
    const off = (ref: number, f: number) => s.weight! / ref >= f || ref / s.weight! >= f;
    let suspicious = false;
    if (prev != null && next != null) suspicious = off(prev, 2) && off(next, 2);
    else if (prev != null || next != null) suspicious = off((prev ?? next)!, 3);
    if (!suspicious) continue;
    const ref = prev != null && next != null ? (prev + next) / 2 : (prev ?? next)!;
    const near = (x: number) => x / ref >= 0.75 && x / ref <= 1.34;
    const suggestion = near(s.weight * 10) ? s.weight * 10 : near(s.weight / 10) ? s.weight / 10 : null;
    const ctx = [prev != null ? `before: ${prev} lb` : null, next != null ? `after: ${next} lb` : null].filter(Boolean).join(', ');
    out.push({ set: s, context: ctx, suggestion });
  }
  return out;
}

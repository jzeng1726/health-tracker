/** Phase 1 report: run detection + parsing over the real sheet fixtures. */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseGrid, slotSuggestion, colName, type GridSheet, type GridEntry } from '../src/core/grid';
import { detectMuscles, normalizeExerciseName, suggestMerges } from '../src/core/muscles';
import { parseEntryResult as parseResultCell } from '../src/core/results';
import { parseDurationCell, formatDuration } from '../src/core/time';

const load = (f: string): GridSheet => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const sheets = [load('fb-week-01.json'), load('fb-weeks-2-4.json')];
const entries: GridEntry[] = sheets.flatMap(parseGrid);

const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '—');
const short = (t: string) => (t.includes('Week 01') ? 'Wk01' : 'Wk2-4');
const cellRef = (e: GridEntry) => `${short(e.sheetTitle)}!${colName(e.col)}${e.row + 1}`;

// ---------------------------------------------------------------- exercise map
type Agg = { raws: Set<string>; logged: number; planned: number; sheets: Set<string>; entries: GridEntry[] };
const byNorm = new Map<string, Agg>();
for (const e of entries) {
  const n = normalizeExerciseName(e.exercise);
  const a = byNorm.get(n) ?? { raws: new Set(), logged: 0, planned: 0, sheets: new Set(), entries: [] };
  a.raws.add(e.exercise.trim());
  a.sheets.add(short(e.sheetTitle));
  a.entries.push(e);
  if (e.resultText) a.logged++; else a.planned++;
  byNorm.set(n, a);
}

const rows: string[] = [];
const mapJson: any[] = [];
for (const [norm, a] of [...byNorm].sort((x, y) => {
  const mx = detectMuscles(x[0]), my = detectMuscles(y[0]);
  const order = (m: any) => (m.kind !== 'strength' ? 20 : 0) + (m.primary ? ['Chest', 'Back', 'Triceps', 'Biceps', 'Shoulders', 'Quads', 'Calves', 'Hamstrings', 'Core'].indexOf(m.primary) : 30);
  return order(mx) - order(my) || x[0].localeCompare(y[0]);
})) {
  const m = detectMuscles(norm);
  const display = [...a.raws][0];
  let guess = '';
  if (m.confidence === 'none') {
    const sug = slotSuggestion(a.entries[0], entries);
    if (sug) guess = ` — same slot as **${sug}** in other ${a.entries[0].dayLabel} blocks`;
  }
  mapJson.push({ name: display, normalized: norm, variants: [...a.raws], ...m, logged: a.logged });
  rows.push(`| ${display}${a.raws.size > 1 ? ` (+${[...a.raws].slice(1).map(r => `"${r}"`).join(', ')})` : ''} | ${m.primary ?? (m.kind === 'endurance' ? '— (endurance only)' : '?')} | ${m.secondary.join(', ') || '—'} | ${m.kind}${m.enduranceType ? ` (${m.enduranceType})` : ''} | ${m.confidence === 'high' ? 'High' : m.confidence === 'low' ? '**Low**' : '**None**'} | ${m.source === 'mandatory' ? `**${m.rule}**` : m.rule} | ${a.logged} | ${m.reason}${guess} |`);
}

// ---------------------------------------------------------------- merges
const merges = suggestMerges([...byNorm.keys()]);

// ---------------------------------------------------------------- strength parse + typo check
const strengthLines: string[] = [];
const flagLines: string[] = [];
const weightsByEx = new Map<string, number[]>();
const parsed = entries.filter(e => e.resultText).map(e => {
  const m = detectMuscles(e.exercise);
  const r = parseResultCell(e.resultText, e.resultCell, { bodyweight: m.bodyweight, kind: m.kind });
  const n = normalizeExerciseName(e.exercise);
  for (const s of r.sets) if (s.weight != null && s.reps != null) weightsByEx.set(n, [...(weightsByEx.get(n) ?? []), s.weight]);
  return { e, m, r, n };
}).sort((a, b) => (a.e.date ?? '9999').localeCompare(b.e.date ?? '9999'));
for (const p of parsed) {
  const ws = weightsByEx.get(p.n) ?? [];
  const sorted = [...ws].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  for (const s of p.r.sets) {
    if (s.weight != null && ws.length >= 3 && (s.weight < med * 0.5 || s.weight > med * 2))
      p.r.flags.push(`weight ${s.weight} is far from this exercise's usual ~${med} — possible typo`);
  }
  if (p.m.kind === 'strength' && !p.r.sets.some(s => s.seconds != null)) {
    const setsTxt = p.r.skipped ? 'skipped' : p.r.sets.map(s => `${s.side ? s.side + ' ' : ''}${s.round ? 'R' + s.round + ' ' : ''}${s.weight ?? 'BW'}×${s.reps}${s.perSide ? '/side' : ''}`).join(', ') || '—';
    strengthLines.push(`| ${md(p.e.date)} | ${p.e.exercise.trim()} | \`${p.e.resultText}\` | ${setsTxt} | ${[...p.r.flags, ...p.e.flags].join('; ') || ''} |`);
  }
  if (p.r.flags.length || p.e.flags.length || !p.e.date) {
    flagLines.push(`| ${cellRef(p.e)} | ${md(p.e.date)} | ${p.e.exercise.trim()} | \`${p.e.resultText}\` | ${[...(p.e.date ? [] : ['no date']), ...p.r.flags, ...p.e.flags].join('; ')} |`);
  }
}

// ---------------------------------------------------------------- endurance
const endLines: string[] = [];
const endJson: any[] = [];
for (const p of parsed) {
  const hasTime = p.r.sets.some(s => s.seconds != null) || /:\d{2}/.test(p.e.resultText);
  if (p.m.kind === 'strength' && !hasTime) continue;
  const c = p.e.resultCell ?? {};
  const storage = c.t === 'TIME' ? `**time value** ${Math.round((c.n ?? 0) * 86400)} s (${Math.round((c.n ?? 0) * 24 * 100) / 100} h) — shows "${c.f}"` : 'text';
  let items: string[] = [];
  if (c.t === 'TIME' || (p.r as any).timeAmbiguous !== undefined) {
    const d = parseDurationCell(c.t ? c : { f: p.e.resultText, t: 'TEXT' });
    items = [d.ambiguous ? `**FLAG** ${d.reason} → guess ${formatDuration(d.guess)} (${d.guess} s)` : `${formatDuration(d.seconds)} = **${d.seconds} s**`];
    endJson.push({ date: p.e.date, exercise: p.e.exercise.trim(), raw: p.e.resultText, seconds: d.seconds, ambiguous: d.ambiguous, guess: d.guess });
  } else {
    items = p.r.sets.map(s => {
      const parts = [s.round ? `R${s.round}` : '', s.weight != null ? `${s.weight} lb` : '', s.seconds != null ? `${formatDuration(s.seconds)} = **${s.seconds} s**` : '', s.reps != null ? `${s.reps} steps${s.perSide ? ' per leg' : ''}` : ''].filter(Boolean);
      endJson.push({ date: p.e.date, exercise: p.e.exercise.trim(), raw: p.e.resultText, ...s });
      return parts.join(' · ');
    });
  }
  endLines.push(`| ${md(p.e.date)} | ${p.e.exercise.trim()} | ${cellRef(p.e)} | \`${p.e.resultText}\` | ${storage} | ${items.join('<br>')} | ${p.r.note ? p.r.note : ''}${p.e.extraNotes.length ? ' note: ' + p.e.extraNotes.join('; ') : ''} |`);
}

const out = `# Phase 1 report (generated ${new Date().toISOString().slice(0, 10)})

Sheets parsed: ${sheets.map(s => s.title).join(', ')} — ${entries.length} exercise slots, ${parsed.length} with a logged result.

## Exercise → muscle map
| Exercise (variants) | Primary | Secondary (50%) | Kind | Confidence | Rule | Logged | Why |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Possible duplicates (not merged until you confirm)
${merges.map(m => `- "${m.a}" ↔ "${m.b}" — ${m.why}`).join('\n') || '- none'}

## Endurance / timed entries
| Date | Exercise | Cell | Raw value | Stored in Sheets as | Parsed | Note |
|---|---|---|---|---|---|---|
${endLines.join('\n')}

## Strength results parsed
| Date | Exercise | Raw | Parsed sets | Flags |
|---|---|---|---|---|
${strengthLines.join('\n')}

## Everything flagged for review
| Cell | Date | Exercise | Raw | Issue |
|---|---|---|---|---|
${flagLines.join('\n')}
`;
writeFileSync('phase1-report.md', out);
writeFileSync('phase1-map.json', JSON.stringify({ map: mapJson, endurance: endJson, merges }, null, 2));
console.log(out);

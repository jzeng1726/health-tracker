/** Dump the numbers the app displays (same functions the UI calls), range = All. */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDataset } from '../src/core/ingest';
import { defaultConfig, applySeed } from '../src/core/config';
import { SEED_CONFIG } from '../src/core/seedConfig';
import { movingAverage, bodyweightStats, weeklyAverages } from '../src/core/bodyweight';
import { sessionsByExercise, muscleScores, exerciseProgress, weeklySets, mondayOf } from '../src/core/strength';
import { enduranceSessions, enduranceWeekly } from '../src/core/endurance';
const fx = (f: string) => JSON.parse(readFileSync(`fixtures/${f}`, 'utf8'));
const asFile = (j: any, m: string) => ({ id: j.id, name: j.title, modifiedTime: m, tabs: [{ title: j.tab, rows: j.rows }] });
const ds = buildDataset([asFile(fx('fall-cut-2026.json'), '2026-09-24T14:25:57Z'), asFile(fx('fb-week-01.json'), '2026-08-27T21:53:07Z'), asFile(fx('fb-weeks-2-4.json'), '2026-09-24T01:17:02Z')], applySeed(defaultConfig(), {}, SEED_CONFIG).config);
const ma = movingAverage(ds.bodyweight);
const byEx = sessionsByExercise(ds.sets);
const scores = muscleScores(byEx, ds.exercises, null);
const endS = enduranceSessions(ds.endurance, true);
// Plank is undated in the sheet: date it (as you would in Review) and read what the app parses
const cfg2 = applySeed(defaultConfig(), {}, SEED_CONFIG).config;
const plankKey = ds.review.find(r => r.kind === 'undated' && r.raw === '2:00')!.key!;
cfg2.dateAssignments[plankKey] = '2026-09-05';
const ds2 = buildDataset([asFile(fx('fall-cut-2026.json'), '2026-09-24T14:25:57Z'), asFile(fx('fb-week-01.json'), '2026-08-27T21:53:07Z'), asFile(fx('fb-weeks-2-4.json'), '2026-09-24T01:17:02Z')], cfg2);
const weeksRun = enduranceWeekly(endS.filter(x => x.type === 'run'));
const out = {
  plankSeconds: ds2.endurance.find(e => e.raw === '2:00')!.seconds,
  runMilesThisWeek: weeksRun.find(w => w.week === mondayOf('2026-09-24'))?.miles ?? 0,
  ma: Object.fromEntries(ma.map(p => [p.date, { ma: p.ma, partial: p.partial, raw: p.raw }])),
  stats: bodyweightStats(ma, null, 155),
  weeks: weeklyAverages(ds.bodyweight),
  sessions: Object.fromEntries([...byEx].map(([k, v]) => [k, v.map(s => ({ date: s.date, e1rm: s.e1rm, weight: s.weight, reps: s.reps, volume: s.volume, isPR: s.isPR, ref: s.ref }))])),
  progress: Object.fromEntries([...byEx].map(([k, v]) => [k, exerciseProgress(v, null).pct])),
  scores: scores.current,
  weeklySets: weeklySets(ds.sets, ds.endurance, ds.exercises, false, null),
  workoutsThisWeek: new Set([...ds.sets, ...ds.endurance].map(x => x.date).filter(d => mondayOf(d) === mondayOf('2026-09-24'))).size,
  endurance: ds.endurance.map(e => ({ date: e.date, exercise: e.exercise, raw: e.raw, weight: e.weight, seconds: e.seconds, distanceM: e.distanceM, steps: e.steps, round: e.round, ref: e.ref })),
  endSessions: endS,
  exercises: Object.fromEntries(Object.entries(ds.exercises).map(([k, v]) => [k, { primary: v.primary, secondary: v.secondary, kind: v.kind }])),
};
writeFileSync('/tmp/claude-0/-home-claude/5be6c9d4-424f-5e91-a0fc-6924490fe4ee/scratchpad/app-values.json', JSON.stringify(out, null, 1));
console.log('dumped', Object.keys(out.sessions).length, 'exercises');

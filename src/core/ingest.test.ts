import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { buildDataset } from './ingest';
import { defaultConfig, applySeed, type AppConfig } from './config';
import { SEED_CONFIG } from './seedConfig';
import type { SheetFile } from './model';
import { movingAverage, bodyweightStats, weeklyAverages } from './bodyweight';
import { sessionsByExercise, muscleScores, exerciseProgress, weeklySets } from './strength';
import { enduranceSessions } from './endurance';
import { classifyTab } from './classify';

const HAVE = existsSync('fixtures/fb-weeks-2-4.json');
const fx = (f: string) => (HAVE ? JSON.parse(readFileSync(`fixtures/${f}`, 'utf8')) : { id: f, title: f, tab: 'Sheet1', rows: [] });
const asFile = (j: any, modifiedTime: string): SheetFile => ({ id: j.id, name: j.title, modifiedTime, tabs: [{ title: j.tab, rows: j.rows }] });

const files: SheetFile[] = [
  asFile(fx('fall-cut-2026.json'), '2026-09-24T14:25:57Z'),
  asFile(fx('fb-week-01.json'), '2026-08-27T21:53:07Z'),
  asFile(fx('fb-weeks-2-4.json'), '2026-09-24T01:17:02Z'),
];
const config: AppConfig = applySeed(defaultConfig(), {}, SEED_CONFIG).config;
const ds = buildDataset(files, config);

describe('classification by headers, not names', () => {
  it.skipIf(!HAVE)('classifies each real sheet', () => {
    expect(ds.files.map(f => f.tabs[0].kind)).toEqual(['bodyweight', 'program-grid', 'program-grid']);
  });
  it('skips a formula-derived copy like ChartData', () => {
    const rows = [[{ f: 'Date' }, { f: 'Morning Weight' }, { f: 'Goal (155 lbs)' }],
      ...Array.from({ length: 5 }, (_, i) => [{ f: `8/${23 + i}`, n: 46257 + i, t: 'DATE', fx: true }, { f: '169', n: 169, fx: true }, { f: '155', n: 155, fx: true }])];
    expect(classifyTab({ title: 'ChartData', rows }, 'Fall Cut 2026').kind).toBe('derived');
  });
  it('recognises a flat workout log with a time column', () => {
    const rows = [[{ f: 'Date' }, { f: 'Exercise' }, { f: 'Weight (lb)' }, { f: 'Sets' }, { f: 'Reps' }, { f: 'Time' }, { f: 'Distance' }]];
    expect(classifyTab({ title: 'Log', rows }, 'anything').kind).toBe('workout-log');
  });
  it('unknown layout -> unknown (goes to Needs review)', () => {
    expect(classifyTab({ title: 'x', rows: [[{ f: 'foo' }, { f: 'bar' }], [{ f: '1' }, { f: '2' }]] }, 'misc').kind).toBe('unknown');
  });
});

describe.skipIf(!HAVE)('bodyweight (Fall Cut 2026) — hand-checked against the sheet', () => {
  const ma = movingAverage(ds.bodyweight);
  it('reads 33 weigh-ins 8/23 → 9/24 and ignores blank future dates', () => {
    expect(ds.bodyweight).toHaveLength(33);
    expect(ds.bodyweight[0]).toMatchObject({ date: '2026-08-23', weight: 169 });
    expect(ds.bodyweight.at(-1)).toMatchObject({ date: '2026-09-24', weight: 160.2 });
  });
  it('first 6 days are partial averages', () => {
    expect(ma.slice(0, 6).every(p => p.partial)).toBe(true);
    expect(ma[6].partial).toBe(false);
    expect(ma[1].ma).toBeCloseTo((169 + 168.9) / 2, 6);
  });
  it('7-day MA on 9/24 = (161.6+162.8+163.4+164+161.7+161.1+160.2)/7 = 162.114', () => {
    expect(ma.at(-1)!.ma).toBeCloseTo(1134.8 / 7, 6);
  });
  it('7-day MA on 8/29 = 1178.6/7 = 168.371', () => {
    expect(ma.find(p => p.date === '2026-08-29')!.ma).toBeCloseTo(1178.6 / 7, 6);
  });
  it('stats from the MA', () => {
    const s = bodyweightStats(ma, null, 155);
    expect(s.start).toBe(169);
    expect(s.totalLost).toBeCloseTo(169 - 1134.8 / 7, 6);
    expect(s.pctLost).toBeCloseTo((169 - 1134.8 / 7) / 169, 6);
    // MA 9/17 = (163.9+163+162.4+163.5+163.2+163.7+163.3)/7 = 1143/7
    expect(s.weeklyRate).toBeCloseTo(1143 / 7 - 1134.8 / 7, 6);
    expect(s.projectedDate).not.toBeNull();
  });
  it('Mon–Sun weekly averages', () => {
    const w = weeklyAverages(ds.bodyweight);
    expect(w[0]).toMatchObject({ weekStart: '2026-08-17', weekEnd: '2026-08-23', n: 1, avg: 169 });
    // Mon 8/24 – Sun 8/30
    expect(w[1].avg).toBeCloseTo((168.9 + 168.3 + 167.9 + 168.6 + 168.1 + 167.8 + 167.5) / 7, 6);
  });
});

describe.skipIf(!HAVE)('strength — merges, corrections, e1RM', () => {
  const byEx = sessionsByExercise(ds.sets);
  it('merges Seated Dip Machine into Machine Dips (mandatory Chest rule)', () => {
    expect(ds.exercises['seated dip machine']).toBeUndefined();
    const dips = byEx.get('machine dip')!;
    expect(dips.map(s => s.date)).toEqual(['2026-08-25', '2026-08-27', '2026-08-30', '2026-09-03', '2026-09-12', '2026-09-22']);
    expect(dips[0].e1rm).toBeCloseTo(195 * (1 + 10 / 30), 6); // 195x10-12 -> lower bound 10
    const p = exerciseProgress(dips, null);
    expect(p.pct).toBeCloseTo((210 * (1 + 13 / 30)) / (195 * (1 + 10 / 30)) - 1, 6);
  });
  it('applies the 13x9 -> 130x9 correction', () => {
    const v = byEx.get('v bar lat pulldown')!.find(s => s.date === '2026-08-30')!;
    expect(v.weight).toBe(130);
    expect(v.ref).toMatch(/C15 \(corrected\)/);
  });
  it('"c" merged into Kneeling Band Tri Ext (no logged data, no review item)', () => {
    expect(ds.review.find(r => r.title === 'c')).toBeUndefined();
  });
  it('Recline Curl confirmed Biceps; Clavicular Press still awaits review', () => {
    expect(ds.exercises['recline curl'].confidence).toBe('confirmed');
    expect(ds.review.find(r => r.kind === 'exercise' && r.exercise === 'clavicular press')).toBeDefined();
  });
  it('no leftover merge suggestions for approved pairs', () => {
    expect(ds.review.filter(r => r.kind === 'merge')).toHaveLength(0);
  });
  it('muscle scores exist for every muscle with logged data', () => {
    const { current } = muscleScores(byEx, ds.exercises, null);
    for (const m of ['Chest', 'Back', 'Triceps', 'Biceps', 'Shoulders', 'Quads', 'Calves', 'Hamstrings', 'Core', 'Overall'] as const)
      expect(current[m]).not.toBeNull();
  });
  it('weekly sets: L/R single-arm counts as one set', () => {
    const w = weeklySets(ds.sets, ds.endurance, ds.exercises, false, null);
    // week of Mon 8/24: lat raise 8/25 (1) + 8/27 (L/R = 1) + 8/30 (L/R = 1) = 3 Shoulders sets
    expect(w.find(x => x.week === '2026-08-24')!.Shoulders).toBe(3);
  });
});

describe.skipIf(!HAVE)('endurance — X:YY is minutes:seconds', () => {
  const sessions = enduranceSessions(ds.endurance, true);
  it('1 Mile Run 8/27 = 8:26 (506 s), pace 506 s/mi', () => {
    const run = sessions.find(s => s.type === 'run')!;
    expect(run).toMatchObject({ date: '2026-08-27', seconds: 506 });
    expect(run.paceSecPerMi).toBeCloseTo(506, 6);
  });
  it('Farmer carry 9/4: 70 lb/hand, 100 s + 60 s', () => {
    const c = sessions.find(s => s.type === 'farmer_carry')!;
    expect(c).toMatchObject({ date: '2026-09-04', weight: 70, seconds: 160, longestSeconds: 100, totalLoad: 140 });
    expect(c.loadTime).toBe(140 * 100 + 140 * 60);
  });
  it('Static holds 9/23: 93 s + 104 s at 80 lb', () => {
    const h = sessions.find(s => s.type === 'static_hold')!;
    expect(h).toMatchObject({ date: '2026-09-23', weight: 80, seconds: 197, longestSeconds: 104 });
  });
  it('Plank "2:00" (stored as 2 AM) is undated -> review, not charted', () => {
    const r = ds.review.find(x => x.kind === 'undated' && x.raw === '2:00');
    expect(r).toBeDefined();
    expect(ds.endurance.find(e => e.raw === '2:00')).toBeUndefined();
  });
  it('Plank once dated -> 120 s', () => {
    const cfg = structuredClone(config);
    cfg.dateAssignments[r0()] = '2026-09-05';
    const d2 = buildDataset(files, cfg);
    expect(d2.endurance.find(e => e.raw === '2:00')!.seconds).toBe(120);
    function r0() { return ds.review.find(x => x.kind === 'undated' && x.raw === '2:00')!.key!; }
  });
  it('walking lunges: 45x10 each = 20 steps', () => {
    const l = sessions.find(s => s.type === 'walking_lunge' && s.date === '2026-09-01')!;
    expect(l.steps).toBe(20);
  });
});

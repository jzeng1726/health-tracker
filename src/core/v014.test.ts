/** v0.1.4: gyms, sheet reading, typo check, migration, targets, plateaus, gym prep. No personal fixtures needed. */
import { describe, it, expect } from 'vitest';
import { buildDataset, findDuplicates, typoSuspects, autoMerges, gymForFile } from './ingest';
import { defaultConfig, migrateConfig, fnv1a, configFromRows, type AppConfig } from './config';
import type { SheetFile, StrengthSet } from './model';
import { sessionsByExercise, gymFactors, unifiedSessions, muscleScores, findPlateaus, nextTarget, repsToBeat, repRange } from './strength';
import { lossBand, bandStatus, movingAverage } from './bodyweight';
import { parseGrid } from './grid';
import { dayOptions, weeksFromName, currentProgram } from './prep';

const c = (f: string | number) => (typeof f === 'number' ? { f: String(f), n: f } : f ? { f, s: f, t: 'TEXT' } : {});
const sheet = (id: string, name: string, rows: (string | number)[][], modifiedTime = '2026-10-17T00:00:00Z'): SheetFile =>
  ({ id, name, modifiedTime, tabs: [{ title: 'Workouts', rows: rows.map(r => r.map(c)) }] });

const vacation = sheet('vac', 'Vacation Workout Tracker', [
  ['Date', 'Exercise', 'Sets', 'Load (lb)', 'Reps', 'Muscle Group'],
  ['2026-10-13', 'Tricep supported curls', 1, 40, 8, 'Biceps'],
  ['2026-10-13', 'Leg press', 1, 450, 15, 'Quads'],
  ['', 'Mystery machine thing', 1, 60, 12, 'Back'],          // date carries down; sheet says Back
  ['2026-10-16', 'Leg press', 1, 460, 15, 'Quads'],
]);
const home = sheet('home', 'Training Log', [
  ['Date', 'Exercise', 'Weight (lb)', 'Sets', 'Reps', 'Gym', 'RPE'],
  ['10/7/2026', 'Leg Press', 450, 1, 9, '', ''],
  ['10/9/2026', 'Leg Press', 455, 1, 9, '', 9],
  ['10/10/2026', 'Leg Press', 300, 1, 12, 'Hotel gym', 6],    // RPE 6 -> not used for conversion
  ['10/11/2026', 'Leg Press', 450, 1, 10, 'Gym B', ''],       // Gym column overrides the sheet
]);

describe('gyms', () => {
  const ds = buildDataset([home, vacation], defaultConfig());
  it('vacation sheets default to "Vacation gym"; Gym column overrides per row', () => {
    expect(gymForFile(vacation, defaultConfig())).toBe('Vacation gym');
    expect(ds.sets.filter(s => s.fileId === 'vac').every(s => s.gym === 'Vacation gym')).toBe(true);
    expect(ds.sets.find(s => s.date === '2026-10-11')!.gym).toBe('Gym B');
    expect(ds.gyms[0]).toBe('Training Station');
    expect(new Set(ds.gyms)).toEqual(new Set(['Training Station', 'Firehouse Gym', 'Vacation gym', 'Hotel gym', 'Gym B']));
  });
  it('Settings choice per sheet wins', () => {
    const cfg = defaultConfig(); cfg.gyms.bySheet.vac = 'Mom\'s gym';
    expect(buildDataset([vacation], cfg).sets.every(s => s.gym === 'Mom\'s gym')).toBe(true);
  });
  it('reads RPE column; carries the date down', () => {
    expect(ds.sets.find(s => s.date === '2026-10-09')!.rpe).toBe(9);
    expect(ds.sets.find(s => s.exercise === 'mystery machine thing')!.date).toBe('2026-10-13');
  });
  it('Muscle Group column decides when the name is unclear', () => {
    expect(ds.exercises['mystery machine thing']).toMatchObject({ primary: 'Back', confidence: 'high' });
    expect(ds.exercises['triceps supported curl'].primary).toBe('Biceps');
  });
  it('PRs and % change are per gym', () => {
    const byEx = sessionsByExercise(ds.sets);
    const lp = byEx.get('leg press')!;
    // first session at each gym is never a PR; 460 > 450 at the vacation gym is
    expect(lp.filter(s => s.isPR).map(s => `${s.gym} ${s.date}`)).toEqual(['Training Station 2026-10-09', 'Vacation gym 2026-10-16']);
  });
  it('conversion factor from the nearest all-out main-gym session (within 14 days)', () => {
    const byEx = sessionsByExercise(ds.sets);
    const f = gymFactors(byEx, {}, 'Training Station');
    const v = f.get('leg press|Vacation gym')!;
    // 10/13 vac 450x15 pairs with 10/9 home 455x9; 10/16 vac 460x15 pairs with 10/9 home → median of the two ratios
    const home9 = 455 * (1 + 9 / 30);
    const r1 = home9 / (450 * 1.5), r2 = home9 / (460 * 1.5);
    expect(v.factor).toBeCloseTo((r1 + r2) / 2, 6);
    expect(v.pairs).toBe(2);
    expect(f.get('leg press|Hotel gym')!.factor).toBeNull(); // only an RPE 6 set there
    const off = gymFactors(byEx, { 'leg press|Vacation gym': null }).get('leg press|Vacation gym')!;
    expect(off).toMatchObject({ factor: null, source: 'off' });
    const unified = unifiedSessions(byEx.get('leg press')!, f, 'Training Station');
    expect(unified.filter(u => u.converted).map(u => u.gym)).toContain('Vacation gym');
  });
  it('a gym that starts later does not drag the score toward 0%', () => {
    const byEx = sessionsByExercise(ds.sets);
    const sc = muscleScores(byEx, ds.exercises, '2026-10-07');
    const onVacDay = sc.series.Quads.find(p => p.date === '2026-10-13')!;
    // on 10/13 only the home leg press (10/7 -> 10/11 at different gyms ...) counts; the brand-new vacation one is left out
    expect(onVacDay.pct).toBeCloseTo((455 * (1 + 9 / 30)) / (450 * (1 + 9 / 30)) - 1, 6);
  });
});

describe('sheet reading', () => {
  it('a note under an exercise ("1 Higher pad position") is attached, not an exercise', () => {
    const rows = [
      ['FB B DAY', 'SETS / REPS', 'DATE & WEIGHT'], ['Lower Portion:', '', '10/7'],
      ['45 Degree Back Extensions', ' 1x8-10', '95x7'], ['1 Higher pad position', '', ''],
      ['Leg Press', ' 1x8-10', '450x9'],
    ].map(r => r.map(c));
    const e = parseGrid({ id: 'x', title: 'x', tab: 'Sheet1', modifiedYear: 2026, rows });
    expect(e.map(x => x.exercise)).toEqual(['45 Degree Back Extensions', 'Leg Press']);
    expect(e[0].extraNotes).toEqual(['1 Higher pad position']);
  });
  it('duplicate copies of a sheet are skipped (only logged results are compared)', () => {
    const grid = (id: string, results: string[]) => ({ id, name: id, modifiedTime: '2026-10-01T00:00:00Z', tabs: [{ title: 'Sheet1', rows: [
      ['FB A DAY', 'SETS / REPS', 'DATE & WEIGHT'], ['Prioritize:', '', '9/1'],
      ...['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => [`Lift ${n}`, ' 1x8-10', results[i] ?? '']),
    ].map(r => r.map(c)) }] });
    const a = grid('orig', ['100x8', '110x9', '120x10', '90x8', '80x12', '70x9']);
    const copy = grid('copy', ['100x8', '110x9', '120x10', '90x8', '80x12', '70x9']);
    const other = grid('next block', ['105x8', '115x9', '125x8', '95x8', '85x10', '75x9']); // same template, new results
    const dup = findDuplicates([a, copy, other]);
    expect(dup.size).toBe(1);
    expect([...dup.values()][0]).toBe(dup.has('copy') ? 'orig' : 'copy');
    const ds = buildDataset([a, copy, other], defaultConfig());
    expect(ds.files.find(f => dup.has(f.id))!.tabs[0].kind).toBe('duplicate');
    expect(ds.sets.filter(s => s.exercise === 'lift a')).toHaveLength(2); // orig + next block, not the copy
  });
  it('same words in another order merge automatically; "not the same" is respected', () => {
    const cfg = defaultConfig();
    const m = autoMerges(['chest press machine', 'machine chest press', 'mag grip lat pulldown', 'leg press'], cfg, n => (n === 'machine chest press' ? 5 : 1));
    expect(m.get('chest press machine')).toBe('machine chest press');
    cfg.rejectedMerges = ['chest press machine|machine chest press'];
    expect(autoMerges(['chest press machine', 'machine chest press'], cfg, () => 1).size).toBe(0);
  });
});

describe('typo check compares with the sessions around it', () => {
  const S = (date: string, weight: number): StrengthSet => ({ key: `f!t!C${date.slice(8)}`, ref: date, fileId: 'f', date, exercise: 'lat raise', weight, reps: 10, raw: `${weight}x10`, gym: 'Home gym' });
  it('fast real progress (30 → 40 → 70 → 90) is NOT a typo', () => {
    expect(typoSuspects([S('2026-08-25', 30), S('2026-08-27', 40), S('2026-08-30', 70), S('2026-09-03', 80), S('2026-09-08', 90)])).toHaveLength(0);
  });
  it('13 between two 130s is, with 130 suggested', () => {
    const t = typoSuspects([S('2026-08-27', 130), S('2026-08-30', 13), S('2026-09-03', 130)]);
    expect(t).toHaveLength(1);
    expect(t[0].suggestion).toBe(130);
  });
});

describe('config migration', () => {
  it('removes the bad 30 → 300 lateral-raise fix (Week 01, C3) and its ignore entry, once', () => {
    const W01 = 'week01-id';
    const cfg: AppConfig = { ...defaultConfig(), version: 1 };
    // 73077d87 = hash of the Week 01 sheet id (the id itself never appears in this public source)
    cfg.corrections = [
      { sheetIdHash: '73077d87', cell: 'C3', from: '30x12-15', to: '300x12-15', note: 'fixed in Review' },
      { sheetIdHash: '73077d87', cell: 'L12', from: '8.26', to: '8:26' },
      { sheetId: W01, cell: 'C3', from: '30x12-15', to: '300x12-15' }, // other sheet: untouched
    ];
    const m = migrateConfig(cfg);
    expect(m.config.corrections.map(x => x.cell)).toEqual(['L12', 'C3']);
    expect(m.config.version).toBe(3);
    expect(m.changed).toContain('corrections');
    expect(migrateConfig(m.config).changed).toHaveLength(0);
  });
  it('older _config without a gyms row gets defaults', () => {
    const { config } = configFromRows([{ key: 'settings', value: '{"refreshMinutes":5}', updatedAt: 'x', device: '' }]);
    expect(config.gyms.defaultGym).toBe('Training Station');
    expect(config.settings.lossRateMinPct).toBe(0.5);
    expect(config.settings.weeklySetsMax).toBe(10);
  });
});

describe('targets', () => {
  it('loss band compounds from the start of the range', () => {
    const b = lossBand(170, 0, [0, 7, 14], 0.5, 1);
    expect(b[0]).toEqual({ day: 0, hi: 170, lo: 170 });
    expect(b[1].hi).toBeCloseTo(170 * 0.995, 9);
    expect(b[2].lo).toBeCloseTo(170 * 0.99 ** 2, 9);
    expect(bandStatus(0.007, 0.5, 1)).toBe('in');
    expect(bandStatus(0.002, 0.5, 1)).toBe('slow');
    expect(bandStatus(0.013, 0.5, 1)).toBe('fast');
    expect(bandStatus(-0.003, 0.5, 1)).toBe('gaining');
  });
  it('7-day average reports how many weigh-ins it used', () => {
    const ma = movingAverage([{ date: '2026-10-01', weight: 160, fileId: 'a', ref: '' }, { date: '2026-10-08', weight: 161, fileId: 'a', ref: '' }]);
    expect(ma.at(-1)!.n).toBe(1);
  });
});

describe('plateaus and double progression', () => {
  const sess = (dates: [string, number, number][]) => sessionsByExercise(dates.map(([date, w, r], i) => ({ key: `k${i}`, ref: '', fileId: 'f', date, exercise: 'row', weight: w, reps: r, raw: '', gym: 'Home gym' })));
  it('3 sessions without a new best = plateau (only if still training it)', () => {
    const b = sess([['2026-09-01', 140, 8], ['2026-09-05', 140, 7], ['2026-09-09', 140, 6], ['2026-09-13', 140, 7]]);
    expect(findPlateaus(b, '2026-09-20')).toHaveLength(1);
    expect(findPlateaus(b, '2026-12-01')).toHaveLength(0);
    const up = sess([['2026-09-01', 140, 8], ['2026-09-05', 140, 9], ['2026-09-09', 145, 8], ['2026-09-13', 145, 9]]);
    expect(findPlateaus(up, '2026-09-20')).toHaveLength(0);
  });
  it('top of the range -> add weight; inside -> one more rep; PR set beats est. 1RM', () => {
    const top = sess([['2026-10-07', 225, 12]]).get('row')![0];
    expect(nextTarget(top, '1x8-10')).toMatchObject({ weight: 230, reps: 8, text: '230 × 8+', prText: '225 × 13' });
    const mid = sess([['2026-10-07', 120, 8]]).get('row')![0];
    expect(nextTarget(mid, ' 1x8-10')).toMatchObject({ text: '120 × 9' });
    expect(repsToBeat(140, 140 * (1 + 9 / 30))).toBe(10);
    expect(repRange('2 x 8 - 10')).toEqual({ lo: 8, hi: 10 });
  });
});

describe('gym prep picks the next day from the coach sheet', () => {
  const block = (dayLabel: string, headerRow: number, exCol: number, logged: number) => ({ dayLabel, headerRow, exCol, date: logged ? '2026-10-07' : null, items: [], logged });
  const prog = { fileId: 'p', fileName: 'FB - Jeffrey Zeng - Weeks 5,6,7', modifiedTime: '2026-10-11T00:00:00Z', blocks: [
    block('FB B DAY', 1, 0, 10), block('FB A DAY', 1, 3, 0), block('FB B DAY', 1, 6, 0), block('CORE / ENDURANCE DAY', 1, 9, 0),
    block('FB A DAY', 29, 0, 0), block('FB B DAY', 29, 3, 0),
  ] };
  it('next = first unlogged strength block after the last logged one', () => {
    const o = dayOptions(prog);
    expect(o[0]).toMatchObject({ label: 'FB A DAY', isNext: true, week: 5 });
    expect(o.find(x => x.label === 'FB B DAY')!.block.exCol).toBe(6);
  });
  it('reads week numbers from the file name; newest active program wins', () => {
    expect(weeksFromName('FB - Jeffrey Zeng - Weeks 5,6,7')).toEqual([5, 6, 7]);
    expect(weeksFromName('FB - Jeffrey Zeng - Week 01')).toEqual([1]);
    const older = { ...prog, fileId: 'old', blocks: [{ ...prog.blocks[0], date: '2026-10-02' }] };
    expect(currentProgram([older, prog])!.fileId).toBe('p');
  });
});

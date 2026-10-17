/** v0.1.5: clean names, gym rename, notes → new baselines, life log. No personal fixtures needed. */
import { describe, it, expect } from 'vitest';
import { cleanExerciseName } from './names';
import { normalizeExerciseName } from './muscles';
import { readNote, readLifeNote } from './notes';
import { buildDataset, normalizeGym } from './ingest';
import { defaultConfig, migrateConfig, type AppConfig } from './config';
import { sessionsByExercise, chainedPct, muscleScores, exerciseProgress, findPlateaus } from './strength';
import { classifyTab } from './classify';
import type { SheetFile } from './model';

const c = (f: string | number) => (typeof f === 'number' ? { f: String(f), n: f } : f ? { f, s: f, t: 'TEXT' } : {});
const file = (id: string, name: string, tabs: [string, (string | number)[][]][], extra: Partial<SheetFile> = {}): SheetFile =>
  ({ id, name, modifiedTime: '2026-10-17T00:00:00Z', canEdit: true, tabs: tabs.map(([title, rows]) => ({ title, rows: rows.map(r => r.map(c)) })), ...extra });

describe('clean exercise names', () => {
  it.each([
    ['Rope pushdown', 'Rope Pushdown'],
    ['Alternating DB hammercurls', 'Alternating DB Hammer Curls'],
    ['Wide grip latpulldown machine', 'Wide Grip Lat Pulldown Machine'],
    ['Laying Leg Curl', 'Lying Leg Curl'],
    ['Weighted Situps', 'Weighted Sit-Ups'],
    ['Cable Extention', 'Cable Extension'],
    ['Lat pulldwon', 'Lat Pulldown'],
    ['T-Bar (Wide Grip)', 'T-Bar (Wide Grip)'],
    ['Seated Toe Press (Calves)', 'Seated Toe Press (Calves)'],
    ['Low Row-double arm', 'Low Row-Double Arm'],
    ['Quad Extensions ', 'Quad Extensions'],
    ['Recline Curl', 'Recline Curl'],          // a real word one letter from "decline" is NOT "corrected"
    ['45 Degree Back Extensions', '45 Degree Back Extensions'],
  ])('%s -> %s', (a, b) => expect(cleanExerciseName(a)).toBe(b));
  it('is idempotent and keeps the same exercise identity', () => {
    for (const x of ['Rope pushdown', 'Alternating DB hammercurls', 'Weighted Situps', 'Mag GripLat Pulldown', 'DB lateral raises']) {
      const y = cleanExerciseName(x);
      expect(cleanExerciseName(y)).toBe(y);
      expect(normalizeExerciseName(y)).toBe(normalizeExerciseName(x));
    }
  });
});

describe('reading notes (plain English)', () => {
  it.each([
    ['moved to higher position', ['position']],
    ['1 Higher pad position', ['position']],
    ['seat on 4', ['position']],
    ['I changed my grip', ['grip']],
    ['used straps', ['straps']],
    ['(no straps and different form)', ['straps', 'form']],
    ['form changed, less weight and reps', ['form']],
    ['switched to other way and x8', ['machine']],
    ['used the hammer strength machine instead', ['machine']],
  ])('"%s" = setup change (%s)', (t, tags) => expect(readNote(t)).toMatchObject({ tags, setupChange: true }));
  it.each([
    ['Cldve done more but grip gave out', 'grip-limited'],
    ['felt tired today', 'fatigue'],
    ['(lost count)', 'count'],
  ])('"%s" is a limit, not a setup change', (t, tag) => expect(readNote(t)).toMatchObject({ tags: [tag], setupChange: false }));
  it('"same grip as last time" is not a change', () => expect(readNote('same grip as last time').setupChange).toBe(false));
  it('life notes', () => {
    expect(readLifeNote('going on vacation')).toEqual(['vacation']);
    expect(readLifeNote('sick this week')).toEqual(['sick']);
  });
});

describe('a setup change starts a new baseline (not "weaker")', () => {
  const S = (date: string, w: number, r: number) => ({ date, exercise: 'row', e1rm: w * (1 + r / 30), weight: w, reps: r, volume: 0, sets: 1, isPR: false, isWeightPR: false, ref: '', gym: 'G' });
  const list = [S('2026-09-01', 140, 10), S('2026-09-05', 150, 10), S('2026-09-09', 120, 8), S('2026-09-13', 125, 9)];
  it('without the note the drop counts as weaker; with it, progress carries over', () => {
    const plain = chainedPct(list);
    expect(plain[2]).toBeLessThan(0);
    const ch = chainedPct(list, ['2026-09-09']);
    expect(ch[1]).toBeCloseTo(150 / 140 - 1, 9);
    expect(ch[2]).toBeCloseTo(ch[1], 9);                                       // the change day keeps the level
    expect(ch[3]).toBeCloseTo((150 / 140) * ((125 * 1.3) / (120 * (1 + 8 / 30))) - 1, 9);
  });
  it('ingest turns a note into a change date, and scores use it', () => {
    const log = file('log', 'Training Log', [['Log', [
      ['Date', 'Exercise', 'Weight (lb)', 'Sets', 'Reps', 'Notes'],
      ['9/1/2026', 'T-Bar Row', 140, 1, 10, ''],
      ['9/5/2026', 'T-Bar Row', 150, 1, 10, ''],
      ['9/9/2026', 'T-Bar Row', 120, 1, 8, 'changed my grip, used straps'],
      ['9/13/2026', 'T-Bar Row', 125, 1, 9, ''],
    ]]]);
    const ds = buildDataset([log], defaultConfig());
    expect(ds.notes).toHaveLength(1);
    expect(ds.notes[0]).toMatchObject({ date: '2026-09-09', text: 'changed my grip, used straps', setupChange: true });
    expect(ds.changes['t bar row|Training Station']).toEqual(['2026-09-09']);
    const byEx = sessionsByExercise(ds.sets);
    const p = exerciseProgress(byEx.get('t bar row')!, null, undefined, ds.changes['t bar row|Training Station']);
    expect(p.pct!).toBeGreaterThan(0.07);
    expect(muscleScores(byEx, ds.exercises, null, undefined, ds.changes).current.Back!).toBeGreaterThan(0.07);
    expect(muscleScores(byEx, ds.exercises, null).current.Back!).toBeLessThan(0);
  });
  it('plateau count restarts at a setup change', () => {
    const byEx = new Map([['row', [S('2026-09-01', 150, 10), S('2026-09-05', 150, 9), S('2026-09-09', 150, 8), S('2026-09-13', 150, 8), S('2026-09-17', 150, 9)]]]);
    expect(findPlateaus(byEx as any, '2026-09-20')).toHaveLength(1);
    expect(findPlateaus(byEx as any, '2026-09-20', 3, { 'row|G': ['2026-09-13'] })).toHaveLength(0);
  });
});

describe('gyms: Training Station + Firehouse Gym', () => {
  const cfg = migrateConfig({ ...defaultConfig(), version: 2 }).config;
  it('renames Home gym and adds Firehouse Gym (once)', () => {
    expect(cfg.gyms.defaultGym).toBe('Training Station');
    expect(cfg.gyms.names).toContain('Firehouse Gym');
    expect(migrateConfig(cfg).changed).toHaveLength(0);
  });
  it('old spellings map to the new names', () => {
    expect(normalizeGym('Home gym', cfg)).toBe('Training Station');
    expect(normalizeGym('firehouse', cfg)).toBe('Firehouse Gym');
    expect(normalizeGym('FIREHOUSE GYM', cfg)).toBe('Firehouse Gym');
    expect(normalizeGym('Planet Fitness', cfg)).toBe('Planet Fitness');
  });
  it('renames/merges Recline Curl, Strict Alternating Hammer Curl, T-Bar (Wide Grip)', () => {
    const grid = file('coach', 'FB - Weeks', [['Sheet1', [
      ['FB A DAY', 'SETS / REPS', 'DATE & WEIGHT'], ['Upper Portion:', '', '9/1'],
      ['Recline Curl', ' 1x8-10', '40x8'], ['T-Bar (Wide Grip)', ' 1x8-10', '140x7'], ['Strict Alternating Hammer Curl ', '1x8-10', '40x6'],
    ]]], { viaShortcut: true, canEdit: false });
    const vac = file('vac', 'Vacation Workout Tracker', [['Workouts', [
      ['Date', 'Exercise', 'Sets', 'Load (lb)', 'Reps'], ['2026-10-13', 'Tricep supported curls', 1, 40, 8], ['2026-10-13', 'Rope pushdown', 1, 100, 13],
    ]]]);
    const ds = buildDataset([grid, vac], cfg);
    expect(ds.exercises['triceps supported curl'].display).toBe('Tricep Supported Curls');
    expect(ds.sets.filter(s => s.exercise === 'triceps supported curl')).toHaveLength(2);
    expect(ds.exercises['narrow grip t bar row'].display).toBe('Narrow Grip T-Bar Row');
    expect(ds.exercises['triceps supported alternating hammer curl'].display).toBe('Tricep Supported Alternating Hammer Curls');
    expect(ds.exercises['rope pushdown'].display).toBe('Rope Pushdown');
    // only YOUR sheet gets rewritten, only the name cell
    expect(ds.nameFixes.every(f => f.fileId === 'vac')).toBe(true);
    expect(ds.nameFixes.map(f => `${f.from} -> ${f.to}`)).toEqual(['Tricep supported curls -> Tricep Supported Curls', 'Rope pushdown -> Rope Pushdown']);
  });
});

describe('Life Log tab', () => {
  const tab = { title: 'Life Log', rows: [['Date', 'Until', 'Note', 'Logged from'], ['10/12/2026', '10/19/2026', 'Going on vacation', 'mac'], ['10/20/2026', '', 'sick this week', 'mac']].map(r => r.map(c)) };
  it('is recognised by its headers', () => expect(classifyTab(tab, 'Training Log').kind).toBe('life-log'));
  it('is read with dates, ranges and tags', () => {
    const ds = buildDataset([{ id: 'tl', name: 'Training Log', modifiedTime: '2026-10-20T00:00:00Z', tabs: [tab] }], defaultConfig() as AppConfig);
    expect(ds.life).toEqual([
      expect.objectContaining({ date: '2026-10-20', text: 'sick this week', tags: ['sick'] }),
      expect.objectContaining({ date: '2026-10-12', until: '2026-10-19', text: 'Going on vacation', tags: ['vacation'] }),
    ]);
  });
});

describe('migrating a v0.1.4 config that still says "Home gym"', () => {
  it('renames the main gym everywhere it is stored', () => {
    const old = { ...defaultConfig(), version: 2 };
    old.gyms = { defaultGym: 'Home gym', names: [], bySheet: { a: 'Home gym', b: 'Vacation gym' }, factorOverrides: { 'leg press|Home gym': 1.1 } };
    const m = migrateConfig(old).config;
    expect(m.gyms.defaultGym).toBe('Training Station');
    expect(m.gyms.bySheet).toEqual({ a: 'Training Station', b: 'Vacation gym' });
    expect(m.gyms.factorOverrides).toEqual({ 'leg press|Training Station': 1.1 });
    expect(m.gyms.names).toEqual(['Firehouse Gym']);
    expect(normalizeGym('home gym', m)).toBe('Training Station');
  });
});

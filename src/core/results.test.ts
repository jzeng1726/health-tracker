import { describe, it, expect } from 'vitest';
import { parseResult } from './results';

const sets = (s: string, o?: any) => parseResult(s, o).sets;

describe('parseResult — every format seen in Jeffrey\'s sheets', () => {
  it('210x10.5', () => expect(sets('210x10.5')).toEqual([{ weight: 210, reps: 10.5, seconds: null, repsRaw: undefined }]));
  it('210x8.25', () => expect(sets('210x8.25')[0].reps).toBe(8.25));
  it('L-40x20 R-40x20', () => expect(sets('L-40x20 R-40x20').map(s => [s.side, s.weight, s.reps])).toEqual([['L', 40, 20], ['R', 40, 20]]));
  it('L 40x17 R40x17', () => expect(sets('L 40x17 R40x17').map(s => [s.side, s.weight, s.reps])).toEqual([['L', 40, 17], ['R', 40, 17]]));
  it('50 Lx20 Rx20', () => expect(sets('50 Lx20 Rx20').map(s => [s.side, s.weight, s.reps])).toEqual([['L', 50, 20], ['R', 50, 20]]));
  it('L-70x15.5 R-70x16', () => expect(sets('L-70x15.5 R-70x16').map(s => s.reps)).toEqual([15.5, 16]));
  it('150x15,10,8 -> 3 sets', () => expect(sets('150x15,10,8').map(s => s.reps)).toEqual([15, 10, 8]));
  it('55x12-13 -> lower bound 12', () => expect(sets('55x12-13')[0]).toMatchObject({ weight: 55, reps: 12, repsRaw: '12-13' }));
  it('110x10.5-75 -> 10.5 + flag', () => {
    const r = parseResult('110x10.5-75');
    expect(r.sets[0].reps).toBe(10.5);
    expect(r.flags.join()).toMatch(/unclear/);
  });
  it('140x6.5-7 (no straps and different form)', () => {
    const r = parseResult('140x6.5-7 (no straps and different form)');
    expect(r.sets[0]).toMatchObject({ weight: 140, reps: 6.5 });
    expect(r.note).toBe('(no straps and different form)');
  });
  it('37.5x9 higher seat pos.', () => expect(parseResult('37.5x9 higher seat pos.').note).toBe('higher seat pos'));
  it('345x5, switched to other way and x8 -> flags extra set', () => {
    const r = parseResult('345x5, switched to other way and x8');
    expect(r.sets).toHaveLength(1);
    expect(r.flags.join()).toMatch(/another set/);
  });
  it('45x10 each -> perSide', () => expect(sets('45x10 each')[0]).toMatchObject({ weight: 45, reps: 10, perSide: true }));
  it('R1-45x8 R2-45x8', () => expect(sets('R1-45x8 R2-45x8').map(s => [s.round, s.weight, s.reps])).toEqual([[1, 45, 8], [2, 45, 8]]));
  it('R1-70x1:40m R2-70x1:00m -> 100 s, 60 s', () =>
    expect(sets('R1-70x1:40m R2-70x1:00m').map(s => [s.round, s.weight, s.seconds])).toEqual([[1, 70, 100], [2, 70, 60]]));
  it('R1. 80x1:33  R2. 80x1:44 -> 93 s, 104 s', () =>
    expect(sets('R1. 80x1:33  R2. 80x1:44').map(s => [s.round, s.weight, s.seconds])).toEqual([[1, 80, 93], [2, 80, 104]]));
  it('Skipped-pain on warmup', () => expect(parseResult('Skipped-pain on warmup')).toMatchObject({ skipped: true, empty: true }));
  it('195x10-12 (lost count)', () => expect(parseResult('195x10-12 (lost count)')).toMatchObject({ note: '(lost count)' }));
  it('bodyweight 1x8 -> 1 set x 8', () => expect(sets('1x8', { bodyweight: true })).toEqual([{ weight: null, reps: 8, seconds: null }]));
  it('free text note only', () => expect(parseResult('Cldve done more but grip gave out').empty).toBe(true));
});

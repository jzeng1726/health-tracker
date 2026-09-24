import { describe, it, expect } from 'vitest';
import { parseDuration, parseDurationCell, formatDuration, parseDistance } from './time';

const sec = (s: string, u?: any) => parseDuration(s, u).seconds;

describe('X:YY is always minutes:seconds', () => {
  it.each([
    ['1:30', 90], ['0:45', 45], ['12:05', 725], ['2:00', 120], ['1:40', 100],
    ['1:00', 60], ['1:33', 93], ['1:44', 104], ['8:26', 506], ['59:59', 3599],
    ['90:00', 5400], ['1:40m', 100], ['1:40 min', 100], ['2:00 AM', 120], ['1:30 PM', 90],
  ])('%s -> %i s', (input, expected) => expect(sec(input)).toBe(expected));

  it('never treats 1:30 as 1.5 hours or a clock time', () => {
    expect(sec('1:30')).not.toBe(5400);
    expect(sec('1:30')).toBe(90);
  });
});

describe('H:MM:SS is hours:minutes:seconds', () => {
  it.each([['1:05:20', 3920], ['0:08:26', 506], ['2:00:00', 7200]])('%s -> %i', (i, e) => expect(sec(i)).toBe(e));
  it('flags "1:30:00 AM" (Sheets clock conversion) with min:sec guess', () => {
    const r = parseDuration('1:30:00 AM');
    expect(r.ambiguous).toBe(true);
    expect(r.guess).toBe(90);
  });
});

describe('unit forms', () => {
  it.each([
    ['90s', 90], ['90 sec', 90], ['45 seconds', 45], ['2 min', 120], ['2m', 120],
    ['2m30s', 150], ['1h 5m', 3900], ['1 hour 5 minutes', 3900], ['1.5 min', 90],
  ])('%s -> %i', (i, e) => expect(sec(i)).toBe(e));
});

describe('bare numbers use header unit, else flagged', () => {
  it('seconds header', () => expect(sec('90', 'seconds')).toBe(90));
  it('minutes header', () => expect(sec('2', 'minutes')).toBe(120));
  it('no header -> ambiguous', () => expect(parseDuration('90').ambiguous).toBe(true));
  it('"8.26" -> ambiguous with 8:26 guess', () => {
    const r = parseDuration('8.26');
    expect(r.ambiguous).toBe(true);
    expect(r.guess).toBe(506);
  });
  it('1:75 -> ambiguous', () => expect(parseDuration('1:75').ambiguous).toBe(true));
});

describe('Sheets cells', () => {
  it('Plank "2:00" stored as TIME 02:00 (serial 0.08333) -> 120 s, not 7200', () => {
    const r = parseDurationCell({ f: '2:00', n: 2 / 24, t: 'TIME' });
    expect(r.seconds).toBe(120);
  });
  it('typed 1:30 stored as TIME 01:30 with display "1:30" -> 90 s', () => {
    expect(parseDurationCell({ f: '1:30', n: 1.5 / 24, t: 'TIME' }).seconds).toBe(90);
  });
  it('display "1:30:00" on a TIME cell -> flagged, guess 90', () => {
    const r = parseDurationCell({ f: '1:30:00', n: 1.5 / 24, t: 'TIME' });
    expect(r.ambiguous).toBe(true);
    expect(r.guess).toBe(90);
  });
  it('display "1:30:00 AM" on a TIME cell -> flagged, guess 90', () => {
    const r = parseDurationCell({ f: '1:30:00 AM', n: 1.5 / 24, t: 'TIME' });
    expect(r.ambiguous).toBe(true);
    expect(r.guess).toBe(90);
  });
  it('text cell "1:33" -> 93', () => expect(parseDurationCell({ f: '1:33', s: '1:33', t: 'TEXT' }).seconds).toBe(93));
});

describe('formatDuration', () => {
  it.each([[90, '1:30'], [45, '0:45'], [725, '12:05'], [3920, '1:05:20'], [3600, '1:00:00']])('%i -> %s', (s, e) =>
    expect(formatDuration(s)).toBe(e));
});

describe('distance', () => {
  it('1 mile', () => expect(parseDistance('1 mile').meters).toBeCloseTo(1609.344));
  it('5k', () => expect(parseDistance('5k').meters).toBe(5000));
  it('40 yd', () => expect(parseDistance('40 yd').meters).toBeCloseTo(36.576));
  it('100 ft', () => expect(parseDistance('100ft').meters).toBeCloseTo(30.48));
  it('20 steps', () => expect(parseDistance('20 steps')).toMatchObject({ value: 20, unit: 'steps', meters: null }));
  it('bare number w/o header -> ambiguous', () => expect(parseDistance('400').ambiguous).toBe(true));
  it('bare number with header', () => expect(parseDistance('400', 'm').meters).toBe(400));
});

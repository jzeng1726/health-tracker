import { describe, it, expect } from 'vitest';
import { detectMuscles, normalizeExerciseName } from './muscles';

const p = (n: string) => detectMuscles(n);

describe('normalization', () => {
  it.each([
    ['DB Bench Press', 'dumbbell bench press'],
    ['BB Row', 'barbell row'],
    ['45° Back Extension', '45 degree back extension'],
    ['45 degree back extension', '45 degree back extension'],
    ['45deg Hyperextension', '45 degree hyperextension'],
    ['45-degree back extensions', '45 degree back extension'],
    ['Kneeling Band Supported Tri Ext', 'kneeling band supported triceps extension'],
    ['Quad Extensions ', 'quad extension'],
    ['Farmers Carries', 'farmer carry'],
  ])('%s -> %s', (a, b) => expect(normalizeExerciseName(a)).toBe(b));
});

describe('MANDATORY rules', () => {
  it.each(['Machine Chest Press', 'Machine Press', 'Chest Press Machine', 'Incline Machine Press', 'Seated Machine Press'])(
    '%s -> Chest; Triceps+Shoulders secondary', n => {
      expect(p(n)).toMatchObject({ primary: 'Chest', secondary: ['Triceps', 'Shoulders'], source: 'mandatory', confidence: 'high' });
    });
  it.each(['Machine Shoulder Press', 'Overhead Press Machine', 'Shoulder Press Machine'])('%s is NOT chest (has shoulder/overhead)', n => {
    expect(p(n).primary).toBe('Shoulders');
  });
  it.each(['Leg Press Machine', 'Leg Press'])('%s stays Quads', n => expect(p(n).primary).toBe('Quads'));
  it.each(['Machine Dips', 'Seated Dip Machine', 'Dips', 'Weighted Dips', 'Tricep Dips', 'Bench Dips', 'Assisted Dip'])(
    '%s -> Chest; Triceps secondary', n => {
      expect(p(n)).toMatchObject({ primary: 'Chest', secondary: ['Triceps'], source: 'mandatory' });
    });
  it.each(['45 Degree Back Extensions', '45° Hyperextension', '45deg back extension', '45-degree back extension'])(
    '%s -> Hamstrings; Back secondary', n => {
      expect(p(n)).toMatchObject({ primary: 'Hamstrings', secondary: ['Back'], source: 'mandatory' });
    });
});

describe('most-specific match wins', () => {
  it('"back extension" is not Back', () => expect(p('Back Extension').primary).toBe('Hamstrings'));
  it('"leg curl" is not Biceps', () => expect(p('Lying Leg Curl').primary).toBe('Hamstrings'));
  it('"Back Supported Tricep Ext" is Triceps, not back extension', () => expect(p('Back Supported Tricep Ext').primary).toBe('Triceps'));
  it('"upright row" is Shoulders, not Back', () => expect(p('Upright Row').primary).toBe('Shoulders'));
  it('"rear delt fly" is Shoulders, not Chest', () => expect(p('Rear Delt Fly').primary).toBe('Shoulders'));
  it('"close-grip bench" is Triceps w/ Chest secondary', () => expect(p('Close-Grip Bench Press')).toMatchObject({ primary: 'Triceps', secondary: ['Chest'] }));
  it('"romanian deadlift" is Hamstrings', () => expect(p('Romanian Deadlift').primary).toBe('Hamstrings'));
  it('"deadlift" is Back w/ Hamstrings', () => expect(p('Deadlift')).toMatchObject({ primary: 'Back', secondary: ['Hamstrings'] }));
  it('"lat raise" is Shoulders, not Back', () => expect(p('Single Arm Lat Raise').primary).toBe('Shoulders'));
  it('"toe press (calves)" is Calves, not Chest', () => expect(p('Seated Toe Press (Calves)').primary).toBe('Calves'));
  it('"nordic curl" is Hamstrings', () => expect(p('Nordic Curl').primary).toBe('Hamstrings'));
  it('"walking lunge" is endurance', () => expect(p('Walking Lunges')).toMatchObject({ kind: 'endurance', enduranceType: 'walking_lunge' }));
  it('"hanging leg raise" is Core', () => expect(p('Hanging Leg Raises').primary).toBe('Core'));
});

describe('confidence', () => {
  it('generic "curl" alone -> low', () => expect(p('Recline Curl').confidence).toBe('low'));
  it('generic "press" alone -> low', () => expect(p('Clavicular Press').confidence).toBe('low'));
  it('unknown -> none', () => expect(p('c').confidence).toBe('none'));
  it('known phrase -> high', () => expect(p('Hammer Curl').confidence).toBe('high'));
});

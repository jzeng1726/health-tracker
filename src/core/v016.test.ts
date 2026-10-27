/** v0.1.6: exercise library tabs (muscle-group columns) are recognised, not sent to the column mapper. */
import { describe, it, expect } from 'vitest';
import { buildDataset } from './ingest';
import { defaultConfig } from './config';
import { classifyTab, detectExerciseList, isMuscleHeading } from './classify';
import type { SheetFile } from './model';

const c = (f: string | number) => (typeof f === 'number' ? { f: String(f), n: f } : f ? { f, s: f, t: 'TEXT' } : {});
const file = (id: string, name: string, tabs: [string, (string | number)[][]][]): SheetFile =>
  ({ id, name, modifiedTime: '2026-10-27T00:00:00Z', canEdit: true, tabs: tabs.map(([title, rows]) => ({ title, rows: rows.map(r => r.map(c)) })) });

// Same layout as the Firehouse Gym "Exercises" tab: note row, headings, lists, plus a helper column N
const exercises: string[][] = [
  ['➕  ADD AN EXERCISE: type it in the blue box under its muscle group. It shows up in the Log dropdown automatically, sorted by muscle group.'],
  ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes / Hips', 'Calves', 'Core', 'Cardio', 'Other'],
  ['Bench Press', 'Chest Supported Row', 'DB Lateral Raises', 'Alternating DB Hammer Curls', 'Overhead Tricep Extension', 'Leg Extensions', 'Leg Curls', 'Hip Abductor', 'Calf Raise', 'Leg Raises', 'Incline Walk', '', '', 'Bench Press'],
  ['High to Low Cable Fly', 'High to Low Row', 'Rear Delt Fly', 'Cable Curls', 'Rope Pushdown', 'Leg Press', 'Lying Leg Curl', 'Hip Adductor', '', 'Weighted Sit-Ups', 'Treadmill Walk', '', '', 'High to Low Cable Fly'],
  ['Incline Atlantis Press', 'Lat Pulldown', '', 'Hammer Curls', 'Single Cable Tricep Pushdown', '', '', 'Hip Thrust', '', '', '', '', '', 'Incline Atlantis Press'],
  ['Pec Deck', 'T-Bar Row', '', 'Tricep Supported Hammer Curls', 'Weighted Dips', '', '', '', '', '', '', '', '', 'Pec Deck'],
  ['', 'Back Extension', '', '', '', '', '', '', '', '', '', '', '', 'Back Extension'],
];
const log: (string | number)[][] = [
  ['Date', 'Exercise', 'Weight (lb)', 'Sets', 'Reps'],
  ['2026-10-19', 'DB Lateral Raises', 20, 1, 26],
  ['', 'Bench Press', 135, 1, 12],
  ['', 'Tricep Supported Hammer Curls', 30, 1, 9],
  ['2026-10-20', 'Lat Pulldown', 120, 1, 9],
];

describe('exercise library tab', () => {
  it('recognises muscle-group headings', () => {
    for (const h of ['Chest', 'Glutes / Hips', 'Rear Delts', 'Upper Back', 'Core']) expect(isMuscleHeading(h)).toBe(true);
    for (const h of ['Bench Press', 'Date', 'Exercise', 'Cardio', 'Leg Press', 'Lat Pulldown', 'Upper']) expect(isMuscleHeading(h)).toBe(false);
  });

  it('classifies the Exercises tab as an exercise list, not "unknown"', () => {
    const f = file('fh', 'Firehouse Gym', [['Log', log], ['Exercises', exercises]]);
    expect(classifyTab(f.tabs[1], f.name).kind).toBe('exercise-list');
    expect(classifyTab(f.tabs[0], f.name).kind).toBe('workout-log');
    const list = detectExerciseList(f.tabs[1].rows)!;
    expect(list.headerRow).toBe(1);
    expect(list.entries.find(e => e.exercise === 'Hip Thrust')?.group).toBe('Glutes / Hips');
    expect(list.entries.some(e => e.exercise === 'Incline Walk')).toBe(false); // Cardio isn't a muscle column
  });

  it('creates no "needs column mapping" review item and logs nothing from the list', () => {
    const ds = buildDataset([file('fh', 'Firehouse Gym', [['Log', log], ['Exercises', exercises]])], defaultConfig());
    expect(ds.review.filter(r => r.kind === 'sheet')).toHaveLength(0);
    expect(ds.files[0].tabs.map(t => t.kind)).toEqual(['workout-log', 'exercise-list']);
    expect(ds.sets).toHaveLength(4);
  });

  it('uses the list to tag logged exercises with their muscle group', () => {
    const ds = buildDataset([file('fh', 'Firehouse Gym', [['Log', log], ['Exercises', exercises]])], defaultConfig());
    const muscle = (display: string) => Object.values(ds.exercises).find(e => e.display === display)?.primary;
    expect(muscle('Tricep Supported Hammer Curls')).toBe('Biceps');
    expect(muscle('DB Lateral Raises')).toBe('Shoulders');
    expect(muscle('Bench Press')).toBe('Chest');
    expect(muscle('Lat Pulldown')).toBe('Back');
  });

  it('does not mistake a real log or a coach grid for a list', () => {
    const notList = [['Chest', 'Back', 'Legs'], ['2026-10-01', 'x', 'y'], ['Bench', 'Row', 'Squat'], ['Fly', 'Pulldown', 'Lunge']];
    expect(detectExerciseList(notList.map(r => r.map(c)))).toBeNull();
  });
});

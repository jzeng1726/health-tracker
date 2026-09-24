/**
 * Decisions Jeffrey approved at the Phase 0/1 checkpoints (2026-09-24).
 * Written to the _config sheet on first run; after that _config is the source of truth.
 * Keys use normalized exercise names (see normalizeExerciseName).
 */
import type { AppConfig } from './config';

export const SEED_CONFIG: Partial<AppConfig> = {
  goals: { goalWeightLb: 155 },
  exerciseOverrides: {
    // confirmed low-confidence guess
    'recline curl': { primary: 'Biceps', secondary: [], confirmed: true },
  },
  merges: {
    // alias -> canonical
    'c': 'kneeling band supported triceps extension',
    'laying leg curl': 'lying leg curl',
    'seated dip machine': 'machine dip',
    'low row double arm': 'low row',
  },
  corrections: [
    // hashed sheet id + A1 cell -> value the app reads instead (sheet itself untouched)
    { sheetIdHash: 'ddb92471', cell: 'C15', from: '13x9', to: '130x9', note: 'approved typo fix' },
    { sheetIdHash: 'ddb92471', cell: 'C41', from: '110x10.5-75', to: '110x10.5', note: 'approved: ignore -75' },
    { sheetIdHash: '73077d87', cell: 'L12', from: '8.26', to: '8:26', note: 'approved: 8 min 26 s mile on 8/27' },
  ],
  settings: {
    refreshMinutes: 5,
    distanceUnitRun: 'mi',
    distanceUnitCarry: 'm',
    enduranceCountsTowardVolume: false,
    repRange: 'lower',
    carryWeightPerHand: true,
  },
};

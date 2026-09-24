/**
 * Synced app configuration. Lives in the "_config" spreadsheet inside the
 * Health Tracker folder (tab "config", hidden), one row per top-level key:
 *   A: key | B: JSON value | C: updatedAt (ISO) | D: device
 * Merge rule: per key, newest updatedAt wins.
 */
import type { Muscle, ExerciseKind, EnduranceType } from './muscles';

export interface ExerciseOverride {
  primary: Muscle | null;
  secondary: Muscle[];
  kind?: ExerciseKind;
  enduranceType?: EnduranceType;
  bodyweight?: boolean;
  /** true once Jeffrey confirmed/edited it — always beats automatic rules */
  confirmed: boolean;
}

export interface Correction {
  /** exact Drive file id (corrections made in the app) */
  sheetId?: string;
  /** fnv1a(fileId) — used for built-in seeds so real sheet ids never appear in the public source */
  sheetIdHash?: string;
  tab?: string; cell: string; from: string; to: string; note?: string;
}

/** FNV-1a 32-bit hex — one-way enough that a hash can't be turned back into a Drive id. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export type ColumnRole = 'date' | 'exercise' | 'bodyweight' | 'weight' | 'sets' | 'reps' | 'setsxreps' | 'time' | 'distance' | 'notes' | 'ignore';
export interface ColumnMapping {
  type: 'bodyweight' | 'workout' | 'ignore';
  headerRow: number; // 0-based
  columns: Partial<Record<ColumnRole, number>>;
  timeUnit?: 'seconds' | 'minutes' | 'hours';
  distanceUnit?: 'mi' | 'km' | 'm' | 'yd' | 'ft' | 'steps';
}

export interface Settings {
  refreshMinutes: number;
  distanceUnitRun: 'mi' | 'km';
  distanceUnitCarry: 'm' | 'ft' | 'yd';
  enduranceCountsTowardVolume: boolean;
  repRange: 'lower' | 'average' | 'upper';
  carryWeightPerHand: boolean;
  /** file ids chosen as default Quick Entry targets */
  quickEntryBodyweightFile?: string;
  quickEntryWorkoutFile?: string;
}

export interface AppConfig {
  version: number;
  goals: { goalWeightLb?: number };
  /** automatic mappings as last computed (shared so both machines agree) */
  autoMappings: Record<string, ExerciseOverride & { confidence: string; rule: string }>;
  exerciseOverrides: Record<string, ExerciseOverride>;
  /** normalized alias -> normalized canonical */
  merges: Record<string, string>;
  rejectedMerges: string[]; // "a|b"
  corrections: Correction[];
  /** entry key (sheetId!A1) -> ISO date, for undated entries */
  dateAssignments: Record<string, string>;
  /** entry keys Jeffrey chose to ignore */
  ignored: string[];
  /** `${fileId}:${tabTitle}` -> mapping chosen in "Needs review" */
  columnMappings: Record<string, ColumnMapping>;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 5,
  distanceUnitRun: 'mi',
  distanceUnitCarry: 'm',
  enduranceCountsTowardVolume: false,
  repRange: 'lower',
  carryWeightPerHand: true,
};

export function defaultConfig(): AppConfig {
  return {
    version: 1, goals: {}, autoMappings: {}, exerciseOverrides: {}, merges: {}, rejectedMerges: [],
    corrections: [], dateAssignments: {}, ignored: [], columnMappings: {}, settings: { ...DEFAULT_SETTINGS },
  };
}

export const CONFIG_KEYS: (keyof AppConfig)[] = [
  'version', 'goals', 'autoMappings', 'exerciseOverrides', 'merges', 'rejectedMerges', 'corrections',
  'dateAssignments', 'ignored', 'columnMappings', 'settings',
];

export interface ConfigRow { key: string; value: string; updatedAt: string; device: string }

export function configFromRows(rows: ConfigRow[], base: AppConfig = defaultConfig()): { config: AppConfig; stamps: Record<string, string> } {
  const config: any = structuredClone(base);
  const stamps: Record<string, string> = {};
  for (const r of rows) {
    if (!CONFIG_KEYS.includes(r.key as keyof AppConfig)) continue;
    try {
      const v = JSON.parse(r.value);
      config[r.key] = r.key === 'settings' ? { ...DEFAULT_SETTINGS, ...v } : v;
      stamps[r.key] = r.updatedAt;
    } catch {
      /* corrupted cell: keep default, never crash */
    }
  }
  return { config, stamps };
}

export function configToRows(config: AppConfig, stamps: Record<string, string>, device: string): string[][] {
  return CONFIG_KEYS.map(k => [k, JSON.stringify(config[k]), stamps[k] ?? new Date().toISOString(), device]);
}

/** Newest-wins merge of two configs using per-key timestamps. */
export function mergeConfigs(
  local: AppConfig, localStamps: Record<string, string>,
  remote: AppConfig, remoteStamps: Record<string, string>,
): { config: AppConfig; stamps: Record<string, string>; changedKeys: string[] } {
  const out: any = structuredClone(remote);
  const stamps = { ...remoteStamps };
  const changedKeys: string[] = [];
  for (const k of CONFIG_KEYS) {
    const l = localStamps[k], r = remoteStamps[k];
    if (l && (!r || l > r)) {
      out[k] = structuredClone((local as any)[k]);
      stamps[k] = l;
      changedKeys.push(k);
    }
  }
  return { config: out, stamps, changedKeys };
}

/** Apply a seed only for keys the remote config does not have yet. */
export function applySeed(config: AppConfig, stamps: Record<string, string>, seed: Partial<AppConfig>): { config: AppConfig; seeded: string[] } {
  const out: any = structuredClone(config);
  const seeded: string[] = [];
  for (const [k, v] of Object.entries(seed)) {
    if (!stamps[k]) {
      out[k] = k === 'settings' ? { ...DEFAULT_SETTINGS, ...(v as object) } : structuredClone(v);
      seeded.push(k);
    }
  }
  return { config: out, seeded };
}

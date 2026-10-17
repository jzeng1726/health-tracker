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

export type ColumnRole = 'date' | 'exercise' | 'bodyweight' | 'weight' | 'sets' | 'reps' | 'setsxreps' | 'time' | 'distance' | 'notes' | 'gym' | 'rpe' | 'muscle' | 'until' | 'ignore';
export interface ColumnMapping {
  type: 'bodyweight' | 'workout' | 'life' | 'ignore';
  headerRow: number; // 0-based
  columns: Partial<Record<ColumnRole, number>>;
  timeUnit?: 'seconds' | 'minutes' | 'hours';
  distanceUnit?: 'mi' | 'km' | 'm' | 'yd' | 'ft' | 'steps';
  rpeUnit?: 'rpe' | 'rir';
}

/** Where each set was done. Same lift, different gym = different machine, so each gym is compared to itself. */
export interface GymConfig {
  /** gym every sheet uses unless set below */
  defaultGym: string;
  /** extra gym names you've added */
  names: string[];
  /** fileId -> gym name */
  bySheet: Record<string, string>;
  /** "exercise|gym" -> your own conversion factor to the main gym (null = never convert) */
  factorOverrides: Record<string, number | null>;
  /** old/other spellings (lowercase) -> gym name, e.g. "home gym" -> "Training Station" after a rename */
  aliases?: Record<string, string>;
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
  /** target weekly loss band, % of bodyweight per week */
  lossRateMinPct: number;
  lossRateMaxPct: number;
  /** weekly working-set target per muscle (heatmap) */
  weeklySetsMin: number;
  weeklySetsMax: number;
  /** RIR assumed when a set has no RPE (you train every set close to failure) */
  defaultRir: number;
  /** write cleaned exercise names (capitals, typos, merged names) back into sheets you own */
  rewriteNames: boolean;
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
  gyms: GymConfig;
  /** canonical exercise -> the name to show (and write into your sheets) */
  displayNames: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  refreshMinutes: 5,
  distanceUnitRun: 'mi',
  distanceUnitCarry: 'm',
  enduranceCountsTowardVolume: false,
  repRange: 'lower',
  carryWeightPerHand: true,
  lossRateMinPct: 0.5,
  lossRateMaxPct: 1,
  weeklySetsMin: 4,
  weeklySetsMax: 10,
  defaultRir: 1,
  rewriteNames: true,
};

export const DEFAULT_GYMS: GymConfig = { defaultGym: 'Training Station', names: ['Firehouse Gym'], bySheet: {}, factorOverrides: {}, aliases: { 'home gym': 'Training Station', home: 'Training Station' } };

export function defaultConfig(): AppConfig {
  return {
    version: 1, goals: {}, autoMappings: {}, exerciseOverrides: {}, merges: {}, rejectedMerges: [],
    corrections: [], dateAssignments: {}, ignored: [], columnMappings: {}, settings: { ...DEFAULT_SETTINGS },
    gyms: structuredClone(DEFAULT_GYMS),
    displayNames: {},
  };
}

export const CONFIG_KEYS: (keyof AppConfig)[] = [
  'version', 'goals', 'autoMappings', 'exerciseOverrides', 'merges', 'rejectedMerges', 'corrections',
  'dateAssignments', 'ignored', 'columnMappings', 'settings', 'gyms', 'displayNames',
];

export interface ConfigRow { key: string; value: string; updatedAt: string; device: string }

export function configFromRows(rows: ConfigRow[], base: AppConfig = defaultConfig()): { config: AppConfig; stamps: Record<string, string> } {
  const config: any = structuredClone(base);
  const stamps: Record<string, string> = {};
  for (const r of rows) {
    if (!CONFIG_KEYS.includes(r.key as keyof AppConfig)) continue;
    try {
      const v = JSON.parse(r.value);
      config[r.key] = r.key === 'settings' ? { ...DEFAULT_SETTINGS, ...v } : r.key === 'gyms' ? { ...DEFAULT_GYMS, ...v } : v;
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

/**
 * One-time fixes to configs written by older versions. Returns the keys it changed
 * so the engine can push them back to _config.
 *  v2: removes the bad "30x12-15 -> 300x12-15" lateral-raise correction (Week 01, C3) that the
 *      old median-based typo check suggested — 30 lb was right; the weights simply went up fast.
 */
export function migrateConfig(cfg: AppConfig): { config: AppConfig; changed: (keyof AppConfig)[] } {
  const out = structuredClone(cfg);
  const changed = new Set<keyof AppConfig>();
  if ((out.version ?? 1) < 2) {
    const WEEK01 = '73077d87'; // fnv1a of the Week 01 sheet id
    const isWeek01 = (id?: string, hash?: string) => hash === WEEK01 || (!!id && fnv1a(id) === WEEK01);
    const bad = (c: Correction) => isWeek01(c.sheetId, c.sheetIdHash) && c.cell.toUpperCase() === 'C3' && c.to.trim() === '300x12-15';
    const before = out.corrections.length;
    out.corrections = out.corrections.filter(c => !bad(c));
    if (out.corrections.length !== before) changed.add('corrections');
    const ig = out.ignored.filter(k => { const m = k.match(/^typo:([^!]+)!.*!C3(#\d+)?$/); return !(m && isWeek01(m[1])); });
    if (ig.length !== out.ignored.length) { out.ignored = ig; changed.add('ignored'); }
    out.version = 2;
    changed.add('version');
  }
  if (out.version < 3) {
    // v3 (Jeffrey, 2026-10-17): "Home gym" is now "Training Station"; add "Firehouse Gym";
    // Recline Curl -> Tricep Supported Curls, Strict Alternating Hammer Curl -> Tricep Supported Alternating Hammer Curls,
    // T-Bar (Wide Grip) -> Narrow Grip T-Bar Row (logs merged)
    const g = { ...DEFAULT_GYMS, ...out.gyms };
    const OLD = 'Home gym', NEW = 'Training Station';
    if (g.defaultGym === OLD) {
      g.defaultGym = NEW;
      g.bySheet = Object.fromEntries(Object.entries(g.bySheet).map(([k, v]) => [k, v === OLD ? NEW : v]));
      g.factorOverrides = Object.fromEntries(Object.entries(g.factorOverrides).map(([k, v]) => [k.endsWith(`|${OLD}`) ? `${k.slice(0, -OLD.length)}${NEW}` : k, v]));
      g.aliases = { ...(g.aliases ?? {}), 'home gym': NEW, home: NEW };
    }
    if (!g.names.includes('Firehouse Gym')) g.names = [...g.names, 'Firehouse Gym'];
    out.gyms = g;
    changed.add('gyms');
    out.merges = {
      ...out.merges,
      'recline curl': 'triceps supported curl',
      'strict alternating hammer curl': 'triceps supported alternating hammer curl',
      't bar wide grip': 'narrow grip t bar row',
    };
    changed.add('merges');
    out.displayNames = {
      ...(out.displayNames ?? {}),
      'triceps supported curl': 'Tricep Supported Curls',
      'triceps supported alternating hammer curl': 'Tricep Supported Alternating Hammer Curls',
      'narrow grip t bar row': 'Narrow Grip T-Bar Row',
    };
    changed.add('displayNames');
    out.version = 3;
  }
  return { config: out, changed: [...changed] };
}

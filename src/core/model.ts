import type { SheetCell } from './time';
import type { Muscle, ExerciseKind, EnduranceType, Confidence } from './muscles';

export interface SheetTab { title: string; sheetId?: number; hidden?: boolean; rows: SheetCell[][] }
export interface SheetFile {
  id: string;
  name: string;
  modifiedTime: string;
  owner?: string;
  viaShortcut?: boolean;
  canEdit?: boolean;
  tabs: SheetTab[];
}

export type TabKind = 'bodyweight' | 'program-grid' | 'workout-log' | 'derived' | 'empty' | 'config' | 'unknown';

export interface BodyweightEntry { date: string; weight: number; fileId: string; ref: string }

export interface StrengthSet {
  key: string;            // fileId!tab!A1 — stable id for review/date assignment
  ref: string;            // human readable "Sheet!C15"
  fileId: string;
  date: string;
  exercise: string;       // canonical normalized name
  weight: number | null;  // null = bodyweight
  reps: number;
  side?: 'L' | 'R';
  round?: number;
  perSide?: boolean;
  raw: string;
  note?: string;
}

export interface EnduranceEntry {
  key: string;
  ref: string;
  fileId: string;
  date: string;
  exercise: string;
  type: EnduranceType;
  weight: number | null;
  seconds: number | null;
  distanceM: number | null;
  steps: number | null;
  perSide?: boolean;
  round?: number;
  raw: string;
  note?: string;
}

export interface ExerciseInfo {
  name: string;          // canonical normalized
  display: string;       // most common raw spelling
  variants: string[];
  primary: Muscle | null;
  secondary: Muscle[];
  kind: ExerciseKind;
  enduranceType?: EnduranceType;
  bodyweight?: boolean;
  confidence: Confidence | 'confirmed';
  source: string;
  rule: string;
  reason: string;
  count: number;
}

export type ReviewKind = 'exercise' | 'merge' | 'value' | 'undated' | 'sheet' | 'conflict';
export interface ReviewItem {
  id: string;
  kind: ReviewKind;
  title: string;
  detail: string;
  ref?: string;
  key?: string;
  fileId?: string;
  tab?: string;
  cell?: string;
  raw?: string;
  /** exercise review: preselected best guess */
  guess?: { primary: Muscle | null; secondary: Muscle[] };
  /** value review: suggested corrected text */
  suggestion?: string;
  merge?: { a: string; b: string };
  exercise?: string;
}

export interface FileSummary {
  id: string;
  name: string;
  modifiedTime: string;
  viaShortcut?: boolean;
  owner?: string;
  tabs: { title: string; kind: TabKind; reason: string; rows: number }[];
}

export interface Dataset {
  bodyweight: BodyweightEntry[];
  sets: StrengthSet[];
  endurance: EnduranceEntry[];
  exercises: Record<string, ExerciseInfo>;
  review: ReviewItem[];
  files: FileSummary[];
  /** automatic mappings to persist into _config.autoMappings */
  autoMappings: Record<string, { primary: Muscle | null; secondary: Muscle[]; kind: ExerciseKind; confidence: string; rule: string; confirmed: boolean }>;
}

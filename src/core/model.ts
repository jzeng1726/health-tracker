import type { SheetCell } from './time';
import type { Muscle, ExerciseKind, EnduranceType, Confidence } from './muscles';
import type { NoteTag, LifeTag } from './notes';

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

export type TabKind = 'bodyweight' | 'program-grid' | 'workout-log' | 'life-log' | 'derived' | 'exercise-list' | 'empty' | 'config' | 'duplicate' | 'unknown';

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
  /** where it was done — each gym's machines are compared only to themselves */
  gym: string;
  /** effort if written (RPE 1–10) */
  rpe?: number;
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
  gym: string;
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
  /** undated: every entry key this one date applies to */
  keys?: string[];
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
  /** coach program sheets, for the Gym prep view */
  programs: Program[];
  /** gym names seen in the data (default first) */
  gyms: string[];
  /** every note written next to a set, with what the app read from it */
  notes: NoteEntry[];
  /** life notes from the Life Log tab */
  life: LifeEntry[];
  /** "exercise|gym" -> dates where a note says the setup changed (new baseline from that session) */
  changes: Record<string, string[]>;
  /** exercise-name cells in sheets you own whose text differs from the cleaned name */
  nameFixes: NameFix[];
  /** automatic mappings to persist into _config.autoMappings */
  autoMappings: Record<string, { primary: Muscle | null; secondary: Muscle[]; kind: ExerciseKind; confidence: string; rule: string; confirmed: boolean }>;
}

export interface ProgramItem {
  exercise: string;       // canonical
  display: string;        // as written
  prescription: string;   // "1x8-10"
  notes: string[];        // e.g. "1 Higher pad position"
  result: string;         // what was logged in this block ('' = not done yet)
}
export interface ProgramBlock {
  dayLabel: string;       // "FB A DAY"
  headerRow: number;
  exCol: number;
  date: string | null;
  items: ProgramItem[];
  logged: number;         // items with a result
}
export interface Program { fileId: string; fileName: string; modifiedTime: string; blocks: ProgramBlock[] }

export interface NoteEntry {
  date: string;
  exercise: string;      // canonical
  gym: string;
  text: string;          // exactly as written
  tags: NoteTag[];
  setupChange: boolean;
  ref: string;
  key: string;
  set?: string;          // "95 × 7"
}
export interface LifeEntry { date: string; until?: string; text: string; tags: LifeTag[]; ref: string }
export interface NameFix { fileId: string; fileName: string; tab: string; row: number; col: number; from: string; to: string }

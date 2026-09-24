/**
 * Automatic exercise -> muscle detection.
 * Most-specific match wins (longest contiguous phrase). Jeffrey's MANDATORY rules
 * always beat library rules. User overrides (from _config) beat everything.
 */

export const MUSCLES = ['Chest', 'Back', 'Triceps', 'Biceps', 'Shoulders', 'Quads', 'Calves', 'Hamstrings', 'Core'] as const;
export type Muscle = (typeof MUSCLES)[number];
export type ExerciseKind = 'strength' | 'endurance' | 'timed';
export type EnduranceType = 'run' | 'walking_lunge' | 'farmer_carry' | 'static_hold' | 'other';
export type Confidence = 'high' | 'low' | 'none';

export interface MuscleMapping {
  primary: Muscle | null;
  secondary: Muscle[];
  kind: ExerciseKind;
  enduranceType?: EnduranceType;
  /** interpret "AxB" as sets x reps (no external load) */
  bodyweight?: boolean;
  confidence: Confidence;
  source: 'mandatory' | 'library' | 'keyword' | 'muscle-hint' | 'user' | 'none';
  rule: string;
  reason: string;
}

// ------------------------------------------------------------------ normalize

const ABBREV: Record<string, string> = {
  db: 'dumbbell', dbs: 'dumbbell', bb: 'barbell', tri: 'triceps', tricep: 'triceps', tris: 'triceps',
  bi: 'biceps', bicep: 'biceps', ext: 'extension', exts: 'extension', ohp: 'overhead press',
  deg: 'degree', degrees: 'degree', pulldowns: 'pulldown', pushups: 'push up', pushup: 'push up',
  pullup: 'pull up', pullups: 'pull up', chinup: 'chin up', chinups: 'chin up', situp: 'sit up', situps: 'sit up',
  stepup: 'step up', stepups: 'step up', hyperextensions: 'hyperextension', rdls: 'rdl', farmers: 'farmer',
  quads: 'quad', calves: 'calf', delts: 'delt', hamstrings: 'hamstring', lats: 'lat', abs: 'abs',
};
const KEEP_S = new Set(['press', 'biceps', 'triceps', 'abs', 'cross', 'glutes', 'plus', 'bus', 'across']);
const IRREGULAR: Record<string, string> = { flies: 'fly', flyes: 'fly', carries: 'carry', crunches: 'crunch', presses: 'press', raises: 'raise', lunges: 'lunge' };

function singular(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (KEEP_S.has(w) || w.length <= 3 || w.endsWith('ss')) return w;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

/** lowercase, strip punctuation, DB->dumbbell, BB->barbell, 45°/45deg -> 45 degree, singularize */
export function normalizeExerciseName(name: string): string {
  let s = (name ?? '').toLowerCase();
  s = s.replace(/°/g, ' degree ').replace(/(\d+)\s*-?\s*(deg|degree|degrees)\b/g, '$1 degree');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  const words = s.split(/\s+/).filter(Boolean).flatMap(w => (ABBREV[w] ?? singular(w)).split(' '));
  return words.join(' ');
}

// ---------------------------------------------------------------------- rules

interface Rule {
  id: string;
  phrases: string[]; // normalized phrases; contiguous-token match
  primary: Muscle | null;
  secondary?: Muscle[];
  kind?: ExerciseKind;
  enduranceType?: EnduranceType;
  bodyweight?: boolean;
  /** single generic keyword -> low confidence */
  generic?: boolean;
  mandatory?: boolean;
  /** skip rule if any of these tokens is present */
  excludeTokens?: string[];
}

const R = (id: string, phrases: string[], primary: Muscle | null, extra: Partial<Rule> = {}): Rule => ({ id, phrases, primary, ...extra });

/** Jeffrey's personal definitions — checked first, always win. */
export const MANDATORY_RULES: Rule[] = [
  R('M1 machine press → Chest', ['machine press', 'chest press', 'press machine', 'machine chest press'], 'Chest',
    // "leg press machine" / "calf press machine" are not machine *presses* in Jeffrey's sense
    { secondary: ['Triceps', 'Shoulders'], mandatory: true, excludeTokens: ['shoulder', 'overhead', 'military', 'leg', 'calf', 'toe'] }),
  R('M2 dips → Chest', ['dip'], 'Chest', { secondary: ['Triceps'], mandatory: true }),
  R('M3 45° back extension → Hamstrings', ['45 degree back extension', '45 degree hyperextension', '45 degree hyper extension'], 'Hamstrings',
    { secondary: ['Back'], mandatory: true }),
];

export const LIBRARY_RULES: Rule[] = [
  // Chest
  R('bench press', ['bench press', 'flat bench', 'barbell bench', 'dumbbell bench'], 'Chest'),
  R('incline/decline press', ['incline press', 'incline bench press', 'incline dumbbell press', 'decline press', 'decline bench press'], 'Chest'),
  R('fly', ['fly', 'pec deck', 'cable crossover', 'crossover', 'pec fly'], 'Chest'),
  R('push-up', ['push up'], 'Chest', { bodyweight: true }),
  R('close-grip bench', ['close grip bench', 'close grip bench press'], 'Triceps', { secondary: ['Chest'] }),
  R('press (generic)', ['press'], 'Chest', { generic: true }),
  // Back
  R('row', ['row', 't bar row', 'cable row', 'seated row', 'barbell row', 'dumbbell row', 'low row'], 'Back'),
  R('t-bar', ['t bar'], 'Back'),
  R('pulldown', ['pulldown', 'lat pulldown', 'pull down'], 'Back'),
  R('pull-up / chin-up', ['pull up', 'chin up'], 'Back', { bodyweight: true }),
  R('deadlift', ['deadlift'], 'Back', { secondary: ['Hamstrings'] }),
  R('shrug', ['shrug'], 'Back'),
  // Triceps
  R('pushdown', ['pushdown', 'push down', 'rope pushdown', 'triceps pushdown'], 'Triceps'),
  R('skull crusher', ['skull crusher', 'skullcrusher'], 'Triceps'),
  R('triceps extension', ['triceps extension', 'overhead triceps extension'], 'Triceps'),
  R('kickback', ['kickback', 'kick back'], 'Triceps'),
  // Biceps
  R('curl (generic)', ['curl'], 'Biceps', { generic: true }),
  R('named curl', ['hammer curl', 'preacher curl', 'incline curl', 'ez bar curl', 'dumbbell curl', 'barbell curl', 'cable curl', 'biceps curl', 'concentration curl', 'spider curl'], 'Biceps'),
  // Shoulders
  R('overhead/shoulder press', ['overhead press', 'shoulder press', 'military press', 'arnold press'], 'Shoulders'),
  R('lateral raise', ['lateral raise', 'lat raise', 'side raise', 'side lateral raise'], 'Shoulders'),
  R('front raise', ['front raise'], 'Shoulders'),
  R('rear delt fly', ['rear delt fly', 'reverse fly', 'rear delt'], 'Shoulders'),
  R('face pull', ['face pull'], 'Shoulders'),
  R('upright row', ['upright row'], 'Shoulders'),
  // Quads
  R('squat', ['squat', 'hack squat', 'split squat', 'bulgarian split squat', 'front squat', 'goblet squat'], 'Quads'),
  R('leg press', ['leg press'], 'Quads'),
  R('leg/quad extension', ['leg extension', 'quad extension'], 'Quads'),
  R('lunge', ['lunge', 'reverse lunge'], 'Quads'),
  R('step-up', ['step up'], 'Quads'),
  // Calves
  R('calf raise/press', ['calf raise', 'standing calf raise', 'seated calf raise', 'calf press', 'toe press', 'seated toe press'], 'Calves'),
  // Hamstrings
  R('RDL / stiff-leg', ['romanian deadlift', 'rdl', 'stiff leg deadlift', 'stiff legged deadlift'], 'Hamstrings'),
  R('leg curl', ['leg curl', 'lying leg curl', 'laying leg curl', 'seated leg curl', 'hamstring curl'], 'Hamstrings'),
  R('back extension', ['back extension', 'hyperextension', 'hyper extension'], 'Hamstrings', { secondary: ['Back'] }),
  R('good morning', ['good morning'], 'Hamstrings'),
  R('glute-ham raise', ['glute ham raise', 'ghr'], 'Hamstrings'),
  R('nordic curl', ['nordic curl', 'nordic hamstring curl'], 'Hamstrings', { bodyweight: true }),
  // Core
  R('crunch', ['crunch', 'cable crunch'], 'Core'),
  R('plank', ['plank', 'side plank'], 'Core', { kind: 'timed', bodyweight: true }),
  R('ab wheel', ['ab wheel', 'ab rollout'], 'Core', { bodyweight: true }),
  R('leg/knee raise', ['hanging leg raise', 'leg raise', 'hanging knee raise', 'knee raise'], 'Core', { bodyweight: true }),
  R('russian twist', ['russian twist'], 'Core'),
  R('sit-up', ['sit up'], 'Core', { bodyweight: true }),
  // Endurance (muscles only used if the Settings volume toggle is on)
  R('run', ['run', 'running', 'jog', 'mile run'], null, { kind: 'endurance', enduranceType: 'run' }),
  R('walking lunge', ['walking lunge'], 'Quads', { kind: 'endurance', enduranceType: 'walking_lunge' }),
  R('farmer carry', ['farmer carry', 'farmer walk', 'carry'], 'Core', { secondary: ['Back'], kind: 'endurance', enduranceType: 'farmer_carry' }),
  R('static hold', ['static hold', 'dumbbell hold', 'static dumbbell hold', 'hold'], 'Core', { secondary: ['Back'], kind: 'endurance', enduranceType: 'static_hold' }),
];

/** explicit muscle words, e.g. "Seated Toe Press (Calves)" */
const MUSCLE_HINTS: [string, Muscle][] = [
  ['chest', 'Chest'], ['pec', 'Chest'], ['back', 'Back'], ['lat', 'Back'], ['triceps', 'Triceps'], ['biceps', 'Biceps'],
  ['shoulder', 'Shoulders'], ['delt', 'Shoulders'], ['quad', 'Quads'], ['calf', 'Calves'], ['hamstring', 'Hamstrings'],
  ['abs', 'Core'], ['core', 'Core'], ['ab', 'Core'],
];

function containsPhrase(tokens: string[], phrase: string): boolean {
  const p = phrase.split(' ');
  for (let i = 0; i + p.length <= tokens.length; i++) {
    if (p.every((w, j) => tokens[i + j] === w)) return true;
  }
  return false;
}

interface Hit { rule: Rule; phrase: string; words: number }

function bestHit(tokens: string[], rules: Rule[]): { best: Hit | null; all: Hit[] } {
  const all: Hit[] = [];
  for (const rule of rules) {
    if (rule.excludeTokens?.some(t => tokens.includes(t))) continue;
    for (const phrase of rule.phrases) {
      if (containsPhrase(tokens, phrase)) all.push({ rule, phrase, words: phrase.split(' ').length });
    }
  }
  all.sort((a, b) => b.words - a.words || Number(!!a.rule.generic) - Number(!!b.rule.generic));
  return { best: all[0] ?? null, all };
}

export function detectMuscles(rawName: string): MuscleMapping {
  const norm = normalizeExerciseName(rawName);
  const tokens = norm.split(' ').filter(Boolean);

  // 1) mandatory rules
  const mand = bestHit(tokens, MANDATORY_RULES).best;
  if (mand) {
    return {
      primary: mand.rule.primary, secondary: mand.rule.secondary ?? [], kind: 'strength',
      confidence: 'high', source: 'mandatory', rule: mand.rule.id, reason: `matched "${mand.phrase}"`,
    };
  }

  // 2) library, most-specific phrase wins
  const { best, all } = bestHit(tokens, LIBRARY_RULES);
  const hint = MUSCLE_HINTS.find(([w]) => tokens.includes(w))?.[1];

  if (best) {
    const r = best.rule;
    // conflict: another hit of equal length pointing to a different primary
    const rival = all.find(h => h !== best && h.words === best.words && h.rule.primary !== r.primary && !h.rule.generic);
    let confidence: Confidence = r.generic || rival ? 'low' : 'high';
    let reason = `matched "${best.phrase}"` + (best.words > 1 ? ` (${best.words}-word phrase beats shorter keywords)` : '');
    if (rival) reason += `; conflicts with "${rival.phrase}" → ${rival.rule.primary}`;
    if (r.generic) reason += '; only a generic keyword matched — please confirm';
    if (hint && r.generic && hint !== r.primary) {
      return { primary: hint, secondary: [], kind: 'strength', confidence: 'low', source: 'muscle-hint', rule: `name says "${hint}"`, reason: `${reason}; name mentions ${hint}` };
    }
    if (hint && hint === r.primary && confidence === 'low' && !rival) {
      confidence = 'high';
      reason += `; name mentions ${hint}`;
    }
    const unknownWords = tokens.filter(t => !all.some(h => h.phrase.split(' ').includes(t)) && !STOPWORDS.has(t));
    if (r.generic && unknownWords.length) reason += `; unrecognised words: ${unknownWords.join(', ')}`;
    return {
      primary: r.primary, secondary: r.secondary ?? [], kind: r.kind ?? 'strength', enduranceType: r.enduranceType,
      bodyweight: r.bodyweight, confidence, source: r.generic ? 'keyword' : 'library', rule: r.id, reason,
    };
  }

  if (hint) {
    return { primary: hint, secondary: [], kind: 'strength', confidence: 'low', source: 'muscle-hint', rule: `name says "${hint}"`, reason: 'no exercise rule matched; used muscle word in the name' };
  }
  return { primary: null, secondary: [], kind: 'strength', confidence: 'none', source: 'none', rule: '—', reason: 'no rule matched' };
}

const STOPWORDS = new Set([
  'seated', 'standing', 'single', 'arm', 'double', 'one', 'two', 'machine', 'cable', 'dumbbell', 'barbell', 'wide', 'close',
  'narrow', 'grip', 'kneeling', 'band', 'supported', 'lying', 'laying', 'incline', 'decline', 'v', 'bar', 'ez', 'rope',
  'weighted', 'assisted', 'smith', 'the', 'with', 'and', '1', '2', '45', 'degree', 'mile', 'hanging', 'low', 'high',
]);

// ------------------------------------------------------------------ fuzzy merge

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export interface MergeSuggestion { a: string; b: string; why: string }

/** Pairs of distinct normalized names that are probably the same exercise. Never auto-merged. */
export function suggestMerges(names: string[]): MergeSuggestion[] {
  const out: MergeSuggestion[] = [];
  const uniq = [...new Set(names)];
  for (let i = 0; i < uniq.length; i++)
    for (let j = i + 1; j < uniq.length; j++) {
      const a = uniq[i], b = uniq[j];
      const ta = a.split(' '), tb = b.split(' ');
      const dist = levenshtein(a, b);
      const ratio = 1 - dist / Math.max(a.length, b.length);
      if (ta.length === tb.length && ratio >= 0.85) {
        out.push({ a, b, why: `spelling differs by ${dist} letter${dist > 1 ? 's' : ''}` });
        continue;
      }
      const [small, big] = ta.length < tb.length ? [ta, tb] : [tb, ta];
      if (small.length >= 2 && small.every(t => big.includes(t))) {
        const extra = big.filter(t => !small.includes(t));
        if (extra.every(t => STOPWORDS.has(t) || ['seated', 'machine', 'double', 'arm', 'grip'].includes(t))) {
          out.push({ a, b, why: `same words plus "${extra.join(' ')}"` });
        }
      }
    }
  return out;
}

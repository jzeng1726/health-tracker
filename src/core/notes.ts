/**
 * Reads plain-English notes written next to a set ("used straps", "moved to higher position",
 * "changed my grip", "different form") and decides whether the SETUP changed.
 * A setup change starts a new baseline for that exercise, so a drop in weight right after it
 * isn't counted as getting weaker.
 *
 * "Triple read": every note is checked three ways — (1) setup-change phrases, (2) things that
 * limited the set but didn't change the setup (grip gave out, tired, pain), (3) explicit
 * "same / no change" wording that cancels a match.
 */

export type NoteTag = 'grip' | 'straps' | 'position' | 'machine' | 'form' | 'equipment' | 'grip-limited' | 'pain' | 'fatigue' | 'count';

export const TAG_LABEL: Record<NoteTag, string> = {
  grip: 'grip changed', straps: 'straps', position: 'seat / pad / machine position', machine: 'different machine or setup', form: 'form / technique',
  equipment: 'belt / wraps / attachment', 'grip-limited': 'grip gave out', pain: 'pain / tweak', fatigue: 'tired / sick / low energy', count: 'lost count',
};

export const SETUP_TAGS: NoteTag[] = ['grip', 'straps', 'position', 'machine', 'form', 'equipment'];

const RULES: [NoteTag, RegExp][] = [
  ['straps', /\b(straps?|strapped|versa ?grips?|lifting hooks|wrist wraps?)\b/],
  ['grip', /\b(chang\w*|switch\w*|new|different|diff|wider|wide|closer|close|narrow\w*|neutral|overhand|underhand|mixed|reverse|pronated|supinated|thumbless|false)\s+(my\s+|the\s+|a\s+)?grip\b|\bgrip\s+(chang\w*|switch\w*|width|wider|closer|narrower|was different)\b/],
  ['position', /\b(seat|pad|pin|bench|backrest|back ?pad|handles?|lever|foot ?plate|feet|foot|platform|pulley|cable|rope|knee ?pad|chest ?pad|thigh ?pad|roller|incline|angle|machine)\s*(position|height|setting|notch|hole|level|angle)\b|\b(position|setting|notch|hole|level)\s*(\d+|up|down|higher|lower|changed?)\b|\bmoved\s+(it\s+|the\s+\w+\s+)?(to\s+)?(a\s+|the\s+)?(up|down|higher|lower|forward|back)\b|\b(higher|lower|raised|lowered|moved)\s+(the\s+)?(seat|pad|pin|position|setting|bench|handles?|pulley|cable)\b|\b(seat|pad|pin|pulley)\s+(up|down|higher|lower)\b|\b\d+\s+(higher|lower)\b|\b(seat|pad|pin|setting|notch|hole|level)\s+(on|at|to)\s+\d+\b/],
  ['machine', /\b(different|new|other|another|switched|changed|swapped)\s+(machine|bench|station|cable|bar|attachment|handle|equipment|rack|stack|plates?)\b|\bswitched\s+to\s+(the\s+)?(other|another)\b|\bother\s+(way|side|machine)\b|\bused\s+(the\s+)?\w*\s*machine\s+instead\b|\binstead\s+of\s+the\b|\b(hammer strength|plate[- ]loaded|selectorized|smith)\b/],
  ['form', /\b(form|technique|tempo|eccentric|negatives?|paused?|stricter|strict|cheat\w*|partials?|full rom|range of motion|rom|controlled|slow(er)? reps|stopped short|bounced?|momentum|swing\w*)\b/],
  ['equipment', /\b(belt|knee sleeves?|knee wraps?|chains|bands? (added|assist\w*)|added bands?|different (bar|handle|attachment))\b/],
  ['grip-limited', /\bgrip\s+(gave out|failed|gone|died|slipped|was (the )?limit\w*|gave up)\b|\blost\s+(my\s+)?grip\b|\bgrip fatigue\b/],
  ['pain', /\b(pain|painful|hurt\w*|tweak\w*|strain\w*|injur\w*|sore|ache|aching|twinge|pinch\w*)\b/],
  ['fatigue', /\b(tired|fatigued?|exhausted|no sleep|bad sleep|didn'?t sleep|little sleep|sick|ill|low energy|drained|fasted|hungover|gassed|weak today)\b/],
  ['count', /\b(lost count|didn'?t count|forgot (to )?count|miscount\w*)\b/],
];
const SAME = /\b(same|no change in|didn'?t change|unchanged)\s+(grip|position|setting|seat|pad|machine|form|setup)\b|\bno changes?\b/;

export interface NoteRead { tags: NoteTag[]; setupChange: boolean; summary: string }

export function readNote(text: string): NoteRead {
  const t = ` ${(text ?? '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9'+ ]/g, ' ').replace(/\s+/g, ' ')} `;
  if (!t.trim()) return { tags: [], setupChange: false, summary: '' };
  let tags = RULES.filter(([, rx]) => rx.test(t)).map(([tag]) => tag);
  // "grip gave out" is a limit, not a grip change
  if (tags.includes('grip-limited')) tags = tags.filter(x => x !== 'grip');
  // "same grip", "no change": cancel those setup tags
  const same = t.match(SAME);
  if (same) {
    const what = same[2];
    const cancel: NoteTag[] = !what || what === 'setup' ? SETUP_TAGS
      : what === 'grip' ? ['grip'] : what === 'machine' ? ['machine'] : what === 'form' ? ['form'] : ['position'];
    tags = tags.filter(x => !cancel.includes(x));
  }
  const setupChange = tags.some(x => SETUP_TAGS.includes(x));
  const summary = tags.map(x => TAG_LABEL[x]).join(', ');
  return { tags, setupChange, summary };
}

/** Tags for life notes ("sick this week", "going on vacation"). */
export type LifeTag = 'vacation' | 'sick' | 'injury' | 'sleep' | 'stress' | 'busy' | 'deload' | 'travel' | 'diet';
const LIFE: [LifeTag, RegExp][] = [
  ['vacation', /\b(vacation|holiday|trip|getaway|cruise|resort)\b/],
  ['travel', /\b(travel\w*|flight|flying|visiting|road trip|away)\b/],
  ['sick', /\b(sick|ill|flu|cold|covid|fever|virus|stomach)\b/],
  ['injury', /\b(injur\w*|hurt|tweak\w*|strain\w*|sprain\w*|pain)\b/],
  ['sleep', /\b(sleep|slept|insomnia|tired|exhausted)\b/],
  ['stress', /\b(stress\w*|exam|midterm|finals?|deadline|work week|overtime)\b/],
  ['busy', /\b(busy|no time|swamped|missed (the )?gym|skipped)\b/],
  ['deload', /\b(deload|rest week|recovery week|light week|time off)\b/],
  ['diet', /\b(refeed|diet break|maintenance|cheat (day|meal)|bulk|cut|calories)\b/],
];
export function readLifeNote(text: string): LifeTag[] {
  const t = ` ${(text ?? '').toLowerCase()} `;
  return LIFE.filter(([, rx]) => rx.test(t)).map(([tag]) => tag);
}

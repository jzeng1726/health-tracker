/**
 * Clean exercise names for display (and for rewriting your own sheets):
 * every word capitalised, run-together words split, common typos fixed.
 *   "Rope pushdown" -> "Rope Pushdown", "Alternating DB hammercurls" -> "Alternating DB Hammer Curls",
 *   "Laying Leg Curl" -> "Lying Leg Curl", "Weighted Situps" -> "Weighted Sit-Ups"
 * Idempotent: cleanExerciseName(cleanExerciseName(x)) === cleanExerciseName(x).
 */
import { fixWord, splitJoined } from './muscles';

const SPECIAL: Record<string, string> = {
  db: 'DB', dbs: 'DBs', bb: 'BB', ez: 'EZ', rdl: 'RDL', rdls: 'RDLs', ohp: 'OHP', ghr: 'GHR', sldl: 'SLDL', jm: 'JM', fb: 'FB',
  tbar: 'T-Bar', vbar: 'V-Bar', ezbar: 'EZ-Bar',
  situp: 'Sit-Up', situps: 'Sit-Ups', pushup: 'Push-Up', pushups: 'Push-Ups', pullup: 'Pull-Up', pullups: 'Pull-Ups',
  chinup: 'Chin-Up', chinups: 'Chin-Ups', stepup: 'Step-Up', stepups: 'Step-Ups',
};

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

function fixPart(part: string): string {
  if (!/^[A-Za-z]+$/.test(part)) {
    // numbers, "45°", "1x8", "3/4": keep, just capitalise a leading letter
    return /^[a-z]/.test(part) && !/^\d/.test(part) && !/x\d/i.test(part) ? cap(part) : part;
  }
  const lower = part.toLowerCase();
  if (SPECIAL[lower]) return SPECIAL[lower];
  const fixed = fixWord(lower);
  if (fixed !== lower) return fixed.split(' ').map(x => SPECIAL[x] ?? cap(x)).join(' ');
  const joined = splitJoined(lower);
  if (joined) return joined.map(x => SPECIAL[x] ?? cap(fixWord(x))).join(' ');
  return cap(lower);
}

function fixToken(tok: string): string {
  const m = tok.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9°]*)$/);
  if (!m) return tok;
  const [, pre, core, post] = m;
  if (!core) return tok;
  return pre + core.split('-').map(fixPart).join('-') + post;
}

export function cleanExerciseName(raw: string): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return s;
  return s.split(' ').map(fixToken).join(' ').replace(/\s+/g, ' ');
}

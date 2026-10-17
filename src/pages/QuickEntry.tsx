import { useMemo, useState } from 'react';
import { useSync, todayISO, useToast, GymSelect, useCurrentGym, takePrefill } from '../ui/common';
import { logBodyweight, logWorkout, bodyweightTargets, workoutTargets } from '../sync/engine';
import { parseDuration, parseDistance, formatDuration } from '../core/time';
import { detectMuscles, normalizeExerciseName } from '../core/muscles';
import { readNote, SETUP_TAGS, TAG_LABEL } from '../core/notes';
import { cleanExerciseName } from '../core/names';

export default function QuickEntry() {
  const s = useSync();
  const offline = s.auth !== 'connected';
  return (
    <>
      {offline && <p className="hint bad" role="alert">Connect Google first. Quick Entry writes straight to your sheets.</p>}
      <div className="grid two">
        <BodyweightForm disabled={offline} />
        <WorkoutForm mode="strength" disabled={offline} />
        <WorkoutForm mode="endurance" disabled={offline} />
      </div>
    </>
  );
}

function BodyweightForm({ disabled }: { disabled: boolean }) {
  const s = useSync();
  const toast = useToast();
  const targets = useMemo(() => bodyweightTargets(), [s.files, s.dataset]);
  const [date, setDate] = useState(todayISO());
  const [w, setW] = useState('');
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ value: number; where: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const target = file || s.config.settings.quickEntryBodyweightFile || targets[0]?.id || '';
  const num = Number(w);
  const valid = w !== '' && isFinite(num) && num >= 50 && num <= 700;
  const submit = async (overwrite = false) => {
    setBusy(true); setErr(null);
    try {
      const r = await logBodyweight(date, num, target, overwrite);
      if (!r.ok) { setConflict({ value: r.conflict, where: r.where }); return; }
      setConflict(null); setW('');
      toast(`Saved ${num} lb for ${date} → ${r.where}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card form" onSubmit={e => { e.preventDefault(); if (valid) submit(); }}>
      <h2>Morning weight</h2>
      <div className="row">
        <label>Date<input type="date" value={date} onChange={e => { setDate(e.target.value); setConflict(null); }} /></label>
        <label>Weight (lb)<input type="number" step="0.1" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} placeholder="160.2" /></label>
      </div>
      <label>Sheet
        <select value={target} onChange={e => setFile(e.target.value)}>
          {targets.map(t => <option key={t.id} value={t.id}>{t.name}{t.latest ? ` (latest ${t.latest.slice(5)})` : ''}</option>)}
          {!targets.length && <option value="">No bodyweight sheet found</option>}
        </select>
      </label>
      {w !== '' && !valid && <div className="hint bad">Enter a weight between 50 and 700 lb.</div>}
      {conflict ? (
        <div className="hint bad">{date} already has {conflict.value} lb. <button type="button" className="btn small" onClick={() => submit(true)} disabled={busy}>Replace with {num}</button> <button type="button" className="btn small ghost" onClick={() => setConflict(null)}>Cancel</button></div>
      ) : (
        <button className="btn primary" disabled={disabled || !valid || busy || !target}>{busy ? 'Saving…' : 'Save weight'}</button>
      )}
      {err && <div className="hint bad" role="alert">{err}</div>}
    </form>
  );
}

function WorkoutForm({ mode, disabled }: { mode: 'strength' | 'endurance'; disabled: boolean }) {
  const s = useSync();
  const toast = useToast();
  const targets = useMemo(() => workoutTargets(), [s.files, s.dataset]);
  const [pre] = useState(() => (mode === 'strength' ? takePrefill() : null));
  const [date, setDate] = useState(todayISO());
  const [ex, setEx] = useState(pre?.exercise ?? '');
  const [weight, setWeight] = useState(pre?.weight != null ? String(pre.weight) : '');
  const [sets, setSets] = useState(mode === 'strength' ? '1' : '');
  const [reps, setReps] = useState(pre?.reps != null ? String(pre.reps) : '');
  const [rpe, setRpe] = useState('');
  const [gym, setGym] = useCurrentGym();
  const [time, setTime] = useState('');
  const [dist, setDist] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const names = useMemo(() => Object.values(s.dataset.exercises)
    .filter(e => (mode === 'strength' ? e.kind === 'strength' : e.kind !== 'strength'))
    .map(e => e.display).sort(), [s.dataset.exercises, mode]);
  const suggestions = mode === 'endurance' ? [...new Set([...names, '1 Mile Run', 'Run', 'Walking Lunges', 'Farmers Carries', 'Static Holds', 'Plank'])] : names;

  const t = time.trim() ? parseDuration(time) : null;
  const dd = dist.trim() ? parseDistance(dist) : null;
  const guess = ex.trim() ? detectMuscles(ex) : null;
  const known = ex.trim() && s.dataset.exercises[normalizeExerciseName(ex)];
  const target = file || s.config.settings.quickEntryWorkoutFile || targets[0]?.id || '';

  const valid = !!ex.trim() && (mode === 'strength'
    ? reps !== '' && Number(reps) > 0 && (weight === '' || Number(weight) >= 0)
    : ((t && !t.ambiguous) || (dd && !dd.ambiguous) || reps !== '') && !(t?.ambiguous) && !(dd?.ambiguous));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await logWorkout({
        date, exercise: ex.trim(), weight: weight === '' ? null : Number(weight), sets: sets === '' ? null : Number(sets), reps: reps === '' ? null : Number(reps),
        timeText: t && !t.ambiguous ? formatDuration(t.seconds) : '', distanceText: dd && !dd.ambiguous ? `${dd.value} ${dd.unit}` : '', notes,
        gym, rpe: rpe === '' ? null : Number(rpe),
      }, target || undefined);
      toast(`Logged ${r.name}${t?.seconds != null ? ` · ${formatDuration(t.seconds)}` : ''} → ${r.where}`);
      setWeight(''); setReps(''); setTime(''); setDist(''); setNotes(''); setRpe('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <form className="card form" onSubmit={e => { e.preventDefault(); if (valid) submit(); }}>
      <h2>{mode === 'strength' ? 'Strength set' : 'Endurance entry'}</h2>
      <div className="row">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label style={{ gridColumn: 'span 2' }}>Exercise
          <input list={`ex-${mode}`} value={ex} onChange={e => setEx(e.target.value)} placeholder={mode === 'strength' ? 'Machine Dips' : 'Farmers Carries'} />
          <datalist id={`ex-${mode}`}>{suggestions.map(n => <option key={n} value={n} />)}</datalist>
        </label>
      </div>
      {ex.trim() && !known && guess && (
        <div className={`hint ${guess.confidence === 'high' ? 'ok' : ''}`}>New exercise “{cleanExerciseName(ex)}” → {guess.primary ?? 'unknown muscle'}{guess.secondary.length ? ` + ${guess.secondary.join(', ')}` : ''} ({guess.confidence === 'high' ? 'auto-mapped' : "you'll confirm it in Review"})</div>
      )}
      <div className="row">
        <label>Weight (lb){mode === 'endurance' && ' · optional'}<input type="number" step="0.5" value={weight} onChange={e => setWeight(e.target.value)} placeholder={mode === 'endurance' ? 'per hand' : '210'} /></label>
        <label>Sets<input type="number" min="1" value={sets} onChange={e => setSets(e.target.value)} placeholder="1" /></label>
        <label>{mode === 'endurance' ? 'Reps / steps' : 'Reps'}<input type="number" step="0.5" value={reps} onChange={e => setReps(e.target.value)} placeholder={mode === 'endurance' ? 'optional' : '10'} /></label>
        {mode === 'strength' && (
          <label>RPE · optional
            <select value={rpe} onChange={e => setRpe(e.target.value)}>
              <option value="">all-out</option>
              {['10', '9.5', '9', '8.5', '8', '7.5', '7', '6'].map(v => <option key={v} value={v}>{v}{v === '10' ? ' · failure' : v === '9' ? ' · 1 left' : v === '8' ? ' · 2 left' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      <label>Gym<GymSelect value={gym} onChange={setGym} /></label>
      {mode === 'endurance' && (
        <div className="row">
          <label>Time<input value={time} onChange={e => setTime(e.target.value)} placeholder="1:30  (= 1 min 30 s)" aria-describedby="time-hint" /></label>
          <label>Distance<input value={dist} onChange={e => setDist(e.target.value)} placeholder="1 mi · 40 m · 20 steps" /></label>
        </div>
      )}
      {t && <div id="time-hint" className={`hint ${t.ambiguous ? 'bad' : 'ok'}`}>{t.ambiguous ? `Can't read "${time}": ${t.reason}. Try 1:30, 90s or 2m30s.` : `= ${describe(t.seconds!)} (${t.seconds} s), saved as ${formatDuration(t.seconds)}`}</div>}
      {dd && <div className={`hint ${dd.ambiguous ? 'bad' : 'ok'}`}>{dd.ambiguous ? `Can't read "${dist}": ${dd.reason}. Add a unit (mi, km, m, yd, ft, steps).` : `= ${dd.value} ${dd.unit}${dd.meters != null ? ` (${Math.round(dd.meters)} m)` : ''}`}</div>}
      <NoteBox value={notes} onChange={setNotes} />
      <label>Sheet
        <select value={target} onChange={e => setFile(e.target.value)}>
          {targets.map(tg => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
          {!targets.length && <option value="">Training Log (created on first save)</option>}
        </select>
      </label>
      <button className="btn primary" disabled={disabled || !valid || busy}>{busy ? 'Saving…' : mode === 'strength' ? 'Log set' : 'Log entry'}</button>
      {err && <div className="hint bad" role="alert">{err}</div>}
    </form>
  );
}

function describe(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
  return [h && `${h} h`, m && `${m} min`, (s || (!h && !m)) && `${s} s`].filter(Boolean).join(' ');
}

const NOTE_CHIPS = ['Changed grip', 'Used straps', 'No straps', 'Seat / pad moved up', 'Seat / pad moved down', 'Different machine', 'Form changed', 'Slower reps / pauses', 'Grip gave out', 'Felt tired', 'Pain / tweak'];

/** Note for this exercise. The app reads it the same way it reads notes in your sheets. */
function NoteBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const r = value.trim() ? readNote(value) : null;
  const add = (c: string) => onChange(value.trim() ? `${value.trim().replace(/[.;,]$/, '')}, ${c.toLowerCase()}` : c);
  return (
    <div className="notebox">
      <label>Note for this exercise · optional
        <textarea rows={2} value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. changed my grip, used straps, moved seat to 4" />
      </label>
      <div className="chips">{NOTE_CHIPS.map(c => <button type="button" key={c} className="chip small" onClick={() => add(c)}>+ {c}</button>)}</div>
      {r && (r.setupChange
        ? <div className="hint ok">Read as a setup change ({r.tags.filter(t => SETUP_TAGS.includes(t)).map(t => TAG_LABEL[t]).join(', ')}) — this session becomes the new starting point, so a drop in weight or reps won't count as getting weaker.</div>
        : r.tags.length ? <div className="hint">Read as: {r.summary}. Saved with the set; doesn't change the math.</div>
          : <div className="hint">Saved with the set and shown in Log &amp; calendar.</div>)}
    </div>
  );
}

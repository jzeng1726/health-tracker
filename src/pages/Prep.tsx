import { useMemo, useState } from 'react';
import type { Page } from '../App';
import { useSync, shortDate, longDate, Empty, GymSelect, useCurrentGym, todayISO, setPrefill, fmt } from '../ui/common';
import { currentProgram, dayOptions, prepRows, lastSessionItems, isCoreBlock, type PrepRow } from '../core/prep';
import type { ProgramItem } from '../core/model';

type Choice = { kind: 'program'; label: string } | { kind: 'last' };

export default function Prep({ go }: { go: (p: Page) => void }) {
  const s = useSync();
  const ds = s.dataset;
  const [gym, setGym] = useCurrentGym();
  const program = useMemo(() => currentProgram(ds.programs), [ds.programs]);
  const options = useMemo(() => (program ? dayOptions(program) : []), [program]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const today = todayISO();

  const last = useMemo(() => lastSessionItems(ds, gym), [ds, gym]);
  const atNonProgramGym = gym !== (s.config.gyms.defaultGym || 'Home gym') && !!last;
  const active: Choice = choice ?? (options.length && !atNonProgramGym ? { kind: 'program', label: options[0].label } : last ? { kind: 'last' } : { kind: 'program', label: options[0]?.label ?? '' });
  const opt = active.kind === 'program' ? options.find(o => o.label === active.label) ?? options[0] : null;
  const items: ProgramItem[] = active.kind === 'last' ? last?.items ?? [] : opt?.block.items ?? [];

  const rows = useMemo(() => prepRows(items, ds, gym, {
    today, factorOverrides: s.config.gyms.factorOverrides, defaultGym: s.config.gyms.defaultGym, perHand: s.config.settings.carryWeightPerHand,
  }), [items, ds, gym, today, s.config.gyms, s.config.settings.carryWeightPerHand]);

  if (!program && !last) return <Empty title="Nothing to prep yet">Once a coach program sheet or a logged session is in the folder, today's plan shows up here.</Empty>;

  const log = (r: PrepRow) => { setPrefill({ exercise: r.item.display, weight: r.target?.weight ?? r.estimateHere?.weight ?? r.last?.weight ?? null, reps: null }); go('quick'); };

  return (
    <>
      <div className="prep-head card">
        <div className="prep-title">
          <div className="eyebrow">{active.kind === 'program' ? (opt?.isNext ? 'Next up' : 'Chosen day') : 'Repeat'}</div>
          <h2>{active.kind === 'program' ? `${prettyDay(opt?.label ?? '')}${opt?.week != null ? ` · Week ${opt.week}` : ''}` : `Last session at ${gym}`}</h2>
          <div className="sub">
            {active.kind === 'program' ? <>from <b>{program?.fileName}</b></> : last ? <>from {longDate(last.date)}</> : null}
            {' · '}numbers are from your last session at <b>{gym}</b>
          </div>
        </div>
        <label className="prep-gym">I'm training at<GymSelect value={gym} onChange={g => { setGym(g); setChoice(null); }} compact /></label>
      </div>

      <div className="chips" role="tablist" aria-label="Day" style={{ margin: '12px 0' }}>
        {options.map(o => (
          <button key={o.label} role="tab" aria-selected={active.kind === 'program' && opt?.label === o.label} className={`chip ${active.kind === 'program' && opt?.label === o.label ? 'on' : ''}`} onClick={() => setChoice({ kind: 'program', label: o.label })}>
            {prettyDay(o.label)}{o.isNext && <span className="v">next</span>}
          </button>
        ))}
        {last && <button role="tab" aria-selected={active.kind === 'last'} className={`chip ${active.kind === 'last' ? 'on' : ''}`} onClick={() => setChoice({ kind: 'last' })}>Repeat last {gym} session <span className="v">{shortDate(last.date)}</span></button>}
      </div>

      <div className="prep-list">
        {rows.map((r, i) => <PrepCard key={r.item.exercise + i} r={r} gym={gym} onLog={() => log(r)} isCore={!!opt && isCoreBlock(opt.block)} />)}
        {!rows.length && <Empty title="No exercises in this block" />}
      </div>
      <p className="hint" style={{ marginTop: 12 }}>
        Targets use double progression: reach the top of the rep range, then add weight. "PR" is the set that beats your best estimated 1RM at this gym. Each gym is compared only to itself; other gyms are converted only when both have recent all-out sets (Settings → Gyms).
      </p>
    </>
  );
}

const prettyDay = (l: string) => l.replace(/^FB\s+/i, '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/ Day$/, ' day');

function PrepCard({ r, gym, onLog, isCore }: { r: PrepRow; gym: string; onLog: () => void; isCore: boolean }) {
  const t = r.target;
  return (
    <div className={`card prep-card ${r.plateau ? 'flag' : ''}`}>
      <div className="prep-ex">
        <div className="name">{r.item.display}</div>
        <div className="hint">{[r.item.prescription.trim(), ...r.item.notes].filter(Boolean).join(' · ') || (isCore ? 'core' : '')}</div>
      </div>
      <div className="prep-last">
        <div className="eyebrow">Last time here</div>
        {r.kind === 'endurance'
          ? <div className="val">{r.enduranceText ?? '—'}{r.endurance && <span className="hint"> · {shortDate(r.endurance.date)}</span>}</div>
          : r.last ? <div className="val">{r.last.weight ?? 'BW'} × {r.last.reps}<span className="hint"> · {shortDate(r.last.date)} · est. 1RM {fmt(r.last.e1rm, 0)}</span></div>
            : r.lastElsewhere ? <div className="val dim">never at {gym}<span className="hint"> · {r.lastElsewhere.gym}: {r.lastElsewhere.weight} × {r.lastElsewhere.reps} ({shortDate(r.lastElsewhere.date)})</span></div>
              : <div className="val dim">no history yet</div>}
      </div>
      <div className="prep-target">
        <div className="eyebrow">Today</div>
        {r.kind === 'endurance' ? <div className="val">{r.endurance ? 'beat your best time / distance' : 'set a baseline'}</div>
          : t ? (
            <>
              <div className="val big">{t.text}</div>
              <div className="hint">{t.why}{t.prText !== t.text ? <> · PR: <b>{t.prText}</b></> : /PR/.test(t.why) ? null : ' — a PR'}</div>
            </>
          ) : r.estimateHere ? (
            <>
              <div className="val big">≈ {r.estimateHere.weight} × 8–10</div>
              <div className="hint">converted from {r.estimateHere.from.gym} {r.estimateHere.from.weight} × {r.estimateHere.from.reps} (×{r.estimateHere.factor.toFixed(2)})</div>
            </>
          ) : <div className="val dim">pick a weight where the rep range is all-out — that's your baseline here</div>}
        {r.plateau && <div className="plateau">No new best in {r.plateau.sessions} sessions (best {fmt(r.plateau.best, 0)} on {shortDate(r.plateau.bestDate)}). Try: one extra rep, a slower negative, or a 10% lighter week.</div>}
      </div>
      <div className="prep-act"><button className="btn small" onClick={onLog}>Log</button></div>
    </div>
  );
}

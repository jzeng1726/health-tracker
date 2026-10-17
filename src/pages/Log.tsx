import { useMemo, useState } from 'react';
import { useSync, shortDate, longDate, todayISO, useToast, Empty } from '../ui/common';
import { sessionsByExercise, strengthPRs } from '../core/strength';
import { enduranceSessions, endurancePRs } from '../core/endurance';
import { toDay, fromDay } from '../core/bodyweight';
import { SETUP_TAGS, TAG_LABEL, readLifeNote } from '../core/notes';
import { logLife } from '../sync/engine';

type Kind = 'life' | 'note' | 'pr';
interface Ev { date: string; until?: string; kind: Kind; title: string; text?: string; badge?: string; sub?: string; key: string }

const KIND_LABEL: Record<Kind, string> = { life: 'Life', note: 'Note', pr: 'PR' };
const LIFE_CHIPS = ['Going on vacation', 'Sick this week', 'Bad sleep', 'Busy / stressful week', 'Deload week', 'Tweaked something', 'Traveling'];

export default function Log() {
  const s = useSync();
  const ds = s.dataset;
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [day, setDay] = useState<string | null>(null);

  const { events, trained } = useMemo(() => {
    const ev: Ev[] = [];
    for (const l of ds.life) ev.push({ date: l.date, until: l.until, kind: 'life', title: l.text, sub: l.until ? `through ${shortDate(l.until)}` : undefined, key: `l:${l.ref}` });
    for (const n of ds.notes) {
      const setup = n.tags.filter(t => SETUP_TAGS.includes(t));
      ev.push({
        date: n.date, kind: 'note', title: ds.exercises[n.exercise]?.display ?? n.exercise, text: n.text, key: `n:${n.key}`,
        badge: n.setupChange ? `new baseline · ${setup.map(t => TAG_LABEL[t]).join(', ')}` : n.tags.length ? n.tags.map(t => TAG_LABEL[t]).join(', ') : undefined,
        sub: [n.set, n.gym].filter(Boolean).join(' · '),
      });
    }
    const byEx = sessionsByExercise(ds.sets);
    for (const p of strengthPRs(byEx)) ev.push({ date: p.date, kind: 'pr', title: ds.exercises[p.exercise]?.display ?? p.exercise, badge: p.kind === 'e1RM' ? `est. max ${p.value}` : `heaviest ${p.value}`, sub: [p.detail, p.gym].filter(Boolean).join(' · '), key: `p:${p.exercise}:${p.gym}:${p.date}:${p.kind}` });
    for (const p of endurancePRs(enduranceSessions(ds.endurance, s.config.settings.carryWeightPerHand), ds.exercises)) ev.push({ date: p.date, kind: 'pr', title: ds.exercises[p.exercise]?.display ?? p.exercise, badge: `${p.kind} ${p.value}`, sub: p.detail, key: `e:${p.exercise}:${p.date}:${p.kind}` });
    ev.sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
    const tr = new Map<string, Set<string>>();
    for (const x of [...ds.sets, ...ds.endurance]) tr.set(x.date, (tr.get(x.date) ?? new Set()).add(x.gym));
    return { events: ev, trained: tr };
  }, [ds, s.config.settings.carryWeightPerHand]);

  const shown = events.filter(e => (filter === 'all' || e.kind === filter) && (!day || covers(e, day)));
  const byDate = new Map<string, Ev[]>();
  for (const e of shown) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <>
      <div className="grid log-top">
        <Calendar month={month} setMonth={setMonth} events={events} trained={trained} day={day} setDay={setDay} filter={filter} />
        <LifeForm />
      </div>

      <div className="section" style={{ alignItems: 'center' }}>
        <h2>{day ? longDate(day) : 'Timeline'}</h2>
        {day && <button className="btn small ghost" onClick={() => setDay(null)}>Show everything</button>}
        <span style={{ marginLeft: 'auto' }} className="chips" role="tablist" aria-label="Show">
          {(['all', 'life', 'note', 'pr'] as const).map(k => (
            <button key={k} role="tab" aria-selected={filter === k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
              {k === 'all' ? 'All' : k === 'life' ? 'Life' : k === 'note' ? 'Exercise notes' : 'PRs'}
              <span className="v">{k === 'all' ? events.length : events.filter(e => e.kind === k).length}</span>
            </button>
          ))}
        </span>
      </div>

      {shown.length ? (
        <div className="card timeline">
          {[...byDate.entries()].map(([date, list]) => (
            <div key={date} className="tl-day">
              <div className="tl-date"><b>{shortDate(date)}</b><span className="hint">{new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</span>
                {trained.get(date) && <span className="hint">trained · {[...trained.get(date)!].join(', ')}</span>}</div>
              <div className="tl-items">
                {list.map(e => (
                  <div key={e.key} className={`tl-item k-${e.kind}`}>
                    <span className={`tl-kind k-${e.kind}`}>{e.kind === 'life' ? '☀' : e.kind === 'note' ? '✎' : '★'} {KIND_LABEL[e.kind]}</span>
                    <div className="tl-body">
                      <div><b>{e.title}</b>{e.sub && <span className="hint"> · {e.sub}</span>}</div>
                      {e.text && <div className="tl-text">“{e.text}”</div>}
                      {e.badge && <span className={`pill ${e.kind === 'note' && e.badge.startsWith('new baseline') ? 'note' : e.kind === 'pr' ? 'pr' : ''}`}>{e.badge}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : <Empty title={day ? 'Nothing logged that day' : 'Nothing here yet'}>Notes you write next to a set (in your sheets or Quick Entry), life notes and PRs show up here.</Empty>}
    </>
  );
}

const covers = (e: Ev, d: string) => e.date === d || (!!e.until && e.date <= d && d <= e.until);

function Calendar({ month, setMonth, events, trained, day, setDay, filter }: {
  month: string; setMonth: (m: string) => void; events: Ev[]; trained: Map<string, Set<string>>; day: string | null; setDay: (d: string | null) => void; filter: Kind | 'all';
}) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const startDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = toDay(first) - startDow;
  const cells = Array.from({ length: Math.ceil((startDow + daysIn) / 7) * 7 }, (_, i) => fromDay(start + i));
  const shift = (n: number) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); setDay(null); };
  const today = todayISO();
  const show = (k: Kind) => filter === 'all' || filter === k;
  return (
    <div className="card cal">
      <div className="cal-head">
        <button className="btn small ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <h2>{new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h2>
        <button className="btn small ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
        <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</button>
      </div>
      <div className="cal-grid" role="grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="cal-dow">{d}</div>)}
        {cells.map(d => {
          const evs = events.filter(e => covers(e, d));
          const life = show('life') ? evs.filter(e => e.kind === 'life') : [];
          const notes = show('note') ? evs.filter(e => e.kind === 'note') : [];
          const prs = show('pr') ? evs.filter(e => e.kind === 'pr') : [];
          const gyms = trained.get(d);
          const label = [longDate(d), gyms ? `trained at ${[...gyms].join(', ')}` : '', life.map(l => l.title).join('; '), notes.length ? `${notes.length} note${notes.length > 1 ? 's' : ''}` : '', prs.length ? `${prs.length} PR${prs.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
          return (
            <button key={d} role="gridcell" aria-label={label} title={label} onClick={() => setDay(day === d ? null : d)}
              className={`cal-day ${d.slice(0, 7) !== month ? 'out' : ''} ${gyms ? 'trained' : ''} ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`}>
              <span className="n">{Number(d.slice(8))}</span>
              {life.length > 0 && <span className="cal-life">{life[0].title}</span>}
              <span className="cal-marks">
                {notes.length > 0 && <span className="m-note">✎{notes.length > 1 ? notes.length : ''}</span>}
                {prs.length > 0 && <span className="m-pr">★{prs.length > 1 ? prs.length : ''}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-legend">
        <span className="k"><span className="sw trained" />trained</span>
        <span className="k"><span className="m-pr">★</span>PR</span>
        <span className="k"><span className="m-note">✎</span>exercise note</span>
        <span className="k"><span className="sw life" />life note</span>
        <span className="hint">click a day to see it</span>
      </div>
    </div>
  );
}

function LifeForm() {
  const s = useSync();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [until, setUntil] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tags = text.trim() ? readLifeNote(text) : [];
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await logLife(date, text, until && until > date ? until : undefined);
      toast(`Saved → ${r.where}`); setText(''); setUntil('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="card form" onSubmit={e => { e.preventDefault(); if (text.trim()) save(); }}>
      <h2>Add a life note</h2>
      <div className="sub" style={{ margin: 0 }}>Things that explain a good or bad stretch. Saved to the "Life Log" tab of your Training Log.</div>
      <div className="row">
        <label>From<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>Until · optional<input type="date" value={until} min={date} onChange={e => setUntil(e.target.value)} /></label>
      </div>
      <label>Note<input value={text} onChange={e => setText(e.target.value)} placeholder="Going on vacation" /></label>
      <div className="chips">{LIFE_CHIPS.map(c => <button type="button" key={c} className="chip small" onClick={() => setText(c)}>{c}</button>)}</div>
      {tags.length > 0 && <div className="hint ok">Read as: {tags.join(', ')}</div>}
      <button className="btn primary" disabled={!text.trim() || busy || s.auth !== 'connected'}>{busy ? 'Saving…' : 'Save life note'}</button>
      {s.auth !== 'connected' && <div className="hint bad">Connect Google to save.</div>}
      {err && <div className="hint bad" role="alert">{err}</div>}
    </form>
  );
}

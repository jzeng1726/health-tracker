import { useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Line, Scatter, ReferenceLine, ReferenceArea, Area } from 'recharts';
import { useSync, useRange, Tile, fmt, signed, shortDate, longDate, Empty, Section, TipBox, axisProps, dayTick, inRange, BandPill, StaleNote } from '../ui/common';
import { movingAverage, bodyweightStats, weeklyAverages, toDay, fromDay, lossBand } from '../core/bodyweight';
import { setConfigKey } from '../sync/engine';

const loadRaw = () => { try { return localStorage.getItem('bw.raw') !== '0'; } catch { return true; } };

export default function Bodyweight() {
  const s = useSync();
  const { bounds } = useRange();
  const [showRaw, setShowRaw] = useState(loadRaw);
  const [goalDraft, setGoalDraft] = useState<string>('');
  const goal = s.config.goals.goalWeightLb;

  const d = useMemo(() => {
    const ma = movingAverage(s.dataset.bodyweight);
    const pts = ma.filter(p => inRange(p.date, bounds));
    return { ma, pts, stats: bodyweightStats(ma, bounds.start, goal), weeks: weeklyAverages(s.dataset.bodyweight.filter(e => inRange(e.date, bounds))) };
  }, [s.dataset.bodyweight, bounds, goal]);

  if (!s.dataset.bodyweight.length) {
    return <Empty title="No weigh-ins found">Add a sheet with <b>Date</b> and <b>Morning Weight</b> columns to the Health Tracker folder, or log one in Quick Entry.</Empty>;
  }
  const st = d.stats;
  const { lossRateMinPct: bMin, lossRateMaxPct: bMax } = s.config.settings;
  const band = d.pts.length ? lossBand(d.pts[0].ma, toDay(d.pts[0].date), d.pts.map(p => toDay(p.date)), bMin, bMax) : [];
  const chart = d.pts.map((p, i) => ({ day: toDay(p.date), ma: Number(p.ma.toFixed(2)), raw: p.raw, partial: p.partial, n: p.n, band: band[i] ? [band[i].lo, band[i].hi] : undefined }));
  const toggleRaw = () => { const v = !showRaw; setShowRaw(v); try { localStorage.setItem('bw.raw', v ? '1' : '0'); } catch { /* ignore */ } };
  const ys = chart.flatMap(c => (showRaw ? [c.ma, c.raw] : [c.ma])).concat(goal != null && st.current != null && st.current - goal < 8 ? [goal] : []).concat(band.length ? [band.at(-1)!.lo] : []);

  return (
    <>
      <StaleNote stats={st} />
      <div className="grid cards">
        <Tile label="Current weight · 7-day average" value={fmt(st.current, 1)} unit="lb" foot={st.currentPartial ? <span className="pill low">partial average (first 6 days of the sheet)</span> : st.lastDate && <>through {shortDate(st.lastDate)}{st.currentN < 4 && <span className="pill low">from {st.currentN} weigh-in{st.currentN === 1 ? '' : 's'}</span>}</>} />
        <Tile label="Total lost" value={fmt(st.totalLost, 1)} unit="lb" foot={st.startDate && `from ${fmt(st.start)} lb (7-day avg on ${shortDate(st.startDate)})`} />
        <Tile label="Bodyweight lost" value={st.pctLost == null ? '—' : (st.pctLost * 100).toFixed(2)} unit="%" />
        <Tile label="Weekly loss rate" value={fmt(st.weeklyRate, 2)} unit="lb/wk" foot={st.weeklyRatePct != null ? <>{(st.weeklyRatePct * 100).toFixed(2)}% BW/week <BandPill pct={st.weeklyRatePct} min={bMin} max={bMax} /></> : 'needs a 7-day average from a week earlier'} />
      </div>

      <Section title="7-day moving average" sub={`Bold line = 7-day average (all stats use it). Dots = daily weigh-ins. Shaded = target zone, ${bMin}–${bMax}% of bodyweight per week from the start of the range.`}
        right={<label className="toggle"><input type="checkbox" checked={showRaw} onChange={toggleRaw} />Show daily weigh-ins</label>} />
      <div className="card">
        {(
          <div className="legend" style={{ marginBottom: 6 }}>
            <span className="k"><span className="line" />7-day average</span>
            {showRaw && <span className="k"><span className="dotk" />Daily weigh-in</span>}
            <span className="k"><span className="bandk" />Target zone {bMin}–{bMax}%/wk</span>
            {goal != null && <span className="k"><span className="line" style={{ background: 'var(--muted)' }} />Goal {goal} lb</span>}
          </div>
        )}
        {chart.length ? (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={dayTick} {...axisProps} minTickGap={24} />
                <YAxis {...axisProps} axisLine={false} width={48} domain={[Math.floor(Math.min(...ys) - 0.5), Math.ceil(Math.max(...ys) + 0.5)]} tickFormatter={v => `${v}`} />
                {goal != null && <ReferenceLine y={goal} stroke="var(--muted)" label={{ value: `Goal ${goal}`, position: 'insideBottomRight', fill: 'var(--ink-2)', fontSize: 11 }} />}
                <Tooltip cursor={{ stroke: 'var(--axis)' }} isAnimationActive={false} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload;
                  return <TipBox title={longDate(fromDay(p.day))} rows={[
                    { label: p.partial ? `7-day avg (partial, ${p.n} day${p.n > 1 ? 's' : ''})` : p.n < 4 ? `7-day avg (only ${p.n} weigh-in${p.n > 1 ? 's' : ''})` : '7-day average', value: `${p.ma.toFixed(1)} lb`, color: 'var(--series-1)' },
                    { label: 'weigh-in', value: `${p.raw} lb`, color: 'var(--raw-dot)', dot: true },
                    ...(p.band ? [{ label: 'target zone', value: `${p.band[0].toFixed(1)}–${p.band[1].toFixed(1)} lb`, color: 'var(--band-edge)' }] : []),
                  ]} />;
                }} />
                {chart.length > 1 && s.dataset.life.filter(l => (l.until ?? l.date) >= fromDay(chart[0].day) && l.date <= fromDay(chart.at(-1)!.day)).map((l, i) => l.until
                  ? <ReferenceArea key={i} x1={Math.max(toDay(l.date), chart[0].day)} x2={Math.min(toDay(l.until), chart.at(-1)!.day)} fill="var(--life)" fillOpacity={1} stroke="none" label={{ value: l.text, position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 10 }} />
                  : <ReferenceLine key={i} x={toDay(l.date)} stroke="var(--life-edge)" strokeDasharray="3 3" label={{ value: l.text, position: 'insideTopLeft', fill: 'var(--ink-2)', fontSize: 10 }} />)}
                <Area dataKey="band" stroke="var(--band-edge)" strokeDasharray="4 3" strokeWidth={1} fill="var(--band-fill)" isAnimationActive={false} activeDot={false} />
                {showRaw && <Scatter dataKey="raw" fill="var(--raw-dot)" isAnimationActive={false} shape={(p: any) => <circle cx={p.cx} cy={p.cy} r={3.5} fill="var(--raw-dot)" />} />}
                <Line dataKey="ma" stroke="var(--series-1)" strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} strokeLinecap="round" strokeLinejoin="round" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : <div className="hint">No weigh-ins in this date range.</div>}
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Goal</h2>
          <div className="sub">Projected from the 7-day average's trend over the last 3 weeks</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input type="number" step="0.1" placeholder={goal != null ? String(goal) : 'e.g. 155'} value={goalDraft} onChange={e => setGoalDraft(e.target.value)} style={{ width: 120 }} aria-label="Goal weight (lb)" />
            <button className="btn" disabled={!goalDraft || isNaN(Number(goalDraft))} onClick={() => { setConfigKey('goals', { ...s.config.goals, goalWeightLb: Number(goalDraft) }); setGoalDraft(''); }}>Set goal</button>
            {goal != null && <button className="btn ghost small" onClick={() => setConfigKey('goals', { ...s.config.goals, goalWeightLb: undefined })}>Clear</button>}
          </div>
          {goal != null ? (
            <>
              <div className="tile-value">{st.projectedDate ? longDate(st.projectedDate) : '—'}</div>
              <div className="tile-foot">{st.projectionNote}{st.current != null && ` · ${fmt(st.current - goal)} lb to go`}</div>
            </>
          ) : <div className="hint">{st.projectionNote}</div>}
        </div>
        <div className="card table-wrap">
          <h2>Weekly averages</h2>
          <div className="sub">Monday–Sunday average of daily weigh-ins</div>
          <table>
            <thead><tr><th>Week</th><th className="n">Avg (lb)</th><th className="n">Weigh-ins</th><th className="n">vs prev week</th></tr></thead>
            <tbody>
              {[...d.weeks].reverse().map(w => (
                <tr key={w.weekStart}>
                  <td>{shortDate(w.weekStart)} – {shortDate(w.weekEnd)}</td>
                  <td className="n">{w.avg.toFixed(1)}</td>
                  <td className="n">{w.n}/7</td>
                  <td className="n">{w.change == null ? '—' : <span className={w.change < 0 ? 'delta-good' : w.change > 0 ? 'delta-bad' : ''}>{signed(w.change, 1)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

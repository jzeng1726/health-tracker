"""Phase 3 — independent verification. Reads the raw .xlsx exports / Week 01 text export
with openpyxl (no app code), recomputes expected values, compares with what the app displays."""
import json, datetime, openpyxl, re
import os; os.chdir(os.environ.get('SCRATCH', '.'))
app = json.load(open('app-values.json'))
fc = openpyxl.load_workbook('fc.xlsx')['Sheet1']
fb = openpyxl.load_workbook('fb.xlsx')['Sheet1']
wk1 = [l.split('|')[1:-1] for l in open('/home/claude/health-tracker/fixtures/fb-week-01.md') if l.startswith('|')]
def w1(ref):  # Week 01 cell text from its export
    col = ord(ref[0]) - 65; row = int(ref[1:]) - 1
    return wk1[row][col].strip()
rows_out = {}; fails = []
def check(tab, what, source, expected, got, tol=0.051, fmt=lambda v: f"{v:.2f}" if isinstance(v, float) else str(v)):
    ok = (abs(expected - got) <= tol) if isinstance(expected, (int, float)) and isinstance(got, (int, float)) else expected == got
    rows_out.setdefault(tab, []).append((what, source, fmt(expected), fmt(got), 'OK' if ok else 'MISMATCH'))
    if not ok: fails.append((tab, what, expected, got))
epley = lambda w, r: w * (1 + r / 30)

# ---------------- Bodyweight: read raw B/C columns
bw = {}
for r in fc.iter_rows(min_row=1):
    b, c = r[1].value, r[2].value
    if isinstance(b, datetime.datetime) and isinstance(c, (int, float)):
        bw[b.date()] = (float(c), f"B{r[1].row}/C{r[2].row}")
days = sorted(bw)
first = days[0]
def ma(d):
    win = [bw[x][0] for x in days if 0 <= (d - x).days <= 6]
    return sum(win) / len(win), len(win)
for d in [datetime.date(2026, 8, 23), datetime.date(2026, 8, 26), datetime.date(2026, 8, 29), datetime.date(2026, 9, 1), datetime.date(2026, 9, 5),
          datetime.date(2026, 9, 10), datetime.date(2026, 9, 15), datetime.date(2026, 9, 18), datetime.date(2026, 9, 21), datetime.date(2026, 9, 24)]:
    exp, n = ma(d)
    a = app['ma'][d.isoformat()]
    check('Bodyweight', f"7-day avg {d.month}/{d.day}{' (partial, '+str(n)+' days)' if (d-first).days < 6 else ''}", f"Fall Cut {bw[d][1]}: weigh-in {bw[d][0]}", exp, a['ma'], tol=0.0005, fmt=lambda v: f"{v:.3f}")
    if (d - first).days < 6: check('Bodyweight', f"partial label {d.month}/{d.day}", 'first 6 days of sheet', True, a['partial'])
cur, _ = ma(days[-1]); start, _ = ma(first); wk, _ = ma(days[-1] - datetime.timedelta(days=7))
st = app['stats']
check('Bodyweight', 'Current weight (7-day avg)', 'MA 9/24', cur, st['current'], tol=0.0005, fmt=lambda v: f"{v:.3f}")
check('Bodyweight', 'Total lost', 'MA 8/23 − MA 9/24', start - cur, st['totalLost'], tol=0.0005, fmt=lambda v: f"{v:.3f}")
check('Bodyweight', '% bodyweight lost', '(total lost) ÷ MA 8/23', 100 * (start - cur) / start, 100 * st['pctLost'], tol=0.005, fmt=lambda v: f"{v:.2f}%")
check('Bodyweight', 'Weekly loss rate lb/wk', 'MA 9/17 − MA 9/24', wk - cur, st['weeklyRate'], tol=0.0005, fmt=lambda v: f"{v:.3f}")
check('Bodyweight', '% BW / week', 'rate ÷ MA 9/17', 100 * (wk - cur) / wk, 100 * st['weeklyRatePct'], tol=0.005, fmt=lambda v: f"{v:.3f}%")
# Mon–Sun weekly averages
for mon in [datetime.date(2026, 8, 24), datetime.date(2026, 9, 7), datetime.date(2026, 9, 21)]:
    vals = [bw[x][0] for x in days if 0 <= (x - mon).days <= 6]
    a = next(w for w in app['weeks'] if w['weekStart'] == mon.isoformat())
    check('Bodyweight', f"Weekly avg {mon.month}/{mon.day}–{(mon+datetime.timedelta(6)).month}/{(mon+datetime.timedelta(6)).day} ({len(vals)} weigh-ins)", 'Mon–Sun raw weigh-ins', sum(vals) / len(vals), a['avg'], tol=0.0005, fmt=lambda v: f"{v:.3f}")

# ---------------- Strength: my manual reading of each raw cell -> Epley
S = [  # (sheet, cell, exercise key in app, ISO date, (weight, reps) as I read the cell)
  ('fb', 'C7', 'machine dip', '2026-08-30', (210, 10.5)),
  ('fb', 'I7', 'machine dip', '2026-09-03', (210, 11)),
  ('fb', 'C63', 'machine dip', '2026-09-22', (210, 13)),
  ('w1', 'C16', 'machine dip', '2026-08-25', (195, 10)),   # "Seated Dip Machine" 195x10-12 -> merged, lower bound
  ('fb', 'C9', 't bar wide grip', '2026-08-30', (135, 7.5)),
  ('fb', 'F37', 't bar wide grip', '2026-09-12', (140, 6.5)),  # 140x6.5-7 -> lower bound
  ('fb', 'F7', '45 degree back extension', '2026-09-01', (55, 12)),
  ('fb', 'I25', '45 degree back extension', '2026-09-04', (60, 10.5)),  # below the 9/4 marker in I17
  ('fb', 'F17', 'machine chest press', '2026-09-01', (210, 8)),
  ('fb', 'I45', 'machine chest press', '2026-09-16', (210, 12)),
  ('fb', 'I4', 'single arm lat raise', '2026-09-03', (50, 20)),
  ('fb', 'I32', 'single arm lat raise', '2026-09-16', (70, 16)),  # L 15.5 / R 16 -> best side
  ('fb', 'C41', 'lying leg curl', '2026-09-09', (110, 10.5)),     # approved: ignore "-75"
  ('fb', 'F51', 'lying leg curl', '2026-09-14', (110, 11)),       # "Laying" merged; below 9/14 marker F45
  ('fb', 'C75', 'seated toe press calf', '2026-09-23', (345, 5)),
  ('fb', 'C15', 'v bar lat pulldown', '2026-08-30', (130, 9)),    # sheet says 13x9 -> approved correction
  ('fb', 'C11', 'recline curl', '2026-08-30', (30, 9)),
]
for sh, cell, ex, date, (w, r) in S:
    raw = fb[cell].value if sh == 'fb' else w1(cell)
    s = next((x for x in app['sessions'][ex] if x['date'] == date), None)
    check('Strength', f"{ex} {date[5:]} est. 1RM", f"{'Wk2-4' if sh=='fb' else 'Wk01'}!{cell} `{raw}` → {w}×{r}", epley(w, r), s['e1rm'] if s else -1, tol=0.001, fmt=lambda v: f"{v:.2f}")
# volume
check('Strength', 'lat raise 9/16 volume (L+R sets)', 'Wk2-4!I32 70×15.5 + 70×16', 70 * 15.5 + 70 * 16, next(x for x in app['sessions']['single arm lat raise'] if x['date'] == '2026-09-16')['volume'], fmt=lambda v: f"{v:.1f}")
# % change + muscle scores from first/last sessions (manual)
pct = lambda a, b: epley(*b) / epley(*a) - 1
dips = pct((195, 10), (210, 13)); cp = pct((210, 8), (210, 12))
check('Strength', 'Machine Dips % change', 'Wk01!C16 195×10 → Wk2-4!C63 210×13', 100 * dips, 100 * app['progress']['machine dip'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")
check('Strength', 'Chest score', 'avg(Dips, Chest Press) — both primary', 100 * (dips + cp) / 2, 100 * app['scores']['Chest'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")
hb = pct((45, 13), (80, 15)); lc = pct((110, 8.5), (110, 10.5))
check('Strength', 'Hamstrings score', '45° ext Wk01!C7 45×13→C81 80×15; leg curl Wk01 110×8.5→C79 110×10.5', 100 * (hb + lc) / 2, 100 * app['scores']['Hamstrings'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")
kb = pct((40, 10), (60, 12)); rp = pct((90, 11), (90, 11.5))
check('Strength', 'Triceps score', 'TriExt 40×10→60×12 (1), pushdown (1), dips (½), chest press (½)', 100 * (kb + rp + .5 * dips + .5 * cp) / 3, 100 * app['scores']['Triceps'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")
lr = pct((30, 12), (70, 17))
check('Strength', 'Shoulders score', 'lat raise 30×12→70×17 (1), chest press (½)', 100 * (lr + .5 * cp) / 1.5, 100 * app['scores']['Shoulders'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")
week = next(w for w in app['weeklySets'] if w['week'] == '2026-09-21')
check('Strength', 'Weekly sets Back, wk of 9/21', 'T-Bar C65 + V-Bar C72 + ½ of 45° ext C81', 2.5, week['Back'])
check('Strength', 'Weekly sets Triceps, wk of 9/21', 'Tri Ext C69 + ½ Dips C63', 1.5, week['Triceps'])

# ---------------- Endurance: every time value in the sheets, read with X:YY = min:sec
def rule(t):
    t = t.strip().rstrip('m')
    p = [int(x) for x in re.split('[:.]', t)]
    return p[0] * 60 + p[1] if len(p) == 2 else p[0] * 3600 + p[1] * 60 + p[2]
E = []
for m in re.finditer(r'R(\d)[.-]\s*(\d+)x(\d+:\d{2}m?)', fb['I28'].value): E.append(('Farmers Carries', 'Wk2-4!I28', fb['I28'].value, m.group(3), int(m.group(2)), 'farmer carry', '2026-09-04', int(m.group(1))))
for m in re.finditer(r'R(\d)[.-]\s*(\d+)x(\d+:\d{2}m?)', fb['C85'].value): E.append(('Static holds', 'Wk2-4!C85', fb['C85'].value, m.group(3), int(m.group(2)), 'static hold', '2026-09-23', int(m.group(1))))
for label, ref, raw, part, w, ex, date, rnd in E:
    a = next(x for x in app['endurance'] if x['exercise'] == ex and x['round'] == rnd)
    check('Endurance', f"{label} R{rnd} time ({part} → {rule(part)//60} min {rule(part)%60} s)", f"{ref} `{raw}` (text)", rule(part), a['seconds'], tol=0)
    check('Endurance', f"{label} R{rnd} weight", ref, w, a['weight'], tol=0)
pl = fb['L8'].value  # datetime.time(2,0) — Sheets stored it as 2:00 AM
serial_seconds = pl.hour * 3600 + pl.minute * 60
display = f"{pl.hour}:{pl.minute:02d}"  # number format h:mm
check('Endurance', f"Plank time: display '{display}' → 2 min 0 s (NOT {serial_seconds} s)", f"Wk2-4!L8 stored as time-of-day {pl} (serial {serial_seconds/86400:.5f})", rule(display), app['plankSeconds'], tol=0)
run_raw = w1('L12')
check('Endurance', "1 Mile Run 8/27: '8.26' → 8:26 (approved)", f"Wk01!L12 `{run_raw}`", 8 * 60 + 26, next(x for x in app['endurance'] if x['exercise'] == '1 mile run')['seconds'], tol=0)
run = next(s for s in app['endSessions'] if s['type'] == 'run')
check('Endurance', 'Run pace (min/mi)', '506 s ÷ 1 mile (from name)', 506.0, run['paceSecPerMi'], tol=0.001)
car = next(s for s in app['endSessions'] if s['type'] == 'farmer_carry')
check('Endurance', 'Carry total load × time', '(70×2)×100 + (70×2)×60, per-hand weights', 140 * 100 + 140 * 60, car['loadTime'], tol=0)
hold = next(s for s in app['endSessions'] if s['type'] == 'static_hold')
check('Endurance', 'Holds total time under load', '93 + 104 s', 197, hold['seconds'], tol=0)
check('Endurance', 'Longest hold @80 lb', 'max(93, 104)', 104, hold['longestSeconds'], tol=0)
lunge = next(s for s in app['endSessions'] if s['type'] == 'walking_lunge' and s['date'] == '2026-09-01')
check('Endurance', "Walking lunges 9/1 steps ('45x10 each')", 'Wk2-4!F28 10 per leg × 2', 20, lunge['steps'], tol=0)

# ---------------- Dashboard tiles
check('Dashboard', 'Current weight tile', 'MA 9/24', round(cur, 1), round(st['current'], 1), fmt=lambda v: f"{v:.1f}")
check('Dashboard', 'Total lost tile', 'MA 8/23 − MA 9/24', round(start - cur, 1), round(st['totalLost'], 1), fmt=lambda v: f"{v:.1f}")
check('Dashboard', 'Weekly loss rate tile', 'MA 9/17 − MA 9/24', round(wk - cur, 2), round(st['weeklyRate'], 2), fmt=lambda v: f"{v:.2f}")
check('Dashboard', 'Workouts this week (Mon 9/21–Sun 9/27)', 'sessions dated 9/22 (C59) and 9/23 (C74)', 2, app['workoutsThisWeek'], tol=0)
check('Dashboard', 'Run mileage this week', 'no runs dated 9/21–9/27', 0, app['runMilesThisWeek'], tol=0)
check('Dashboard', 'Recent PR: Machine Dips 9/22 e1RM', 'Wk2-4!C63 210×13', epley(210, 13), next(x for x in app['sessions']['machine dip'] if x['date'] == '2026-09-22')['e1rm'], fmt=lambda v: f"{v:.1f}")
check('Dashboard', 'Recent PR flag: Dips 9/22 is a new best', 'max of all earlier dips e1RMs = 287.0', True, next(x for x in app['sessions']['machine dip'] if x['date'] == '2026-09-22')['isPR'])
check('Dashboard', 'Recent PR: V-Bar 9/22 e1RM', 'Wk2-4!C72 130×12', epley(130, 12), next(x for x in app['sessions']['v bar lat pulldown'] if x['date'] == '2026-09-22')['e1rm'], fmt=lambda v: f"{v:.1f}")
check('Dashboard', 'Recent PR: Lat Raise 9/22 e1RM', 'Wk2-4!C60 70×17', epley(70, 17), next(x for x in app['sessions']['single arm lat raise'] if x['date'] == '2026-09-22')['e1rm'], fmt=lambda v: f"{v:.1f}")
num = den = 0.0
for ex, info in app['exercises'].items():
    if info['kind'] != 'strength' or ex not in app['sessions']: continue
    ss = [x for x in app['sessions'][ex] if x['e1rm']]
    if not ss: continue
    p_ = ss[-1]['e1rm'] / ss[0]['e1rm'] - 1
    for m, w_ in [(info['primary'], 1.0)] + [(m2, 0.5) for m2 in info['secondary']]:
        if m: num += w_ * p_; den += w_
check('Dashboard', 'Overall strength (all muscles, primary 1 / secondary ½)', 'first→last best set of all 18 strength exercises', 100 * num / den, 100 * app['scores']['Overall'], tol=0.005, fmt=lambda v: f"{v:+.2f}%")

md = []
for tab, rows in rows_out.items():
    md.append(f"\n### {tab} — {sum(1 for r in rows if r[4]=='OK')}/{len(rows)} match\n\n| Check | Source cell (raw) | Expected (independent) | App shows | |\n|---|---|---|---|---|")
    md += [f"| {a} | {b} | {c} | {d} | {'✅' if e=='OK' else '❌'} |" for a, b, c, d, e in rows]
open('phase3-results.md', 'w').write('\n'.join(md))
print('\n'.join(md)); print('\nFAILS:', fails)

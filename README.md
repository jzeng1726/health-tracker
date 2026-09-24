# Health Tracker

A personal desktop app for **macOS and Windows 11** that tracks bodyweight, strength and endurance from the Google Sheets in your Drive folder **Health Tracker**. Google Sheets is the single source of truth. Both computers read from and write to the same sheets, and each keeps a local cache so it opens instantly and works offline.

- **Dashboard:** 7-day-average weight, total lost, weekly loss rate, overall strength %, recent PRs, workouts this week, run mileage.
- **Bodyweight:** 7-day moving average (bold line) over daily weigh-ins (faint dots), with Monday–Sunday weekly averages and a goal projection.
- **Strength:** estimated 1RM (Epley) and volume per exercise, % change for every muscle group and overall, weekly sets per muscle, PRs.
- **Endurance:** runs (pace, mileage), walking lunges, farmer carries, static holds and timed core, each with PRs and weekly totals.
- **Quick Entry:** log a weigh-in, a strength set or an endurance entry straight into your sheets.
- **Review:** confirm uncertain exercises, merge duplicates, date undated entries, map the columns of unknown sheets.
- **Settings:** refresh interval, goals, units, exercise map, reconnect Google, clear the cache, updates.

---

## 1. One-time setup

### Google Cloud (already done in Phase 0)
Project `Health Tracker` → Sheets API + Drive API enabled → OAuth consent screen **External / Testing**, with your Gmail address as a test user → **Desktop app** OAuth client.

**Scopes** (set these under *Google Auth Platform → Data Access*):

| Scope | Why |
|---|---|
| `…/auth/drive.readonly` | List the Health Tracker folder and follow shortcuts to sheets your coach shares with you |
| `…/auth/drive.file` | Create the app's own two files (`_config`, `Training Log`). This scope can only touch files the app created. |
| `…/auth/spreadsheets` | Read your sheets and write Quick Entry rows |

### GitHub repository secrets
*Repo → Settings → Secrets and variables → Actions → New repository secret*

| Secret | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | `client_id` from the OAuth JSON you downloaded |
| `GOOGLE_CLIENT_SECRET` | `client_secret` from the same JSON |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the updater private key file (signs updates so the app only installs builds from you) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The key's password (leave the secret empty if it has none) |

> A desktop app's client secret isn't truly confidential (Google says so for installed apps). It's kept out of the code anyway. Your sign-in token never leaves your computer's keychain.

---

## 2. Install

Builds run in GitHub Actions (**Actions → Build installers → Run workflow**) and are published to **Releases**.

### macOS (Apple Silicon or Intel)
1. Download `Health.Tracker_x.y.z_aarch64.dmg` (Apple Silicon: M1/M2/M3/M4) or `…_x64.dmg` (Intel). Not sure which? Open  → About This Mac. "Chip: Apple M…" means aarch64.
2. Open the .dmg and drag **Health Tracker** into **Applications**.
3. The app is unsigned (personal use), so Gatekeeper blocks the first launch:
   - **macOS 15 Sequoia or newer:** double-click the app → **Done** on the warning → **System Settings → Privacy & Security** → scroll down to *"Health Tracker" was blocked…* → **Open Anyway** → enter your Mac password → **Open**.
   - **macOS 14 or older:** right-click (or Control-click) the app in Applications → **Open** → **Open**.
   - If macOS says the app **"is damaged and can't be opened"** (this happens with downloaded unsigned apps), open Terminal and run the command below once, then open it normally:
     ```
     xattr -dr com.apple.quarantine "/Applications/Health Tracker.app"
     ```
4. You only need to do this once. Later updates install without the warning.
5. After an update, macOS may ask once whether **Health Tracker** can use your saved **Google token** in the keychain. Click **Always Allow**. (Unsigned apps get a new code identity with each version.)

### Windows 11
1. Download `Health.Tracker_x.y.z_x64_en-US.msi` (or `…_x64-setup.exe`).
2. Run it. If **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*, click **More info → Run anyway**.
3. If Edge blocks the download itself: open the Downloads panel → **…** next to the file → **Keep** → **Show more → Keep anyway**.
4. The installer adds Health Tracker to the Start menu. WebView2 comes with Windows 11; if it's ever missing, the installer downloads it.

### First launch (both computers)
Click **Connect Google**. Your browser opens Google's sign-in page. Sign in with the Google account you added as a test user. Google warns the app is unverified (expected in Testing mode): click **Continue** and allow access. Go back to the app. It finds the `Health Tracker` folder and syncs.

---

## 3. How sync works

- On launch the app shows the **cached** data immediately, then syncs.
- It refreshes on **launch**, when the **window regains focus**, **every 5 minutes** (change this in Settings), after every **Quick Entry**, and when you press **↻ Refresh**. The top bar shows *Last synced*.
- Change detection uses Drive's `modifiedTime`. Unchanged sheets are never re-downloaded.
- **Settings sync too.** The exercise map, goals, merges, corrections, column mappings and units live in a spreadsheet named **`_config`** in the Health Tracker folder (hidden tab `config`). Each setting is merged newest-wins, so a change on your MacBook shows up on your PC after its next refresh, and vice versa.
- **Offline:** everything stays viewable from the cache, and a banner says so. Setting changes made offline are pushed on the next successful sync.
- **Clear local cache** (Settings) deletes the local copy and re-downloads everything. It never touches your sheets.

---

## 4. Adding new sheets (no code changes)

Drop any Google Sheet, or a **shortcut** to a sheet someone shared with you, into the Health Tracker folder. On the next refresh the app classifies every tab by its **headers and contents**, never by the sheet's name:

| Detected as | How it's recognised | Example headers |
|---|---|---|
| **Bodyweight log** | a Date column + a weight column, no Exercise column. Repeated header blocks (like one block per week) are fine. | `Date`, `Morning Weight` |
| **Workout log** | Date + Exercise + any of load / sets / reps / time / distance | `Date`, `Exercise`, `Weight`, `Sets`, `Reps`, `Time`, `Distance` |
| **Program grid** | coach layout with `SETS / REPS` next to a result column (`DATE & WEIGHT`). Session dates are read from the result column. | FB A/B day sheets |
| **Skipped (derived)** | mostly formula output copied from another tab (e.g. `ChartData`), so nothing is counted twice | |

If a tab can't be classified it appears under **Review → Sheets that need column mapping**. Pick the header row and a role for each column once; the mapping is saved to `_config` for both computers.

Handled automatically: blank rows, `m/d` dates with or without a year, `3x8` sets×reps, `150x15,10,8`, `L-40x20 R-40x20`, `R1-45x8 R2-45x8`, half reps (`10.5`), notes after the numbers, and results one row below their exercise. **Rep ranges** (`12-13`) count as the lower number.

Things that are **flagged, never guessed**: unreadable times, weights far from your usual (possible typos), undated entries, unclear ranges. Fix them in **Review** with one click. The app stores the fix as a *correction* and reads your sheet through it; the sheet itself is never edited.

---

## 5. Time formats (important)

**Rule: any two-part time `X:YY` is ALWAYS X minutes YY seconds.** `1:30` = 1 min 30 s = 90 s. It is never 1:30 AM and never 1.5 hours.

| You type | Read as |
|---|---|
| `1:30` | 1 min 30 s (90 s) |
| `0:45` | 45 s |
| `12:05` | 12 min 5 s |
| `1:40m` | 1 min 40 s |
| `1:05:20` | 1 h 5 min 20 s (only three parts means hours) |
| `90s`, `90 sec`, `45 seconds` | seconds |
| `2 min`, `2m`, `2m30s`, `1h 5m` | as written |
| `90` in a column headed "Time (sec)" / "Seconds" | 90 s (the header gives the unit) |
| `90` with no unit anywhere | **flagged** in Review |
| `8.26` | **flagged**, best guess 8:26 |

**Google Sheets auto-conversion:** if you type `1:30` into a normal Sheets cell, Sheets stores it as a clock time (01:30:00). The app reads the **displayed text** (`1:30`) and applies the rule above, so it's still 90 s. (Your Plank `2:00` is stored as 2:00 AM and is read as 2 minutes.) If a cell displays three parts like `1:30:00` because of its format, the app can't tell what you typed, so it flags the value with 1:30 (90 s) preselected.

Quick Entry saves times as text (`1:30`), and the Training Log's Time column is formatted as plain text, so typing there by hand is safe too. Durations are shown as `m:ss`, or `h:mm:ss` from one hour up.

Distances: `mi`/`mile`, `km`/`k`, `m`/`meters`, `yd`, `ft`, `steps`. Runs display in miles (or km), carries and lunges in meters (or feet/yards). Change units in Settings. A run named like **"1 Mile Run"** takes its distance from the name when no distance is logged.

---

## 6. Automatic muscle detection

Every exercise name is normalised first: lowercase, punctuation removed, `DB` → dumbbell, `BB` → barbell, `45°`/`45 degree`/`45deg` → 45 degree, `Tri Ext` → triceps extension, plurals → singular. Then it's matched against a built-in library.

- **The most specific match wins.** The longest matching phrase beats shorter keywords, so "back extension" isn't Back just because it contains "back", and "leg curl" isn't Biceps just because it contains "curl".
- **Primary** muscle counts 100%. **Secondary** muscles count 50%.
- **Confidence:** a specific phrase or one of your rules → *high*, assigned silently. Only a generic keyword ("press", "curl") or nothing at all → *low / none*, shown in **Review** with the best guess preselected for one-click confirmation.

**Your mandatory rules (checked first, always win):**
1. Machine press / chest press machine / any "machine press" without "shoulder" or "overhead" → **Chest**, secondary Triceps + Shoulders. (Leg/calf "press machines" are excluded.)
2. Dips, all variations → **Chest**, secondary Triceps.
3. 45-degree back extension / 45° hyperextension → **Hamstrings**, secondary Back.

**Override:** Review → *Full exercise → muscle map* → **Edit**. Your edits are saved to `_config`, synced to both computers, and always beat the automatic rules (**Reset** goes back to automatic). **Merges** (e.g. "Laying Leg Curl" → "Lying Leg Curl") are proposed when names look alike and applied only after you confirm; **Un-merge** undoes them.

**Scores:** muscle score = average % change in estimated 1RM (`weight × (1 + reps/30)`) across the exercises mapped to that muscle, primary weighted 1 and secondary ½. The baseline is each exercise's first session in the selected date range. Overall = weighted average of all muscle scores. **Endurance never affects 1RM scores.** An optional Settings toggle counts lunges toward Quads and carries/holds toward Core + Back **weekly sets**.

---

## 7. Reconnect Google

While the app's OAuth screen is in **Testing** mode, Google expires the sign-in about **every 7 days**. When that happens you'll see a yellow banner: *"Your Google sign-in expired… Showing cached data."* Click **Reconnect Google**, sign in again in the browser, and you're done. Nothing is lost and charts never go blank. The token is stored only in the macOS Keychain / Windows Credential Manager (Settings → Disconnect removes it).

---

## 8. Updating the app

- **Installed apps update themselves.** On launch they check GitHub Releases. When a new version exists, a banner offers **Install & restart**. Settings → *Check for updates* checks on demand.
- **To publish a new version:** bump `"version"` in `package.json` (e.g. `0.1.0` → `0.2.0`), commit, then either push a tag `v0.2.0` or run **Actions → Build installers → Run workflow**. About 15 minutes later the release is up and both computers offer the update.

---

## 9. Development

```bash
npm install
npm test          # 145 unit tests (parsers, muscle rules, metrics); fixture tests skip if fixtures/ is absent
npm run dev       # browser preview with a mock Google backend (dev only, uses fixtures/)
npm run tauri dev # the real desktop app (needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in your env)
```

Layout: `src/core` (pure logic: time parsing, muscle detection, grid parsing, ingestion, metrics) · `src/sync` (Google API, sync engine, cache) · `src/pages` (tabs) · `src-tauri` (Rust: OAuth PKCE, keychain, SQLite cache, updater).

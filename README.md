# Hoops Tracker

Desktop basketball stat tracker (Electron + React + TypeScript + Tailwind). Event-sourced: events are the only stored data; box scores, totals and line scores are derived.

## What's new in 2.0 (alpha)
- **Review any quarter and any player's shots; End game / Reopen game**: see `CHANGELOG.md`.
- **Show / hide each team's shots on the court**: the *Shots* toggles under the court, or `Shift+H` / `Shift+A`. See `CHANGELOG.md`.

## Quick start (VS Code)
1. Unzip, then **File > Open Folder** and pick the `hoops-tracker` folder that contains `package.json`.
2. In the terminal (`` Ctrl+` ``): `npm install` (the first time it also downloads Electron, ~100 MB).
3. `npm run dev` starts the app. Or press **F5** and choose *Debug app (main + UI)* to debug it.
4. **Terminal > Run Task...** lists: Dev, Test (unit), Typecheck, Test (end-to-end), Build installer (Windows).
5. Accept the "Install recommended extensions" prompt (Vitest Explorer, Tailwind CSS IntelliSense).

On Windows PowerShell, if `npm` is blocked by the execution policy, run once:
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

## Run
```
npm install        # downloads Electron (~100 MB) on first run
npm run dev        # launches the app with hot reload
npm test           # unit tests (stats, fouls, store, court geometry, XLSX, UI components)
npm run typecheck  # main/preload + renderer
npm run build      # production bundles into ./out
```

## App layout
- `src/main` – Electron main process: window, file dialogs, XLSX export/import, autosave (atomic writes to the user-data folder)
- `src/preload` – exposes a small typed `window.api` (contextIsolation on, sandbox on, no node in the renderer)
- `src/renderer/src` – React UI: `Court.tsx` (pure SVG), `CourtPanel.tsx` (shot entry), `App.tsx` (toolbar + placeholder sidebars)
- `src/shared` – everything below; used by both processes and unit-tested

## Stat entry
- **Shots** are entered on the court (select a player, click, Made/Missed). 2 vs 3 is detected from the click position and can be set with the 2 / 3 keys.
- **Sidebar buttons** for the selected player: FT made / FT miss, OREB, DREB, AST, STL, BLK, TO, each showing the player's running count.
- **Follow-up prompts:** after a miss, one tap `+ OREB` (shooter's team) or `+ DREB` (opponents) on the rebounder, plus `+ BLK` on a defender; after an unassisted make, `+ AST` on a teammate. Dismiss with the link in the amber bar.
- **AST / BLK are attached to the shot**, not counted separately: AST credits the most recent unassisted made shot by a teammate this period, BLK the most recent unblocked miss by an opponent. Undo removes just the assist/block.
- Per-player lines show PTS, REB, AST, STL, BLK, TO, FG, 2P, 3P, FT; team totals sit above the roster. The Q / Game toggle switches the stat view (the score is always the whole game).

## Keyboard shortcuts (press `?` or click **⌨ Keys** in the app)
Built for scoring live without the mouse: pick a team, type the jersey number, press a stat key.

| Do this | Keys |
|---|---|
| Pick the team | `←` Home (left sidebar), `→` Away (right sidebar) |
| Pick a player | type the jersey number, e.g. `2` `3`. It is accepted on `Enter`, after a short pause, or when you press the next key, so `2` `3` `F` fouls #23. `0` and `00` are different players. `Backspace` deletes a digit, `Esc` cancels. |
| Walk the roster | `↑` / `↓` (wraps) |
| Stat for the selected player | `F` personal foul, `Shift+F` technical, `S` steal, `T` turnover, `B` block, `A` assist, `O` offensive rebound, `D` defensive rebound, `R` rebound after a miss (offensive for the shooter's team, otherwise defensive), `+` or `=` free throw made, `-` free throw missed |
| Shots | select the player, click the court, then `M` made / `X` missed, `2` / `3` to change the call, `Esc` cancels. On a marker you clicked: `F` flips made/missed, `Delete` removes it |
| Court | `Shift+H` / `Shift+A` show or hide the Home / Away team's shots; `P` shows only the selected player's shots |
| Game | `U` or `Ctrl+Z` undo, `Shift+U` / `Ctrl+Shift+Z` / `Ctrl+Y` redo, `]` / `[` next / previous period, `V` / `Shift+V` step the view through the whole game, Q1, Q2, ..., `?` / `F1` help |

Safety rules: shortcuts are off while you type in a text box or while a dialog is open; the shot popover owns the keyboard while it is open (only `Ctrl+Z` still works); holding a key records a stat only once (arrow keys may repeat); other `Ctrl`/`Alt` combinations are left to the system. The team you're keying into gets a blue ring, and the digits you've typed appear bottom-left. The help sheet is generated from the same key table the app uses, so it can't drift.
Breaking change: the shot popover's 2/3 toggle moved from `T` to `2` / `3`, because `T` is now turnover.

## New game
Toolbar -> **New game**. The dialog shows what you're about to replace (score, event count, period) and whether it has been exported since its last change.
- **Per team:** *Keep roster* (same players, ids, name and color) or *New opponent / empty roster* (players and name cleared, color kept; the Teams & Roster dialog then opens so you can fill it in or paste a roster).
- **Date & time and location** for the new game (shown under the title and saved in the XLSX).
- **Backup first (desktop app):** ticked by default, writes a timestamped XLSX copy of the finished game to the app's `archive` folder (user-data folder; "Open backup folder" jumps there) *before* anything is replaced. If the backup fails, nothing is replaced and you're told why; untick the box to continue without one. Restore a backed-up game with **Import XLSX**.
- Kept: team names/colors, which end each team attacks, court type. Cleared: all events, fouls, shots, undo/redo history and the current selection.
- Export file names and archive names use your **local** date (the old code used the UTC date, which is "tomorrow" for an evening game in the Americas).

## Fouls (high school / NFHS rules)
- **Per player:** `Personal foul` and `Technical` buttons on the selected player's card, plus five scorebook-style boxes (amber = personal, red **T** = technical) that always show the **whole game**, whatever the Q/Game toggle says.
  - **5 fouls = fouled out.** Technicals count toward the 5.
  - **2 technicals = ejected.**
  - A player who is out can't be charged any more fouls (buttons disable; the store refuses too). Undo gives a foul back.
- **Per team:** a *Team fouls* strip per quarter (Q1-Q4, plus OT columns). Personal and technical fouls both count. When a team reaches **5 in a quarter**, the *opponent's* panel lights **IN BONUS** (two free throws on common fouls). Counts reset every quarter; overtime continues the 4th-quarter count (`OVERTIME_CARRIES_FOULS` in `src/shared/stats.ts` if your state does it differently).
- **Not modelled:** bench/coach technicals (they have no player to charge), flagrant fouls, offensive-vs-defensive foul types, and which fouls are shooting fouls.
- **XLSX:** Box Score gets `PF` and `TF` columns; Summary gets a *Team fouls* table (per quarter + total) and `PF / TF / FOULS` columns in the team tables. Events use `type = foul` with `kind = personal | technical`. Import rejects a 6th foul or a 3rd technical.
- Sources: NFHS Rule 4-8-1 change (2023-24: team fouls per quarter, bonus on the 5th, two shots); technicals count toward team fouls and a player's 5; 2 technicals eject.

## Teams & roster
Toolbar -> **Teams & Roster** (or the "edit" link by a team name; Esc closes). Per team: name, color (8 swatches or any color), add / edit / remove players, **Sort by number** (numeric, `0` before `00`, blanks last), **Clear roster**, and **Paste a roster** (one player per line: `23 Ben Smith`, `#5, Dan`, `Ben 12`, `00 Eli`). **Swap sides** flips which end each team attacks in Q1 (always both, so they can't shoot at the same basket); the strip above the court shows who attacks which basket right now.
- Jersey numbers are text, so `0` and `00` are different players. Duplicate or missing numbers and names show as warnings but never block play.
- A player referenced by any recorded stat (as shooter, assister or blocker) can't be removed; the button shows how many events reference them.
- Keyboard shortcuts are ignored while you type in a text field or while any dialog is open.
- Roster edits save automatically but are not part of Undo.

## Court (high school / NFHS by default)
Drawn from `src/shared/courtMarkings.ts` and `court.ts`, to scale, in feet: 84 x 50 court, 12 ft lane, free-throw line 15 ft from the backboard face (19 ft from the end line), 6 ft free-throw semicircle (solid outside the lane, dashed inside), lane hash marks (12 in x 8 in neutral-zone block at 7 ft + three 2 in x 8 in marks at 11/14/17 ft), 19 ft 9 in 3-point line with straight corner segments, 6 ft centre circle, 72 in backboard 4 ft off the baseline, 2 in lines. The 3-point line is drawn with the same numbers the 2-vs-3 classifier uses.
NBA/NCAA/FIBA are selectable; only the NFHS markings were checked against the rulebook.


## Layout
- `src/shared/types.ts` – Game, Team, Player, events, StatLine
- `src/shared/stats.ts` – computeStats (period/player filters), team totals, line score, court direction
- `src/shared/validate.ts` – integrity checks (use on XLSX import)
- `src/shared/store.ts` – Zustand vanilla store: entry actions, undo/redo, edit/delete, periods, roster, load/new game, debounced autosave
- `src/shared/court.ts` – court specs (NBA/NCAA/FIBA/NFHS), `classifyShot` (2 vs 3), distances, heat-map frames, SVG 3-pt line path
- `src/shared/xlsx.ts` – ExcelJS export (`exportGameToXlsx`) and import (`importGameFromXlsx`)
- `src/shared/factory.ts` – `createEmptyGame()`
- `src/shared/fixtures.ts` – sample game used by tests

## XLSX format (v1)
| Sheet | Role |
|---|---|
| Game Info | key/value rows: format, schemaVersion, gameId, date, location, courtType, regulationPeriods, currentPeriod, home./away. id, name, color, attacksRightInPeriod1. **Imported** |
| Roster | teamId, team, playerId, number (text), name. **Imported** |
| Events | one row per event, in order; header names are the import contract. Extra columns (Team, Player, Assisted by, Blocked by) are live lookups and ignored on import. **Imported** |
| Box Score | full game + one section per period; COUNTIFS/SUM formulas over Events. Export-only |
| Summary | line score, team totals, per-period totals, all pulled from Box Score. Export-only |

Import rules: the row order of Events is the game log order. `id`, `teamId` and `ts` may be left blank on hand-added rows (they are derived/generated, with a warning). Every import runs `validateGame`; on any error `game` is `null` and `errors` lists them with row numbers.
Player and event ids should be non-numeric strings (UUIDs are fine) because the Box Score formulas match on them with COUNTIFS.

ExcelJS runs in Node and the browser; in the Electron app call export/import from the **main** process (file dialogs + fs) and pass bytes over IPC.

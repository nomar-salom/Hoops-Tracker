# Changelog

## 2.0.0-alpha.2 (in development)

### Added (review and end of game)
- **Look at any quarter.** The old Q/Game toggle only offered the *current* quarter, so once you moved on, earlier quarters were unreachable. A **period strip** (Game, Q1, Q2, ... OT) in the toolbar now shows any single period's stats and shots, at any time. What you *look at* is separate from where new stats are *recorded* (the live period, marked with a green dot); a blue banner says so, with a *Back to Q3* button. `V` / `Shift+V` step through the views.
  - The team period-points caption, the shot counts and the attack-direction strip all follow the period on screen.
  - Recording while viewing another period still goes to the live period; if the new shot would be invisible in the current view, the view jumps to it.
- **One player's shots.** The target button on any player card, the *Player* menu under the court, `P` (selected player), or the *Shots* button in the game summary. Combines with the period view and the team toggles; shows that player's points, FG and 3P.
- **End game / Reopen game.** *End game* shows the final score and line score, then locks the game for review: no new stats (buttons, court clicks and the stat/period/undo keys explain instead), a FINAL banner, and a **Game summary** (line score plus every player's PTS/FG/3P/FT with a *Shots* button). Event-log edits and roster fixes still work, and *Reopen game* resumes scoring. The ended state is saved with the game (autosave, XLSX `endedAt`), so it survives restarts and exports.

### Changed
- `statView` ('period' | 'game') is now `viewPeriod` ('game' | a period number).
- Undo/redo are disabled while a game is ended (ending is not undoable, so Ctrl+Z would silently undo a stat instead).

### Added (shot toggles)
- **Show / hide each team's shots on the court.** A toggle per team under the court (with that team's made/attempted count), or `Shift+H` (Home) and `Shift+A` (Away). View-only: it is not saved with the game and never affects stats, the event log or exports.
  - Counts follow the Q / Game view and keep showing for a hidden team.
  - Plotting a shot for a hidden team turns that team back on (otherwise the new shot would disappear the moment you placed it).
  - A marker popover closes if its team is hidden.

## 1.0.0
First release: shot chart, stat buttons, fouls and team-foul bonus, roster editor, event log, new game with backup, keyboard shortcuts, XLSX export/import, Windows installer.

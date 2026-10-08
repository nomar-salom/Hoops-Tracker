import { useEffect, useState } from 'react';
import { COURTS } from '@shared/court';
import { periodLabel, teamTotals } from '@shared/stats';
import { isGameEnded, periodsInGame } from '@shared/store';
import type { CourtType } from '@shared/types';
import { CourtPanel } from './components/CourtPanel';
import { PromptBar } from './components/PromptBar';
import { TeamSidebar } from './components/TeamSidebar';
import { isModalOpen, useUi } from './ui';
import { isTypingTarget } from './typing';
import { EndGameDialog } from './components/EndGameDialog';
import { EventLogDialog } from './components/EventLogDialog';
import { GameSummary } from './components/GameSummary';
import { ViewStrip } from './components/ViewStrip';
import { NewGameDialog } from './components/NewGameDialog';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { handleShortcut } from './shortcuts';
import { RosterDialog } from './components/RosterDialog';
import { gameStore, useGame } from './store';

function Toolbar() {
  const game = useGame((s) => s.game);
  const viewPeriod = useGame((s) => s.viewPeriod);
  const ended = isGameEnded(game);
  // Undo/redo are off once the game has ended: ending is not undoable, so Ctrl+Z would silently undo a STAT.
  const canUndo = useGame((s) => s.game.events.length > 0) && !ended;
  const canRedo = useGame((s) => s.redoStack.length > 0) && !ended;
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const s = gameStore.getState();
  const hasApi = typeof window !== 'undefined' && !!window.api;

  async function doExport() {
    const res = await window.api!.exportXlsx(gameStore.getState().game);
    if (res.status === 'saved') {
      useUi.getState().markSaved(gameStore.getState().game);
      setMessage({ kind: 'ok', text: `Saved ${res.path}` });
    }
    else if (res.status === 'error') setMessage({ kind: 'error', text: res.message });
  }

  async function doImport() {
    const res = await window.api!.importXlsx();
    if (res.status === 'canceled') return;
    if (res.status === 'error') return setMessage({ kind: 'error', text: res.message });
    if (!res.result.game) {
      const first = res.result.errors.slice(0, 4).join(' · ');
      const more = res.result.errors.length > 4 ? ` (+${res.result.errors.length - 4} more)` : '';
      return setMessage({ kind: 'error', text: `Import failed: ${first}${more}` });
    }
    const errors = gameStore.getState().loadGame(res.result.game);
    if (!errors.length) useUi.getState().markSaved(gameStore.getState().game); // identical to the file
    setMessage(errors.length
      ? { kind: 'error', text: `Import failed: ${errors[0]}` }
      : { kind: 'ok', text: `Imported ${res.result.game.events.length} events${res.result.warnings.length ? ` (${res.result.warnings.length} warnings)` : ''}` });
  }

  const btn = 'rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-40 disabled:hover:bg-slate-700';

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2">
      <div className="mr-2 leading-tight">
        <h1 className="text-lg font-bold tracking-tight">Hoops Tracker</h1>
        <div className="text-[11px] text-slate-400" data-part="game-meta">
          {new Date(game.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          {game.location ? ` · ${game.location}` : ''}
        </div>
      </div>

      {ended ? (
        <span className="rounded bg-rose-700 px-3 py-1.5 text-sm font-bold tracking-wide" data-part="final-chip">FINAL</span>
      ) : (
        <div className="flex items-center gap-1" title="The period new stats are recorded in">
          <button className={btn} onClick={() => s.prevPeriod()} aria-label="Previous period">◀</button>
          <span className="w-14 text-center font-semibold">{periodLabel(game.currentPeriod, game.regulationPeriods)}</span>
          <button className={btn} onClick={() => s.nextPeriod()} aria-label="Next period">▶</button>
        </div>
      )}

      <ViewStrip
        periods={periodsInGame(game)}
        live={game.currentPeriod}
        view={viewPeriod}
        ended={ended}
        label={(p) => periodLabel(p, game.regulationPeriods)}
        onView={(v) => s.setViewPeriod(v)}
      />

      <button className={btn} onClick={() => useUi.getState().setRosterOpen(true)}>Teams &amp; Roster</button>
      <button className={btn} onClick={() => useUi.getState().setNewGameOpen(true)} data-new-game>New game</button>
      <button className={btn} onClick={() => useUi.getState().openEventLog()} title="Event log (L)" data-event-log>Event log</button>
      {ended ? (
        <button className={`${btn} ring-1 ring-amber-500`} data-reopen-game
          onClick={() => { s.reopenGame(); useUi.getState().showToast('Game reopened. You can record stats again.'); }}>
          Reopen game
        </button>
      ) : (
        <button className={btn} data-end-game disabled={game.events.length === 0}
          title={game.events.length === 0 ? 'Nothing recorded yet' : 'Finish the game and review it'}
          onClick={() => useUi.getState().setEndGameOpen(true)}>
          End game
        </button>
      )}
      <button className={btn} disabled={!canUndo} onClick={() => s.undo()} title="Ctrl+Z">Undo</button>
      <button className={btn} disabled={!canRedo} onClick={() => s.redo()} title="Ctrl+Shift+Z">Redo</button>

      <select
        className="rounded bg-slate-700 px-2 py-1.5 text-sm"
        value={game.courtType}
        onChange={(e) => { s.setCourtType(e.target.value as CourtType); e.currentTarget.blur(); }}
        title="Court type (sets the 3-point line)"
      >
        {(Object.keys(COURTS) as CourtType[]).map((k) => <option key={k} value={k}>{COURTS[k].label}</option>)}
      </select>

      <div className="ml-auto flex items-center gap-2">
        {message && (
          <span className={`max-w-[32rem] truncate text-sm ${message.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`} title={message.text}>
            {message.text}
          </span>
        )}
        <button className={btn} onClick={() => useUi.getState().setHelpOpen(true)} title="Keyboard shortcuts (?)" data-keys>⌨ Keys</button>
        <button className={btn} disabled={!hasApi} onClick={doImport} title={hasApi ? '' : 'Available in the desktop app'}>Import XLSX</button>
        <button className={btn} disabled={!hasApi} onClick={doExport} title={hasApi ? '' : 'Available in the desktop app'}>Export XLSX</button>
      </div>
    </header>
  );
}

/** Shown when the game has been ended: the final score and a way back. */
function FinalBanner() {
  const game = useGame((s) => s.game);
  if (!isGameEnded(game)) return null;
  const [a, b] = game.teams.map((t) => teamTotals(game, t).pts);
  return (
    <div className="flex items-center justify-between rounded bg-rose-900/40 px-3 py-2 ring-1 ring-rose-700" data-part="final-banner">
      <span className="text-sm">
        <b className="mr-2 rounded bg-rose-700 px-2 py-0.5 text-xs tracking-wide">FINAL</b>
        <b>{game.teams[0].name} {a}</b> – <b>{game.teams[1].name} {b}</b>
        <span className="ml-2 text-slate-400">
          {new Date(game.endedAt!).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      </span>
      <span className="text-xs text-rose-200">Review mode: no new stats. Use Reopen game to keep scoring.</span>
    </div>
  );
}

function SummaryPanel() {
  const game = useGame((s) => s.game);
  const shotPlayerId = useUi((s) => s.shotPlayerId);
  return (
    <GameSummary
      game={game}
      open={isGameEnded(game)}
      activePlayerId={shotPlayerId}
      onShowPlayerShots={(id) => {
        const ui = useUi.getState();
        ui.setShotPlayer(shotPlayerId === id ? null : id);
        const ti = game.teams.findIndex((t) => t.players.some((p) => p.id === id));
        if (ti === 0 || ti === 1) { if (!ui.showShots[ti]) ui.setShowShots(ti, true); }
      }}
    />
  );
}

/** Shows the jersey number being typed, and which team it will be looked up on. */
function KeyHud() {
  const buffer = useUi((s) => s.numberBuffer);
  const activeTeam = useUi((s) => s.activeTeam);
  const team = useGame((s) => s.game.teams[activeTeam]);
  if (!buffer) return null;
  return (
    <div role="status" data-part="key-hud"
      className="pointer-events-none fixed bottom-5 left-5 z-50 flex items-center gap-2 rounded-md bg-slate-100 px-4 py-2 text-slate-900 shadow-lg">
      <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
      <span className="text-sm font-medium">{team.name}</span>
      <span className="font-mono text-2xl font-bold tabular-nums">#{buffer}</span>
      <span className="text-xs text-slate-500">Enter ↵</span>
    </div>
  );
}

function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={`pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm font-medium shadow-lg ${
        toast.kind === 'warn' ? 'bg-amber-500 text-slate-900' : 'bg-slate-100 text-slate-900'
      }`}
    >
      {toast.text}
    </div>
  );
}

export default function App() {
  // All keyboard shortcuts live in shortcuts.ts; this just feeds it key presses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = handleShortcut(e, {
        typing: isTypingTarget(e.target),
        modalOpen: isModalOpen(),
        popoverOpen: useUi.getState().courtPopover !== 'none',
      });
      if (handled) e.preventDefault(); // e.g. Enter must not also click a focused button
    };
    const onPointer = () => { if (useUi.getState().inputMode !== 'mouse') useUi.setState({ inputMode: 'mouse' }); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)_minmax(17rem,22rem)] gap-3 p-3">
        <TeamSidebar teamIndex={0} />
        <div className="flex min-w-0 flex-col gap-2 overflow-y-auto">
          <FinalBanner />
          <PromptBar />
          <CourtPanel />
          <SummaryPanel />
        </div>
        <TeamSidebar teamIndex={1} />
      </main>
      <Toast />
      <RosterDialog />
      <NewGameDialog />
      <ShortcutsDialog />
      <EventLogDialog />
      <EndGameDialog />
      <KeyHud />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '@shared/dates';
import { periodLabel, teamTotals } from '@shared/stats';
import { gameStore, useGame } from '../store';
import { useUi } from '../ui';

type Keep = [boolean, boolean];

export function NewGameDialog() {
  const open = useUi((s) => s.newGameOpen);
  const savedGame = useUi((s) => s.savedGame);
  const game = useGame((s) => s.game);

  const [keep, setKeep] = useState<Keep>([true, true]);
  const [when, setWhen] = useState('');
  const [location, setLocation] = useState('');
  const [backup, setBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = typeof window !== 'undefined' ? window.api : undefined;
  const hasEvents = game.events.length > 0;
  const alreadyExported = savedGame === game;

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setKeep([true, true]);
    setWhen(toDateTimeLocalValue(new Date().toISOString()));
    setLocation('');
    setBackup(true);
    setBusy(false);
    setError(null);
  }, [open]);

  const close = () => useUi.getState().setNewGameOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  const score = useMemo(
    () => game.teams.map((t) => teamTotals(game, t).pts) as [number, number],
    [game],
  );

  if (!open) return null;

  async function start() {
    setBusy(true);
    setError(null);
    const current = gameStore.getState().game;
    let archivedTo: string | null = null;
    try {
      if (current.events.length > 0 && backup && api) {
        const res = await api.archiveGame(current);
        if (res.status !== 'saved') {
          setError(`Couldn't save a backup (${res.message}). Untick "Save a backup" to continue without one.`);
          setBusy(false);
          return;
        }
        archivedTo = res.path;
      }
      gameStore.getState().startNewGame({
        keepRoster: keep,
        date: fromDateTimeLocalValue(when) ?? undefined,
        location,
      });
      useUi.getState().markSaved(null);
      close();
      useUi.getState().showToast(archivedTo ? `New game started. Previous game saved to ${archivedTo}` : 'New game started');
      // An emptied roster needs players before anything can be scored.
      if (keep.some((k) => !k)) useUi.getState().setRosterOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const input = 'rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="New game"
        className="flex w-full max-w-xl flex-col gap-4 rounded-xl bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-600">
        <h2 className="text-lg font-bold">Start a new game</h2>

        <div className="rounded-md bg-slate-800 p-3 text-sm" data-part="current-summary">
          {hasEvents ? (
            <>
              <div>
                This replaces the current game:{' '}
                <b>{game.teams[0].name} {score[0]}</b> – <b>{game.teams[1].name} {score[1]}</b>
                <span className="text-slate-400"> · {game.events.length} events · {periodLabel(game.currentPeriod, game.regulationPeriods)}</span>
              </div>
              <div className={`mt-1 text-xs ${alreadyExported ? 'text-emerald-300' : 'text-amber-300'}`} data-part="export-status">
                {alreadyExported ? '✓ This game has been exported.' : 'This game has not been exported since its last change.'}
              </div>
            </>
          ) : (
            <span className="text-slate-300">The current game has no recorded events.</span>
          )}
        </div>

        {hasEvents && (
          api ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} data-backup />
                Save a backup (XLSX) of the current game first
              </label>
              <button className="text-xs text-sky-300 underline hover:text-white" onClick={() => void api.openArchiveFolder()}>
                Open backup folder
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-300" data-part="no-backup">
              Running outside the desktop app: nothing can be backed up automatically. Export the current game first if you need it.
            </p>
          )
        )}

        <div className="grid grid-cols-2 gap-3">
          {game.teams.map((t, i) => (
            <fieldset key={t.id} className="rounded-md bg-slate-800 p-3" data-team-choice={i}>
              <legend className="px-1 text-sm font-semibold" style={{ color: t.color }}>{t.name}</legend>
              <label className="flex items-center gap-2 py-0.5 text-sm">
                <input type="radio" name={`keep-${i}`} checked={keep[i]} data-keep={i}
                  onChange={() => setKeep((k) => k.map((v, j) => (j === i ? true : v)) as Keep)} />
                Keep roster <span className="text-slate-400">({t.players.length} players)</span>
              </label>
              <label className="flex items-center gap-2 py-0.5 text-sm">
                <input type="radio" name={`keep-${i}`} checked={!keep[i]} data-clear={i}
                  onChange={() => setKeep((k) => k.map((v, j) => (j === i ? false : v)) as Keep)} />
                New opponent / empty roster
              </label>
            </fieldset>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Date &amp; time</span>
            <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Location (optional)</span>
            <input className={input} value={location} maxLength={60} placeholder="e.g. Main Gym"
              onChange={(e) => setLocation(e.target.value)} data-location />
          </label>
        </div>

        <p className="text-xs text-slate-400">
          Kept: team names, colors, which end each team attacks, and the court type. Cleared: all stats, fouls, shots and undo history.
        </p>

        {error && <p className="rounded bg-rose-900/50 p-2 text-sm text-rose-200" role="alert">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600" disabled={busy} onClick={close} data-cancel>
            Cancel
          </button>
          <button className="rounded bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500 disabled:opacity-50"
            disabled={busy} onClick={() => void start()} data-start>
            {busy ? 'Starting…' : 'Start new game'}
          </button>
        </div>
      </div>
    </div>
  );
}

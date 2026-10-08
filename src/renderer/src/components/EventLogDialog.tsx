import { useEffect, useMemo, useState } from 'react';
import {
  LOG_TYPE_LABELS, eventExtra, eventWhat, filterEvents, findPlayer, playerLabel, type LogFilter, type LogTypeFilter,
} from '@shared/eventLog';
import { periodLabel } from '@shared/stats';
import type { GameEvent, ShotEvent } from '@shared/types';
import { gameStore, useGame } from '../store';
import { isTypingTarget } from '../typing';
import { useUi } from '../ui';

const PAGE = 200;

const sel = 'rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500';

export function EventLogDialog() {
  const open = useUi((s) => s.logOpen);
  const filter = useUi((s) => s.logFilter);
  const game = useGame((s) => s.game);
  const canUndo = useGame((s) => s.undoStack.length > 0 || s.game.events.length > 0);
  const canRedo = useGame((s) => s.redoStack.length > 0);

  const [newestFirst, setNewestFirst] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // Fresh editor state each time the dialog opens (the filter itself lives in the store).
  useEffect(() => {
    if (!open) return;
    setEditingId(null);
    setError(null);
    setLimit(PAGE);
  }, [open]);

  const close = () => useUi.getState().closeEventLog();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc inside a dropdown/field just leaves it; a second Esc closes the dialog.
      if (isTypingTarget(e.target)) { (e.target as HTMLElement).blur(); return; }
      if (editingId) setEditingId(null); else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editingId]);

  const rows = useMemo(() => {
    const r = filterEvents(game, filter);
    return newestFirst ? [...r].reverse() : r;
  }, [game, filter, newestFirst]);

  if (!open) return null;

  const toast = useUi.getState().showToast;
  const periods = Array.from({ length: game.currentPeriod }, (_, i) => i + 1);
  const allPlayers = game.teams.flatMap((t) => t.players.map((p) => ({ ...p, teamId: t.id })));
  const filtered = filter.period !== undefined || filter.teamId || filter.playerId || (filter.type && filter.type !== 'all');
  const set = (patch: Partial<LogFilter>) => { useUi.getState().setLogFilter(patch); setEditingId(null); setLimit(PAGE); };

  function edit(id: string, patch: Parameters<ReturnType<typeof gameStore.getState>['updateEvent']>[1]) {
    const err = gameStore.getState().updateEvent(id, patch);
    setError(err);
  }

  function remove(e: GameEvent) {
    const label = `${playerLabel(game, e.playerId)}: ${eventWhat(e)}`;
    gameStore.getState().deleteEvent(e.id);
    if (editingId === e.id) setEditingId(null);
    setError(null);
    toast(`Deleted: ${label}. Use Undo to bring it back.`);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Event log"
        className="flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-xl bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-600">
        <header className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">Event log</h2>
          <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-40" disabled={!canUndo}
            onClick={() => { gameStore.getState().undo(); setError(null); }} data-log-undo>Undo</button>
          <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-40" disabled={!canRedo}
            onClick={() => { gameStore.getState().redo(); setError(null); }} data-log-redo>Redo</button>
          <span className="ml-auto text-xs text-slate-400">Edits and deletes recalculate every stat and can be undone.</span>
          <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600" onClick={close} data-close>Done (Esc)</button>
        </header>

        <div className="flex flex-wrap items-center gap-2 text-sm" data-part="filters">
          <label className="flex items-center gap-1.5">Period
            <select className={sel} aria-label="Filter by period" value={filter.period ?? ''}
              onChange={(e) => set({ period: e.target.value === '' ? undefined : Number(e.target.value) })}>
              <option value="">All</option>
              {periods.map((p) => <option key={p} value={p}>{periodLabel(p, game.regulationPeriods)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">Team
            <select className={sel} aria-label="Filter by team" value={filter.teamId ?? ''}
              onChange={(e) => set({ teamId: e.target.value || undefined })}>
              <option value="">Both</option>
              {game.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">Player
            <select className={sel} aria-label="Filter by player" value={filter.playerId ?? ''}
              onChange={(e) => set({ playerId: e.target.value || undefined })}>
              <option value="">Everyone</option>
              {game.teams.map((t) => (
                <optgroup key={t.id} label={t.name}>
                  {t.players.map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">Type
            <select className={sel} aria-label="Filter by type" value={filter.type ?? 'all'}
              onChange={(e) => set({ type: e.target.value as LogTypeFilter })}>
              <option value="all">All</option>
              {(Object.keys(LOG_TYPE_LABELS) as (keyof typeof LOG_TYPE_LABELS)[]).map((k) => <option key={k} value={k}>{LOG_TYPE_LABELS[k]}</option>)}
            </select>
          </label>
          {filtered && (
            <button className="text-xs text-sky-300 underline hover:text-white" onClick={() => set({ period: undefined, teamId: undefined, playerId: undefined, type: 'all' })}>
              Clear filters
            </button>
          )}
          <button className="ml-auto rounded bg-slate-800 px-2 py-1 text-xs ring-1 ring-slate-600 hover:bg-slate-700" onClick={() => setNewestFirst((v) => !v)}>
            {newestFirst ? 'Newest first' : 'Oldest first'} ⇅
          </button>
        </div>

        <div className="text-xs text-slate-400" data-part="count">
          Showing {Math.min(rows.length, limit)} of {rows.length}{filtered ? ` matching (${game.events.length} in the game)` : ''} events
        </div>

        {error && <p role="alert" className="rounded bg-rose-900/50 p-2 text-sm text-rose-200" data-part="error">{error}</p>}

        <ul className="min-h-0 flex-1 overflow-y-auto rounded-md bg-slate-950/40 ring-1 ring-slate-800" data-part="rows">
          {rows.length === 0 && (
            <li className="p-6 text-center text-sm text-slate-400">{game.events.length === 0 ? 'Nothing has been recorded yet.' : 'No events match these filters.'}</li>
          )}
          {rows.slice(0, limit).map(({ index, event: e }) => {
            const team = game.teams.find((t) => t.id === e.teamId);
            const isEditing = editingId === e.id;
            const extra = eventExtra(game, e);
            return (
              <li key={e.id} data-event-row={e.id} data-event-type={e.type}
                className={`border-b border-slate-800 px-3 py-2 ${isEditing ? 'bg-sky-950/40' : 'hover:bg-slate-800/50'}`}>
                <div className="flex items-center gap-3 text-sm">
                  <span className="w-8 shrink-0 text-right tabular-nums text-slate-500" title="Position in the game log">{index + 1}</span>
                  <span className="w-9 shrink-0 text-xs font-semibold text-slate-300">{periodLabel(e.period, game.regulationPeriods)}</span>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team?.color }} title={team?.name} />
                  <span className="w-40 shrink-0 truncate">{playerLabel(game, e.playerId)}</span>
                  <span className="w-40 shrink-0 font-medium">{eventWhat(e)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-400">{extra}</span>
                  <button className="rounded bg-slate-700 px-2.5 py-1 text-xs hover:bg-slate-600" data-edit
                    onClick={() => { setEditingId(isEditing ? null : e.id); setError(null); }}>
                    {isEditing ? 'Close' : 'Edit'}
                  </button>
                  <button className="rounded bg-slate-700 px-2.5 py-1 text-xs hover:bg-rose-700" data-delete onClick={() => remove(e)}>Delete</button>
                </div>
                {isEditing && <Editor event={e} onChange={(patch) => edit(e.id, patch)} periods={periods} allPlayers={allPlayers} />}
              </li>
            );
          })}
          {rows.length > limit && (
            <li className="p-3 text-center">
              <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, rows.length - limit)} more
              </button>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

type Patch = Parameters<ReturnType<typeof gameStore.getState>['updateEvent']>[1];

function Editor({ event: e, onChange, periods, allPlayers }: {
  event: GameEvent;
  onChange: (p: Patch) => void;
  periods: number[];
  allPlayers: { id: string; number: string; name: string; teamId: string }[];
}) {
  const game = useGame((s) => s.game);
  const f = (label: string, control: React.ReactNode) => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">{label}{control}</label>
  );
  const shot = e.type === 'shot' ? (e as ShotEvent) : null;
  const mates = shot ? allPlayers.filter((p) => p.teamId === e.teamId && p.id !== e.playerId) : [];
  const opponents = shot ? allPlayers.filter((p) => p.teamId !== e.teamId) : [];

  return (
    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md bg-slate-900/80 p-3" data-part="editor">
      {f('Player',
        <select className={sel} aria-label="Player" value={e.playerId} onChange={(ev) => onChange({ playerId: ev.target.value })}>
          {game.teams.map((t) => (
            <optgroup key={t.id} label={t.name}>
              {t.players.map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
            </optgroup>
          ))}
        </select>)}
      {f('Period',
        <select className={sel} aria-label="Period" value={e.period} onChange={(ev) => onChange({ period: Number(ev.target.value) })}>
          {periods.map((p) => <option key={p} value={p}>{periodLabel(p, game.regulationPeriods)}</option>)}
        </select>)}

      {shot && (
        <>
          {f('Result',
            <select className={sel} aria-label="Result" value={shot.made ? 'made' : 'missed'} onChange={(ev) => onChange({ made: ev.target.value === 'made' })}>
              <option value="made">Made</option><option value="missed">Missed</option>
            </select>)}
          {f('Shot value',
            <select className={sel} aria-label="Shot value" value={shot.points} onChange={(ev) => onChange({ points: Number(ev.target.value) as 2 | 3 })}>
              <option value={2}>2PT</option><option value={3}>3PT</option>
            </select>)}
          {shot.made && f('Assisted by',
            <select className={sel} aria-label="Assisted by" value={shot.assistedBy ?? ''} onChange={(ev) => onChange({ assistedBy: ev.target.value || undefined })}>
              <option value="">No assist</option>
              {mates.map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
              {shot.assistedBy && !mates.some((p) => p.id === shot.assistedBy) && <option value={shot.assistedBy}>{playerLabel(game, shot.assistedBy)}</option>}
            </select>)}
          {!shot.made && f('Blocked by',
            <select className={sel} aria-label="Blocked by" value={shot.blockedBy ?? ''} onChange={(ev) => onChange({ blockedBy: ev.target.value || undefined })}>
              <option value="">Not blocked</option>
              {opponents.map((p) => <option key={p.id} value={p.id}>#{p.number} {p.name}</option>)}
            </select>)}
        </>
      )}
      {e.type === 'freeThrow' && f('Result',
        <select className={sel} aria-label="Result" value={e.made ? 'made' : 'missed'} onChange={(ev) => onChange({ made: ev.target.value === 'made' })}>
          <option value="made">Made</option><option value="missed">Missed</option>
        </select>)}
      {e.type === 'rebound' && f('Kind',
        <select className={sel} aria-label="Kind" value={e.kind} onChange={(ev) => onChange({ kind: ev.target.value as 'offensive' | 'defensive' })}>
          <option value="offensive">Offensive</option><option value="defensive">Defensive</option>
        </select>)}
      {e.type === 'foul' && f('Kind',
        <select className={sel} aria-label="Kind" value={e.kind} onChange={(ev) => onChange({ kind: ev.target.value as 'personal' | 'technical' })}>
          <option value="personal">Personal</option><option value="technical">Technical</option>
        </select>)}
      <span className="pb-1.5 text-xs text-slate-500">
        {findPlayer(game, e.playerId)?.team.name}{shot ? ' \u00b7 shot position is changed by clicking its marker on the court' : ''}
      </span>
    </div>
  );
}

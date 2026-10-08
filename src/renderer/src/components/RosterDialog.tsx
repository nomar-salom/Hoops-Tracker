import { useEffect, useMemo, useRef, useState } from 'react';
import { eventCountByPlayer } from '@shared/eventLog';
import { parseRosterText, rosterIssues } from '@shared/roster';
import type { ID, Team } from '@shared/types';
import { gameStore, useGame } from '../store';
import { useUi } from '../ui';

const SWATCHES = ['#1d4ed8', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#111827'];

function TeamEditor({ teamIndex, usage }: { teamIndex: 0 | 1; usage: Map<ID, number> }) {
  const team: Team = useGame((s) => s.game.teams[teamIndex]);
  const attacksRight = team.attacksRightInPeriod1;
  const [paste, setPaste] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusId, setFocusId] = useState<ID | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const s = gameStore.getState;

  // After adding a player, put the cursor in the new row's jersey box.
  useEffect(() => {
    if (!focusId) return;
    listRef.current?.querySelector<HTMLInputElement>(`[data-number-for="${focusId}"]`)?.focus();
    setFocusId(null);
  }, [focusId, team.players.length]);

  const parsed = useMemo(() => parseRosterText(paste), [paste]);
  const issues = useMemo(() => rosterIssues(team), [team]);
  const removable = team.players.filter((p) => !usage.get(p.id));

  const input = 'rounded bg-slate-900 px-2 py-1.5 text-sm ring-1 ring-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500';

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg bg-slate-800 p-3" style={{ borderTop: `4px solid ${team.color}` }} data-team-editor={team.id}>
      <div className="flex items-center gap-2">
        <input
          aria-label={`${teamIndex === 0 ? 'Home' : 'Away'} team name`}
          className={`${input} flex-1 text-base font-semibold`}
          value={team.name}
          maxLength={30}
          onChange={(e) => s().updateTeam(team.id, { name: e.target.value })}
        />
        <span className="text-xs text-slate-400">{attacksRight ? '→ right in Q1' : '← left in Q1'}</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {SWATCHES.map((c) => (
          <button key={c} aria-label={`Team color ${c}`} data-swatch={c}
            onClick={() => s().updateTeam(team.id, { color: c })}
            className="h-6 w-6 rounded-full ring-offset-2 ring-offset-slate-800"
            style={{ background: c, boxShadow: team.color.toLowerCase() === c ? '0 0 0 2px #fff' : undefined }} />
        ))}
        <input type="color" aria-label="Custom team color" value={team.color}
          onChange={(e) => s().updateTeam(team.id, { color: e.target.value })}
          className="h-6 w-8 cursor-pointer rounded bg-transparent" />
      </div>

      <ul ref={listRef} className="flex flex-col gap-1.5" data-part="roster-list">
        {team.players.map((p) => {
          const n = usage.get(p.id) ?? 0;
          return (
            <li key={p.id} className="flex items-center gap-2" data-roster-row={p.id}>
              <input
                aria-label="Jersey number" data-number-for={p.id}
                className={`${input} w-16 text-center tabular-nums`}
                value={p.number} maxLength={3} placeholder="#"
                onChange={(e) => s().updatePlayer(p.id, { number: e.target.value.trim() })}
              />
              <input
                aria-label="Player name" className={`${input} min-w-0 flex-1`}
                value={p.name} maxLength={30} placeholder="Name"
                onChange={(e) => s().updatePlayer(p.id, { name: e.target.value })}
              />
              {n > 0 && (
                <button
                  data-view-events={p.id}
                  title="Open the event log for this player: delete or reassign these events to free the player up"
                  onClick={() => {
                    useUi.getState().setRosterOpen(false);
                    useUi.getState().openEventLog({ playerId: p.id });
                  }}
                  className="rounded bg-slate-700 px-2 py-1.5 text-xs text-sky-300 hover:bg-slate-600"
                >
                  {n} event{n === 1 ? '' : 's'}
                </button>
              )}
              <button
                data-remove={p.id}
                disabled={n > 0}
                title={n > 0 ? 'This player has recorded events. Delete or reassign them in the event log first.' : 'Remove player'}
                onClick={() => s().removePlayer(p.id)}
                className="rounded bg-slate-700 px-2 py-1.5 text-xs hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-700"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <button className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold hover:bg-sky-500" data-add-player
          onClick={() => setFocusId(s().addPlayer(team.id, { number: '', name: '' }))}>+ Add player</button>
        <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
          onClick={() => s().sortRoster(team.id)}>Sort by number</button>
        <button
          disabled={removable.length === 0}
          className="ml-auto rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-rose-700 disabled:opacity-40 disabled:hover:bg-slate-700"
          onClick={() => {
            if (!confirmClear) return setConfirmClear(true);
            removable.forEach((p) => s().removePlayer(p.id));
            setConfirmClear(false);
          }}
          onBlur={() => setConfirmClear(false)}
        >
          {confirmClear ? `Really remove ${removable.length}?` : 'Clear roster'}
        </button>
      </div>

      <details className="rounded bg-slate-900/60 p-2 text-sm" data-part="paste">
        <summary className="cursor-pointer text-slate-300">Paste a roster</summary>
        <textarea
          aria-label="Paste roster" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={'One player per line, e.g.\n23 Ben Smith\n#5, Dan\n00 Eli'}
          className={`${input} mt-2 w-full font-mono`}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">{parsed.length} player{parsed.length === 1 ? '' : 's'} found</span>
          <button
            disabled={parsed.length === 0} data-add-pasted
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold hover:bg-sky-500 disabled:opacity-40"
            onClick={() => { parsed.forEach((p) => s().addPlayer(team.id, p)); setPaste(''); }}
          >
            Add {parsed.length || ''} to {team.name || 'team'}
          </button>
        </div>
      </details>

      {issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-300" data-part="issues">
          {issues.map((i) => <li key={i}>{i}</li>)}
        </ul>
      )}
    </section>
  );
}

export function RosterDialog() {
  const open = useUi((s) => s.rosterOpen);
  // Select primitives separately: a selector that builds a new array each call makes zustand re-render forever.
  const home = useGame((s) => s.game.teams[0].color.toLowerCase());
  const away = useGame((s) => s.game.teams[1].color.toLowerCase());
  const game = useGame((s) => s.game);
  const usage = useMemo(() => eventCountByPlayer(game), [game]);
  const close = () => useUi.getState().setRosterOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Teams and roster"
        className="flex max-h-full w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-xl bg-slate-900 p-4 shadow-2xl ring-1 ring-slate-600">
        <header className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">Teams &amp; Roster</h2>
          <button
            className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600"
            title="Home and Away trade baskets for the start of the game"
            onClick={() => gameStore.getState().swapSides()}
          >
            ⇄ Swap sides
          </button>
          {home === away && (
            <span className="text-xs text-amber-300">Both teams have the same color, so shots will be hard to tell apart.</span>
          )}
          <span className="ml-auto text-xs text-slate-400">Changes save automatically. To remove a player who has stats, open their events and delete or reassign them first.</span>
          <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600" onClick={close} data-close>Done (Esc)</button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2">
          <TeamEditor teamIndex={0} usage={usage} />
          <TeamEditor teamIndex={1} usage={usage} />
        </div>
      </div>
    </div>
  );
}

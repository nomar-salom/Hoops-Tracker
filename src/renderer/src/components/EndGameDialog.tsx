import { useEffect, useMemo } from 'react';
import { lineScore, periodLabel, teamTotals } from '@shared/stats';
import { periodsInGame } from '@shared/store';
import { gameStore, useGame } from '../store';
import { useUi } from '../ui';

export function EndGameDialog() {
  const open = useUi((s) => s.endGameOpen);
  const game = useGame((s) => s.game);
  const close = () => useUi.getState().setEndGameOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const periods = useMemo(() => periodsInGame(game), [game]);
  const ls = useMemo(() => lineScore({ ...game, currentPeriod: periods.length }), [game, periods]);
  const fg = useMemo(() => game.teams.map((t) => teamTotals(game, t)), [game]);
  if (!open) return null;

  const [a, b] = ls.total;
  const result = a === b ? 'Tied' : `${game.teams[a > b ? 0 : 1].name} win`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="End game"
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-600">
        <h2 className="text-lg font-bold">End the game?</h2>

        <div className="rounded-md bg-slate-800 p-3" data-part="final-score">
          <div className="flex items-baseline justify-between text-2xl font-bold tabular-nums">
            <span>{game.teams[0].name} {a}</span><span className="text-sm font-normal text-slate-400">{result}</span><span>{b} {game.teams[1].name}</span>
          </div>
          <table className="mt-2 w-full text-xs tabular-nums text-slate-300">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium" />
                {periods.map((p) => <th key={p} className="px-1 text-right font-medium">{periodLabel(p, game.regulationPeriods)}</th>)}
              </tr>
            </thead>
            <tbody>
              {game.teams.map((t, i) => (
                <tr key={t.id}>
                  <td className="py-0.5">{t.name}</td>
                  {periods.map((p) => <td key={p} className="px-1 text-right">{ls.byPeriod[p]![i]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-xs text-slate-400">
            Shooting: {game.teams[0].name} {fg[0]!.fg2m + fg[0]!.fg3m}-{fg[0]!.fg2a + fg[0]!.fg3a} · {game.teams[1].name} {fg[1]!.fg2m + fg[1]!.fg3m}-{fg[1]!.fg2a + fg[1]!.fg3a}
          </div>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>No more stats can be recorded, but you can still look at any quarter and any player's shots.</li>
          <li>Mistakes can still be fixed in the <b>Event log</b>.</li>
          <li><b>Reopen game</b> at any time to keep scoring.</li>
        </ul>

        <div className="flex justify-end gap-2">
          <button className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600" onClick={close} data-cancel>Cancel</button>
          <button className="rounded bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500" data-confirm-end
            onClick={() => {
              gameStore.getState().endGame();
              useUi.getState().setShotPlayer(null);
              close();
              useUi.getState().showToast('Game ended. Review any quarter or player from the strip above the court.');
            }}>
            End game
          </button>
        </div>
      </div>
    </div>
  );
}

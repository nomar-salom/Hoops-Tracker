import { periodLabel } from '@shared/stats';
import { lineScore } from '@shared/stats';
import { playerShooting } from '@shared/eventLog';
import type { Game } from '@shared/types';
import { periodsInGame } from '@shared/store';

export interface GameSummaryProps {
  game: Game;
  /** Highlighted player (the one whose shots are being shown). */
  activePlayerId: string | null;
  onShowPlayerShots: (playerId: string) => void;
  /** Open by default (review mode). */
  open: boolean;
}

const fmt = (m: number, a: number) => `${m}-${a}`;
const pct = (m: number, a: number) => (a > 0 ? `${Math.round((m / a) * 100)}%` : '–');

/** Line score and every player's shooting, with a button to put one player's shots on the court. */
export function GameSummary({ game, activePlayerId, onShowPlayerShots, open }: GameSummaryProps) {
  const periods = periodsInGame(game);
  const ls = lineScore({ ...game, currentPeriod: periods.length });
  const th = 'px-2 py-1 text-right font-medium text-slate-400';
  return (
    <details open={open} className="rounded-lg bg-slate-800/60 p-3 ring-1 ring-slate-700" data-part="game-summary">
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-200">Game summary</summary>

      <table className="mt-3 w-full text-sm tabular-nums" data-part="line-score">
        <thead>
          <tr className="text-xs">
            <th className="px-2 py-1 text-left font-medium text-slate-400">Line score</th>
            {periods.map((p) => <th key={p} className={th}>{periodLabel(p, game.regulationPeriods)}</th>)}
            <th className={th}>Final</th>
          </tr>
        </thead>
        <tbody>
          {game.teams.map((t, ti) => (
            <tr key={t.id} className="border-t border-slate-700">
              <td className="px-2 py-1 font-medium"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: t.color }} />{t.name}</td>
              {periods.map((p) => <td key={p} className="px-2 py-1 text-right">{ls.byPeriod[p]![ti]}</td>)}
              <td className="px-2 py-1 text-right font-bold">{ls.total[ti]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {game.teams.map((t) => (
          <table key={t.id} className="w-full text-xs tabular-nums" data-part="shooting" data-team-shooting={t.id}>
            <thead>
              <tr>
                <th className="px-1.5 py-1 text-left font-medium" style={{ color: t.color }}>{t.name}</th>
                <th className={th}>PTS</th><th className={th}>FG</th><th className={th}>3P</th><th className={th}>FT</th><th className="w-14" />
              </tr>
            </thead>
            <tbody>
              {t.players.map((p) => {
                const sh = playerShooting(game, p.id);
                const active = activePlayerId === p.id;
                return (
                  <tr key={p.id} data-summary-player={p.id} className={`border-t border-slate-700 ${active ? 'bg-sky-900/40' : ''}`}>
                    <td className="px-1.5 py-1"><b className="mr-1.5">#{p.number}</b>{p.name}</td>
                    <td className="px-1.5 py-1 text-right font-semibold">{sh.pts}</td>
                    <td className="px-1.5 py-1 text-right">{fmt(sh.fgm, sh.fga)} <span className="text-slate-500">{pct(sh.fgm, sh.fga)}</span></td>
                    <td className="px-1.5 py-1 text-right">{fmt(sh.fg3m, sh.fg3a)}</td>
                    <td className="px-1.5 py-1 text-right">{fmt(sh.ftm, sh.fta)}</td>
                    <td className="px-1.5 py-1 text-right">
                      <button
                        type="button" data-show-shots={p.id} aria-pressed={active}
                        disabled={sh.fga === 0}
                        title={sh.fga === 0 ? 'No shots taken' : active ? 'Showing this player\u2019s shots (click for everyone)' : `Show ${p.name}\u2019s shots on the court`}
                        onClick={() => onShowPlayerShots(p.id)}
                        className={`rounded px-2 py-0.5 text-[11px] disabled:opacity-30 ${active ? 'bg-sky-600 text-white' : 'bg-slate-700 hover:bg-slate-600'}`}
                      >
                        Shots
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </details>
  );
}

import { useEffect, useMemo } from 'react';
import { isGameEnded, selectStatFilter } from '@shared/store';
import { BONUS_AT, computeStats, emptyLine, periodLabel, teamFoulStatus, teamFoulsByPeriod, teamTotals } from '@shared/stats';
import { PlayerCard, TeamFoulsStrip, TeamTotalsGrid } from './PlayerCard';
import { gameStore, useGame } from '../store';
import { performStat } from '../perform';
import { quickActions } from '../statActions';
import { useActivePrompt, useUi } from '../ui';

export function TeamSidebar({ teamIndex }: { teamIndex: 0 | 1 }) {
  const game = useGame((s) => s.game);
  const selectedId = useGame((s) => s.selectedPlayerId);
  const viewPeriod = useGame((s) => s.viewPeriod);
  const shotPlayerId = useUi((s) => s.shotPlayerId);
  const ended = isGameEnded(game);
  const prompt = useActivePrompt();
  const team = game.teams[teamIndex];
  const keyboardFocus = useUi((s) => s.inputMode === 'keyboard' && s.activeTeam === teamIndex);

  // Keep the selected player visible when they are picked with the keyboard.
  useEffect(() => {
    if (!selectedId || !team.players.some((p) => p.id === selectedId)) return;
    document.querySelector(`[data-player="${selectedId}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, team.players]);

  // What this sidebar shows: the whole game or any single period (not only the current one).
  const filter = useMemo(() => selectStatFilter({ viewPeriod }), [viewPeriod]);
  const stats = useMemo(() => computeStats(game, filter), [game, filter]);
  // Foul limits are per game, whatever period the sidebar is showing.
  const gameStats = useMemo(() => computeStats(game), [game]);
  const other = game.teams[teamIndex === 0 ? 1 : 0];
  const foulsByPeriod = useMemo(() => teamFoulsByPeriod(game, team), [game, team]);
  const myFouls = useMemo(() => teamFoulStatus(game, team, game.currentPeriod), [game, team]);
  // I'm in the bonus when the OTHER team has reached the limit.
  const inBonus = useMemo(() => teamFoulStatus(game, other, game.currentPeriod).opponentInBonus, [game, other]);
  const totals = useMemo(() => teamTotals(game, team, filter), [game, team, filter]);
  // The score is always the whole game, whatever the stat view is.
  const score = useMemo(() => teamTotals(game, team).pts, [game, team]);
  const periodPts = useMemo(() => (viewPeriod === 'game' ? null : teamTotals(game, team, filter).pts), [game, team, filter, viewPeriod]);

  return (
    <aside
      className={`flex min-h-0 flex-col gap-3 overflow-y-auto rounded-lg bg-slate-800/60 p-3 ${keyboardFocus ? 'ring-2 ring-sky-400' : ''}`}
      style={{ borderTop: `4px solid ${team.color}` }}
      data-team={team.id}
      data-keyboard-active={keyboardFocus}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="truncate text-lg font-semibold">
          {team.name}
          <button className="ml-2 align-middle text-xs font-normal text-slate-400 underline hover:text-white"
            onClick={() => useUi.getState().setRosterOpen(true)}>edit</button>
        </h2>
        <span className="text-4xl font-bold tabular-nums" title="Game score">{score}</span>
      </div>
      {periodPts !== null && (
        <div className="-mt-2 text-right text-xs text-sky-300" data-part="period-points">
          {periodLabel(viewPeriod as number, game.regulationPeriods)}: <b>{periodPts}</b> pts <span className="text-slate-500">(stats below are for this period)</span>
        </div>
      )}

      <TeamTotalsGrid line={totals} />

      <TeamFoulsStrip
        byPeriod={foulsByPeriod}
        currentPeriod={game.currentPeriod}
        label={(p) => periodLabel(p, game.regulationPeriods)}
        bonusCount={myFouls.bonusCount}
        bonusAt={BONUS_AT}
        inBonus={inBonus}
      />

      {team.players.length === 0 && (
        <p className="rounded border border-dashed border-slate-600 p-3 text-sm text-slate-400">
          No players yet. Use <b>Teams &amp; Roster</b> to add some.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {team.players.map((p) => (
          <PlayerCard
            key={p.id}
            team={team}
            player={p}
            line={stats.get(p.id) ?? emptyLine()}
            gameLine={gameStats.get(p.id) ?? emptyLine()}
            selected={selectedId === p.id}
            quick={ended ? [] : quickActions(game, prompt, p.id)}
            locked={ended}
            shotsActive={shotPlayerId === p.id}
            onShots={() => {
              useUi.getState().setShotPlayer(shotPlayerId === p.id ? null : p.id);
              if (shotPlayerId !== p.id && !useUi.getState().showShots[teamIndex]) useUi.getState().setShowShots(teamIndex, true);
            }}
            onSelect={() => {
              if (ended) { // nothing to record: clicking a player just shows their shots
                useUi.getState().setShotPlayer(shotPlayerId === p.id ? null : p.id);
                if (!useUi.getState().showShots[teamIndex]) useUi.getState().setShowShots(teamIndex, true);
                return;
              }
              useUi.getState().setActiveTeam(teamIndex); // clicking a player also points the keyboard at this team
              gameStore.getState().selectPlayer(selectedId === p.id ? null : p.id);
            }}
            onAction={(a) => performStat(a, p.id)}
          />
        ))}
      </ul>

      <p className="text-[11px] text-slate-500">
        {ended ? 'Game ended: click a player to see their shots.' : 'Shots: select a player, then click the court.'}{' '}{viewPeriod === 'game' ? 'Showing the whole game.' : `Showing ${periodLabel(viewPeriod, game.regulationPeriods)} only.`}
      </p>
    </aside>
  );
}

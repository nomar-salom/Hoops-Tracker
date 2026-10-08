import type { Game } from './types';
import { COURTS } from './court';
import { computeStats, sumLines, fgm, fga, MAX_FOULS, MAX_TECHNICALS, foulTotal } from './stats';

/** Returns a list of problems; empty array = valid. Use on XLSX import. */
export function validateGame(game: Game): string[] {
  const errors: string[] = [];
  if (game.schemaVersion !== 1) errors.push(`Unsupported schemaVersion ${game.schemaVersion}`);

  if (game.endedAt !== undefined && Number.isNaN(Date.parse(game.endedAt))) errors.push(`endedAt is not a valid date: ${game.endedAt}`);
  if (!(game.courtType in COURTS)) errors.push(`Unknown courtType ${String(game.courtType)}`);

  const playerTeam = new Map<string, string>();
  for (const t of game.teams) {
    for (const p of t.players) {
      if (playerTeam.has(p.id)) errors.push(`Duplicate player id ${p.id}`);
      playerTeam.set(p.id, t.id);
    }
  }
  if (game.teams[0].id === game.teams[1].id) errors.push('Both teams have the same id');

  const seenEvents = new Set<string>();
  for (const e of game.events) {
    if (seenEvents.has(e.id)) errors.push(`Duplicate event id ${e.id}`);
    seenEvents.add(e.id);
  }

  for (const e of game.events) {
    if (!playerTeam.has(e.playerId)) errors.push(`Event ${e.id}: unknown player ${e.playerId}`);
    else if (playerTeam.get(e.playerId) !== e.teamId) errors.push(`Event ${e.id}: player is not on team ${e.teamId}`);
    if (e.period < 1 || e.period > game.currentPeriod) errors.push(`Event ${e.id}: period ${e.period} out of range`);
    if (e.type === 'shot') {
      if (e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1) errors.push(`Event ${e.id}: coordinates out of range`);
      if (e.assistedBy && !e.made) errors.push(`Event ${e.id}: assist on a missed shot`);
      if (e.blockedBy && e.made) errors.push(`Event ${e.id}: block on a made shot`);
      if (e.assistedBy && !playerTeam.has(e.assistedBy)) errors.push(`Event ${e.id}: unknown assister`);
      if (e.blockedBy && !playerTeam.has(e.blockedBy)) errors.push(`Event ${e.id}: unknown blocker`);
      if (e.assistedBy && playerTeam.has(e.assistedBy)) {
        if (e.assistedBy === e.playerId) errors.push(`Event ${e.id}: a player can't assist his own shot`);
        else if (playerTeam.get(e.assistedBy) !== e.teamId) errors.push(`Event ${e.id}: the assist must come from a teammate`);
      }
      if (e.blockedBy && playerTeam.has(e.blockedBy) && playerTeam.get(e.blockedBy) === e.teamId) {
        errors.push(`Event ${e.id}: the block must come from an opponent`);
      }
    }
  }

  for (const e of game.events) {
    if (e.type === 'foul' && e.kind !== 'personal' && e.kind !== 'technical') {
      errors.push(`Event ${e.id}: foul kind must be "personal" or "technical"`);
    }
  }
  const nameOf = (pid: string) => {
    const p = game.teams.flatMap((t) => t.players).find((x) => x.id === pid);
    return p ? `#${p.number} ${p.name}`.trim() : `Player ${pid}`;
  };
  for (const [pid, line] of computeStats(game)) {
    if (foulTotal(line) > MAX_FOULS) errors.push(`${nameOf(pid)} would have ${foulTotal(line)} fouls (maximum ${MAX_FOULS})`);
    if (line.tf > MAX_TECHNICALS) errors.push(`${nameOf(pid)} would have ${line.tf} technical fouls (maximum ${MAX_TECHNICALS})`);
  }

  const total = sumLines([...computeStats(game).values()]);
  if (total.reb !== total.oreb + total.dreb) errors.push('reb != oreb + dreb');
  if (fgm(total) > fga(total)) errors.push('FGM > FGA');
  return errors;
}

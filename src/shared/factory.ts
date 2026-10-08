import type { Game, Team } from './types';

export interface NewGameOptions {
  /** [home, away]: keep that team's players, or start it with an empty roster (and its default name). */
  keepRoster: [boolean, boolean];
  /** ISO instant; defaults to now. */
  date?: string;
  location?: string;
}

const newTeam = (name: string, color: string, attacksRight: boolean): Team => ({
  id: crypto.randomUUID(),
  name,
  color,
  attacksRightInPeriod1: attacksRight,
  players: [],
});

export function createEmptyGame(homeName = 'Home', awayName = 'Away'): Game {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    regulationPeriods: 4,
    courtType: 'nfhs', // high school by default
    currentPeriod: 1,
    teams: [newTeam(homeName, '#1d4ed8', true), newTeam(awayName, '#dc2626', false)],
    events: [],
  };
}

/**
 * The next game: same court type, period setup, team colors and sides, with a new
 * id/date and no events. A kept roster keeps its player ids; a cleared one loses
 * its players AND its name (it's a different opponent), but keeps its color.
 */
export function createNextGame(
  prev: Game,
  opts: NewGameOptions,
  id: string = crypto.randomUUID(),
  nowIso: string = new Date().toISOString(),
): Game {
  const teams = prev.teams.map((t, i) =>
    opts.keepRoster[i]
      ? { ...t, players: t.players.map((p) => ({ ...p })) }
      : { ...t, name: i === 0 ? 'Home' : 'Away', players: [] },
  ) as Game['teams'];
  const location = opts.location?.trim();
  return {
    schemaVersion: 1,
    id,
    date: opts.date ?? nowIso,
    ...(location ? { location } : {}),
    regulationPeriods: prev.regulationPeriods,
    courtType: prev.courtType,
    currentPeriod: 1,
    teams,
    events: [],
  };
}

import type {
  Game, Team, ID, StatLine, StatFilter, LineScore,
} from './types';

export const emptyLine = (): StatLine => ({
  pts: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, tf: 0,
  fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
});

export const fgm = (s: StatLine) => s.fg2m + s.fg3m;
export const fga = (s: StatLine) => s.fg2a + s.fg3a;

export const periodLabel = (p: number, regulation = 4) =>
  p <= regulation ? `Q${p}` : `OT${p - regulation}`;

export function computeStats(
  game: Game,
  filter: StatFilter = {},
): Map<ID, StatLine> {
  const lines = new Map<ID, StatLine>();
  const get = (id: ID): StatLine => {
    let l = lines.get(id);
    if (!l) {
      l = emptyLine();
      lines.set(id, l);
    }
    return l;
  };

  for (const e of game.events) {
    if (filter.periods && !filter.periods.includes(e.period)) continue;
    const line = get(e.playerId);
    switch (e.type) {
      case 'shot':
        if (e.points === 2) {
          line.fg2a++;
          if (e.made) { line.fg2m++; line.pts += 2; }
        } else {
          line.fg3a++;
          if (e.made) { line.fg3m++; line.pts += 3; }
        }
        if (e.assistedBy) get(e.assistedBy).ast++;
        if (e.blockedBy) get(e.blockedBy).blk++;
        break;
      case 'freeThrow':
        line.fta++;
        if (e.made) { line.ftm++; line.pts++; }
        break;
      case 'rebound':
        line.reb++;
        if (e.kind === 'offensive') line.oreb++;
        else line.dreb++;
        break;
      case 'steal': line.stl++; break;
      case 'turnover': line.tov++; break;
      case 'foul':
        if (e.kind === 'technical') line.tf++;
        else line.pf++;
        break;
    }
  }

  if (filter.playerIds) {
    for (const id of [...lines.keys()]) {
      if (!filter.playerIds.includes(id)) lines.delete(id);
    }
  }
  return lines;
}

export function sumLines(lines: StatLine[]): StatLine {
  const total = emptyLine();
  for (const l of lines) {
    for (const k of Object.keys(total) as (keyof StatLine)[]) total[k] += l[k];
  }
  return total;
}

export function teamTotals(
  game: Game,
  team: Team,
  filter: StatFilter = {},
): StatLine {
  const stats = computeStats(game, filter);
  return sumLines(team.players.map((p) => stats.get(p.id) ?? emptyLine()));
}

export function lineScore(game: Game): LineScore {
  const byPeriod: LineScore['byPeriod'] = {};
  for (let p = 1; p <= game.currentPeriod; p++) {
    byPeriod[p] = [
      teamTotals(game, game.teams[0], { periods: [p] }).pts,
      teamTotals(game, game.teams[1], { periods: [p] }).pts,
    ];
  }
  return {
    byPeriod,
    total: [
      teamTotals(game, game.teams[0]).pts,
      teamTotals(game, game.teams[1]).pts,
    ],
  };
}

/** Teams swap baskets at halftime; overtime follows second-half direction. */
export function attacksRight(team: Team, period: number, regulation = 4): boolean {
  const secondHalf = period > regulation / 2;
  return secondHalf ? !team.attacksRightInPeriod1 : team.attacksRightInPeriod1;
}

// ---------------------------------------------------------------------------
// Fouls (NFHS / high school)
// ---------------------------------------------------------------------------

/** A player is disqualified on his 5th foul. Technicals count toward this. */
export const MAX_FOULS = 5;
/** A player is ejected on his 2nd technical foul. */
export const MAX_TECHNICALS = 2;
/** The opponent shoots two free throws on common fouls once a team has this many in a quarter. */
export const BONUS_AT = 5;
/**
 * NFHS: an overtime period is an extension of the 4th quarter for team fouls,
 * so the count carries over instead of resetting. Set to false to reset every period.
 */
export const OVERTIME_CARRIES_FOULS = true;

/** Total fouls charged to a player (personal + technical): the number that counts toward 5. */
export const foulTotal = (l: Pick<StatLine, 'pf' | 'tf'>) => l.pf + l.tf;

export interface PlayerFoulStatus {
  total: number;
  personal: number;
  technical: number;
  /** Fouls left before disqualification. */
  remaining: number;
  disqualified: boolean; // 5 fouls
  ejected: boolean; // 2 technicals
  /** Out of the game for either reason. */
  out: boolean;
}

export function playerFoulStatus(l: Pick<StatLine, 'pf' | 'tf'>): PlayerFoulStatus {
  const total = foulTotal(l);
  const disqualified = total >= MAX_FOULS;
  const ejected = l.tf >= MAX_TECHNICALS;
  return {
    total, personal: l.pf, technical: l.tf,
    remaining: Math.max(0, MAX_FOULS - total),
    disqualified, ejected, out: disqualified || ejected,
  };
}

/**
 * Why a foul can't be charged to this player, or null if it can. A player who is
 * out of the game (5 fouls, or ejected for 2 technicals) can't be charged anything more.
 */
export function foulBlockedReason(l: Pick<StatLine, 'pf' | 'tf'>, _kind: 'personal' | 'technical'): string | null {
  void _kind; // same answer for both kinds today; kept so callers state what they intend to add
  if (foulTotal(l) >= MAX_FOULS) return `Fouled out (${MAX_FOULS} fouls)`;
  if (l.tf >= MAX_TECHNICALS) return `Ejected (${MAX_TECHNICALS} technicals)`;
  return null;
}

/** Team fouls (personal + technical) charged in each period, keyed by period number. */
export function teamFoulsByPeriod(game: Game, team: Team): Record<number, number> {
  const ids = new Set(team.players.map((p) => p.id));
  const out: Record<number, number> = {};
  for (let p = 1; p <= game.currentPeriod; p++) out[p] = 0;
  for (const e of game.events) {
    if (e.type === 'foul' && ids.has(e.playerId)) out[e.period] = (out[e.period] ?? 0) + 1;
  }
  return out;
}

export interface TeamFoulStatus {
  /** Fouls charged in this period alone. */
  periodFouls: number;
  /** The count the bonus is based on (differs from periodFouls only in overtime). */
  bonusCount: number;
  /** This team's OPPONENT shoots two on common fouls. */
  opponentInBonus: boolean;
}

export function teamFoulStatus(game: Game, team: Team, period: number): TeamFoulStatus {
  const by = teamFoulsByPeriod(game, team);
  const regulation = game.regulationPeriods;
  const periodFouls = by[period] ?? 0;
  let bonusCount = periodFouls;
  if (OVERTIME_CARRIES_FOULS && period > regulation) {
    bonusCount = 0;
    for (let p = regulation; p <= period; p++) bonusCount += by[p] ?? 0;
  }
  return { periodFouls, bonusCount, opponentInBonus: bonusCount >= BONUS_AT };
}

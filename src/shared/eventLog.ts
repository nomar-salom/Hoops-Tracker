import type { Game, GameEvent, ID, ShotEvent, Team } from './types';
import { computeStats, emptyLine } from './stats';

/** What the event log can be filtered to. 'assist' and 'block' match the SHOTS that carry them. */
export type LogTypeFilter = 'all' | GameEvent['type'] | 'assist' | 'block';

export interface LogFilter {
  period?: number;
  teamId?: ID;
  /** Events that involve this player in any role: the actor, the assister, or the blocker. */
  playerId?: ID;
  type?: LogTypeFilter;
}

export interface LogRow {
  /** Position in the chronological log (0-based). The UI shows index + 1. */
  index: number;
  event: GameEvent;
}

export const LOG_TYPE_LABELS: Record<Exclude<LogTypeFilter, 'all'>, string> = {
  shot: 'Shots',
  freeThrow: 'Free throws',
  rebound: 'Rebounds',
  foul: 'Fouls',
  steal: 'Steals',
  turnover: 'Turnovers',
  assist: 'Assists',
  block: 'Blocks',
};

export function findPlayer(game: Game, id: ID | undefined) {
  if (!id) return undefined;
  for (const team of game.teams) {
    const player = team.players.find((p) => p.id === id);
    if (player) return { team, player };
  }
  return undefined;
}

/** "#23 Dan" */
export function playerLabel(game: Game, id: ID | undefined): string {
  const f = findPlayer(game, id);
  return f ? `#${f.player.number} ${f.player.name}`.trim() : 'Unknown player';
}

export const teamOf = (game: Game, e: GameEvent): Team | undefined => game.teams.find((t) => t.id === e.teamId);

/** Short description of what happened: "3PT made", "Defensive rebound", "Technical foul". */
export function eventWhat(e: GameEvent): string {
  switch (e.type) {
    case 'shot': return `${e.points}PT ${e.made ? 'made' : 'missed'}`;
    case 'freeThrow': return `Free throw ${e.made ? 'made' : 'missed'}`;
    case 'rebound': return e.kind === 'offensive' ? 'Offensive rebound' : 'Defensive rebound';
    case 'foul': return e.kind === 'technical' ? 'Technical foul' : 'Personal foul';
    case 'steal': return 'Steal';
    case 'turnover': return 'Turnover';
  }
}

/** Extra context, e.g. "assist: #1 Alex" or "blocked by #23 Dan". Empty when there is none. */
export function eventExtra(game: Game, e: GameEvent): string {
  if (e.type !== 'shot') return '';
  const parts: string[] = [];
  if (e.assistedBy) parts.push(`assist: ${playerLabel(game, e.assistedBy)}`);
  if (e.blockedBy) parts.push(`blocked by ${playerLabel(game, e.blockedBy)}`);
  return parts.join(' \u00b7 ');
}

/** Does this event involve the player in any role? */
export function involvesPlayer(e: GameEvent, playerId: ID): boolean {
  return e.playerId === playerId || (e.type === 'shot' && (e.assistedBy === playerId || e.blockedBy === playerId));
}

/** Rows matching the filter, in chronological order. */
export function filterEvents(game: Game, f: LogFilter = {}): LogRow[] {
  const rows: LogRow[] = [];
  game.events.forEach((event, index) => {
    if (f.period !== undefined && event.period !== f.period) return;
    if (f.teamId && event.teamId !== f.teamId) return;
    if (f.playerId && !involvesPlayer(event, f.playerId)) return;
    if (f.type && f.type !== 'all') {
      if (f.type === 'assist') { if (!(event.type === 'shot' && event.assistedBy)) return; }
      else if (f.type === 'block') { if (!(event.type === 'shot' && event.blockedBy)) return; }
      else if (event.type !== f.type) return;
    }
    rows.push({ index, event });
  });
  return rows;
}

/** How many events reference each player (as actor, assister or blocker). Drives "can this player be removed?". */
export function eventCountByPlayer(game: Game): Map<ID, number> {
  const m = new Map<ID, number>();
  const bump = (id?: ID) => { if (id) m.set(id, (m.get(id) ?? 0) + 1); };
  for (const e of game.events) {
    bump(e.playerId);
    if (e.type === 'shot') { bump(e.assistedBy); bump(e.blockedBy); }
  }
  return m;
}

export interface ShotCount { made: number; attempts: number }

/**
 * Made / attempted field goals per team ([home, away]), optionally for one period.
 * Counts every shot with a court position, which is exactly what the court draws.
 */
export function shotCounts(game: Game, opts: { period?: number } = {}): [ShotCount, ShotCount] {
  const out: [ShotCount, ShotCount] = [{ made: 0, attempts: 0 }, { made: 0, attempts: 0 }];
  for (const e of game.events) {
    if (e.type !== 'shot') continue;
    if (opts.period !== undefined && e.period !== opts.period) continue;
    const i = game.teams.findIndex((t) => t.id === e.teamId);
    if (i !== 0 && i !== 1) continue;
    out[i]!.attempts++;
    if (e.made) out[i]!.made++;
  }
  return out;
}

export interface ShotView {
  /** Whole game, or one period (any period, not just the current one). */
  period: 'game' | number;
  /** [home, away]: which teams' shots are drawn. */
  teams: [boolean, boolean];
  /** Only this player's shots, or null for everyone. */
  playerId: ID | null;
}

/** The shots the court should draw for a given view, in chronological order. */
export function visibleShots(game: Game, v: ShotView): ShotEvent[] {
  const teamIndex = new Map(game.teams.map((t, i) => [t.id, i]));
  return game.events.filter((e): e is ShotEvent => {
    if (e.type !== 'shot') return false;
    if (v.period !== 'game' && e.period !== v.period) return false;
    if (!v.teams[teamIndex.get(e.teamId) ?? 0]) return false;
    if (v.playerId && e.playerId !== v.playerId) return false;
    return true;
  });
}

export interface Shooting {
  pts: number;
  fgm: number; fga: number;
  fg2m: number; fg2a: number;
  fg3m: number; fg3a: number;
  ftm: number; fta: number;
}

/** One player's scoring and shooting for the whole game or one period. */
export function playerShooting(game: Game, playerId: ID, period: 'game' | number = 'game'): Shooting {
  const line = computeStats(game, { ...(period === 'game' ? {} : { periods: [period] }), playerIds: [playerId] }).get(playerId) ?? emptyLine();
  return {
    pts: line.pts,
    fgm: line.fg2m + line.fg3m, fga: line.fg2a + line.fg3a,
    fg2m: line.fg2m, fg2a: line.fg2a, fg3m: line.fg3m, fg3a: line.fg3a,
    ftm: line.ftm, fta: line.fta,
  };
}

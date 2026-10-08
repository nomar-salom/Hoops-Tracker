import { findTeamOfPlayer, type ContextPrompt } from '@shared/store';
import { MAX_TECHNICALS, foulBlockedReason } from '@shared/stats';
import type { Game, ID, StatLine } from '@shared/types';

/** Everything a stat button can do. Shots are entered on the court, not here. */
export type StatAction = 'ftMade' | 'ftMiss' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'tov' | 'foul' | 'tech';

export type Tone = 'good' | 'bad' | 'neutral';

export interface ActionDef {
  action: StatAction;
  label: string;
  tone: Tone;
  /** Current count to display on the button. */
  count: (l: StatLine) => number;
  /** Show "/limit" after the count. */
  limit?: number;
  /** Grid columns the button spans (grid has 4). */
  span?: 1 | 2;
  /**
   * Foul limits are about the whole game, so these buttons read the player's
   * whole-game line even when the sidebar is showing a single period.
   */
  wholeGame?: boolean;
  /** Why the button can't be pressed right now (null = it can). */
  blockedReason?: (l: StatLine) => string | null;
}

/** Order here is the on-screen order (4 columns: eight 1-wide buttons, then two 2-wide foul buttons). */
export const ACTIONS: ActionDef[] = [
  { action: 'ftMade', label: 'FT made', tone: 'good', count: (l) => l.ftm },
  { action: 'ftMiss', label: 'FT miss', tone: 'bad', count: (l) => l.fta - l.ftm },
  { action: 'oreb', label: 'OREB', tone: 'good', count: (l) => l.oreb },
  { action: 'dreb', label: 'DREB', tone: 'good', count: (l) => l.dreb },
  { action: 'ast', label: 'AST', tone: 'good', count: (l) => l.ast },
  { action: 'stl', label: 'STL', tone: 'good', count: (l) => l.stl },
  { action: 'blk', label: 'BLK', tone: 'good', count: (l) => l.blk },
  { action: 'tov', label: 'TO', tone: 'bad', count: (l) => l.tov },
  {
    action: 'foul', label: 'Personal foul', tone: 'bad', span: 2, wholeGame: true,
    count: (l) => l.pf, blockedReason: (l) => foulBlockedReason(l, 'personal'),
  },
  {
    action: 'tech', label: 'Technical', tone: 'bad', span: 2, wholeGame: true,
    count: (l) => l.tf, limit: MAX_TECHNICALS, blockedReason: (l) => foulBlockedReason(l, 'technical'),
  },
];

export const actionDef = (a: StatAction) => ACTIONS.find((d) => d.action === a)!;

/**
 * One-tap suggestions for a player, based on what just happened:
 *  - after a miss: the shooter's team can take an OFFENSIVE rebound, the other team a DEFENSIVE one
 *  - after an unassisted make: teammates (not the shooter) can be credited with the assist
 *  - after a missed shot: opponents can be credited with a block
 */
export function quickActions(game: Game, prompt: ContextPrompt | null, playerId: ID): StatAction[] {
  if (!prompt) return [];
  const team = findTeamOfPlayer(game, playerId);
  if (!team) return [];
  const sameTeamAsShooter = team.id === prompt.event.teamId;
  const out: StatAction[] = [];
  if (prompt.needsRebound) out.push(sameTeamAsShooter ? 'oreb' : 'dreb');
  if (prompt.needsAssist && sameTeamAsShooter && playerId !== prompt.event.playerId) out.push('ast');
  if (prompt.canBlock && !sameTeamAsShooter) out.push('blk');
  return out;
}

export const fmt = (made: number, att: number) => `${made}-${att}`;
export const pctText = (made: number, att: number) => (att > 0 ? `${Math.round((made / att) * 100)}%` : '–');

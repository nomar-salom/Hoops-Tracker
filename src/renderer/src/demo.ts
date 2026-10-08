import { createEmptyGame } from '@shared/factory';
import type { Game } from '@shared/types';

/** Placeholder rosters so the court can be exercised before the roster editor exists. */
export function createDemoGame(): Game {
  const game = createEmptyGame('Home', 'Away');
  const names = ['Alex', 'Ben', 'Cal', 'Dan', 'Eli'];
  const numbers = ['1', '5', '10', '23', '00'];
  const teams = game.teams.map((t) => ({
    ...t,
    players: names.map((name, i) => ({ id: crypto.randomUUID(), number: numbers[i]!, name })),
  })) as Game['teams'];
  return { ...game, teams };
}

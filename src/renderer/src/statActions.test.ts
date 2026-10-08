import { describe, expect, test } from 'vitest';
import { contextPrompt, createGameStore } from '@shared/store';
import { sampleGame } from '@shared/fixtures';
import { ACTIONS, fmt, pctText, quickActions } from './statActions';
import type { Game } from '@shared/types';

const fresh = (): { s: ReturnType<typeof createGameStore>; game: () => Game } => {
  const s = createGameStore({ initialGame: { ...sampleGame(), events: [], currentPeriod: 1 } });
  return { s, game: () => s.getState().game };
};
// home: h1 h2 h3   away: a1 a2

describe('quickActions', () => {
  test('nothing suggested without a prompt', () => {
    const { game } = fresh();
    expect(quickActions(game(), null, 'h1')).toEqual([]);
  });

  test('after a missed shot: shooter\'s team gets OREB, opponents get DREB + BLK', () => {
    const { s, game } = fresh();
    s.getState().addShot({ playerId: 'h1', points: 2, made: false, x: 0.9, y: 0.5 });
    const p = contextPrompt(game());
    expect(quickActions(game(), p, 'h1')).toEqual(['oreb']); // shooter may rebound his own miss
    expect(quickActions(game(), p, 'h2')).toEqual(['oreb']);
    expect(quickActions(game(), p, 'a1')).toEqual(['dreb', 'blk']);
  });

  test('after an unassisted make: teammates (not the shooter) get AST, opponents nothing', () => {
    const { s, game } = fresh();
    s.getState().addShot({ playerId: 'h1', points: 3, made: true, x: 0.7, y: 0.5 });
    const p = contextPrompt(game());
    expect(quickActions(game(), p, 'h1')).toEqual([]);
    expect(quickActions(game(), p, 'h2')).toEqual(['ast']);
    expect(quickActions(game(), p, 'a1')).toEqual([]);
  });

  test('after a missed free throw: rebound only, no block', () => {
    const { s, game } = fresh();
    s.getState().addFreeThrow('a1', false);
    const p = contextPrompt(game());
    expect(quickActions(game(), p, 'a2')).toEqual(['oreb']);
    expect(quickActions(game(), p, 'h1')).toEqual(['dreb']);
  });

  test('block disappears once recorded, rebound prompt stays', () => {
    const { s, game } = fresh();
    s.getState().addShot({ playerId: 'h1', points: 2, made: false, x: 0.9, y: 0.5 });
    s.getState().creditBlock('a1');
    expect(quickActions(game(), contextPrompt(game()), 'a2')).toEqual(['dreb']);
  });
});

test('button list covers every action once and fills a 4-column grid exactly', () => {
  expect(ACTIONS).toHaveLength(10);
  expect(new Set(ACTIONS.map((a) => a.action)).size).toBe(10);
  const cells = ACTIONS.reduce((n, a) => n + (a.span ?? 1), 0);
  expect(cells % 4).toBe(0); // eight 1-wide + two 2-wide = 12 cells = 3 full rows
  expect(ACTIONS.filter((a) => a.wholeGame).map((a) => a.action)).toEqual(['foul', 'tech']);
});

test('formatting helpers', () => {
  expect(fmt(5, 9)).toBe('5-9');
  expect(pctText(5, 9)).toBe('56%');
  expect(pctText(0, 0)).toBe('–');
});

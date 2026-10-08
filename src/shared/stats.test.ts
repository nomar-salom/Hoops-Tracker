import { describe, expect, test } from 'vitest';
import { computeStats, emptyLine, sumLines, lineScore, teamTotals, fgm, fga, attacksRight } from './stats';
import { validateGame } from './validate';
import { sampleGame, home, away } from './fixtures';

describe('stats', () => {
  test('sum of per-period lines equals full-game line', () => {
    const game = sampleGame();
    const periods = Array.from({ length: game.currentPeriod }, (_, i) => i + 1);
    for (const p of game.teams.flatMap((t) => t.players)) {
      const full = computeStats(game).get(p.id) ?? emptyLine();
      const parts = periods.map((n) => computeStats(game, { periods: [n] }).get(p.id) ?? emptyLine());
      expect(sumLines(parts)).toEqual(full);
    }
  });

  test('derived invariants hold', () => {
    for (const l of computeStats(sampleGame()).values()) {
      expect(l.reb).toBe(l.oreb + l.dreb);
      expect(l.pts).toBe(2 * l.fg2m + 3 * l.fg3m + l.ftm);
      expect(fgm(l)).toBe(l.fg2m + l.fg3m);
      expect(fga(l)).toBe(l.fg2a + l.fg3a);
    }
  });

  test('line score totals equal sum of periods', () => {
    const ls = lineScore(sampleGame());
    const sum = Object.values(ls.byPeriod).reduce<[number, number]>(
      (a, [h, w]) => [a[0] + h, a[1] + w], [0, 0]);
    expect(sum).toEqual(ls.total);
    expect(ls.total).toEqual([4, 5]);
  });

  test('assists and blocks credit the right player', () => {
    const s = computeStats(sampleGame());
    expect(s.get('h2')?.ast).toBe(1);
    expect(s.get('a1')?.blk).toBe(1);
  });

  test('team totals', () => {
    expect(teamTotals(sampleGame(), home).ftm).toBe(1);
    expect(teamTotals(sampleGame(), away).fg3m).toBe(1);
  });

  test('court direction flips at halftime', () => {
    expect(attacksRight(home, 1)).toBe(true);
    expect(attacksRight(home, 3)).toBe(false);
    expect(attacksRight(home, 5)).toBe(false);
  });
});

describe('validate', () => {
  test('sample game is valid', () => {
    expect(validateGame(sampleGame())).toEqual([]);
  });
  test('catches bad data', () => {
    const g = sampleGame();
    g.events.push({ id: 'bad', teamId: 'home', playerId: 'nobody', period: 9, ts: 99, type: 'steal' });
    expect(validateGame(g).length).toBeGreaterThanOrEqual(2);
  });
});

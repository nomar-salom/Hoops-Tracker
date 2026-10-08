import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computeStats } from '@shared/stats';
import { validateGame } from '@shared/validate';
import { gameStore } from './store';
import { useUi } from './ui';
import { performStat } from './perform';
import { quickActions } from './statActions';
import { contextPrompt } from '@shared/store';
import { teamFoulStatus } from '@shared/stats';

const ids = () => {
  const g = gameStore.getState().game;
  return { h: g.teams[0].players.map((p) => p.id), a: g.teams[1].players.map((p) => p.id) };
};
const stat = (id: string) => computeStats(gameStore.getState().game).get(id);

beforeEach(() => { vi.useFakeTimers(); gameStore.getState().newGame(); });
afterEach(() => vi.useRealTimers());

describe('stat buttons', () => {
  beforeEach(async () => {
    const { createDemoGame } = await import('./demo');
    gameStore.getState().newGame(createDemoGame());
  });

  test('every simple button records the right stat for that player', () => {
    const { h } = ids();
    const p = h[0]!;
    (['ftMade', 'ftMiss', 'oreb', 'dreb', 'stl', 'tov'] as const).forEach((a) => performStat(a, p));
    expect(stat(p)).toMatchObject({ ftm: 1, fta: 2, pts: 1, oreb: 1, dreb: 1, reb: 2, stl: 1, tov: 1 });
    expect(validateGame(gameStore.getState().game)).toEqual([]);
  });

  test('missed shot -> prompt -> opponent DREB and BLK via quick buttons', () => {
    const { h, a } = ids();
    gameStore.getState().addShot({ playerId: h[0]!, points: 3, made: false, x: 0.7, y: 0.5 });
    const prompt = contextPrompt(gameStore.getState().game);
    expect(quickActions(gameStore.getState().game, prompt, a[1]!)).toEqual(['dreb', 'blk']);

    performStat('blk', a[0]!);
    performStat('dreb', a[1]!);
    expect(stat(a[0]!)?.blk).toBe(1);
    expect(stat(a[1]!)?.dreb).toBe(1);
    expect(contextPrompt(gameStore.getState().game)).toBeNull(); // the rebound closed the possession
  });

  test('made shot -> AST on a teammate; toast confirms; undo removes only the assist', () => {
    const { h } = ids();
    gameStore.getState().addShot({ playerId: h[0]!, points: 2, made: true, x: 0.9, y: 0.5 });
    performStat('ast', h[1]!);
    expect(stat(h[1]!)?.ast).toBe(1);
    expect(useUi.getState().toast?.text).toMatch(/^Assist/);

    gameStore.getState().undo();
    expect(stat(h[1]!)?.ast ?? 0).toBe(0);
    expect(stat(h[0]!)?.pts).toBe(2); // the shot is still there
  });

  test('AST with nothing to credit shows a warning and changes nothing', () => {
    const { h } = ids();
    performStat('ast', h[1]!);
    expect(gameStore.getState().game.events).toHaveLength(0);
    expect(useUi.getState().toast).toMatchObject({ kind: 'warn' });
  });

  test('toast clears itself', () => {
    const { h } = ids();
    performStat('stl', h[0]!);
    expect(useUi.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(3000);
    expect(useUi.getState().toast).toBeNull();
  });

  describe('fouls', () => {
    const toast = () => useUi.getState().toast;

    test('personal foul is recorded, counted and announced as n/5', () => {
      const { h } = ids();
      performStat('foul', h[0]!);
      performStat('foul', h[0]!);
      expect(stat(h[0]!)).toMatchObject({ pf: 2, tf: 0 });
      expect(toast()).toMatchObject({ kind: 'ok' });
      expect(toast()?.text).toContain('(2/5)');
    });

    test('the 5th foul fouls the player out; a 6th press is refused with a warning and records nothing', () => {
      const { h } = ids();
      for (let i = 0; i < 5; i++) performStat('foul', h[0]!);
      expect(toast()?.text).toContain('FOULED OUT');
      expect(toast()?.kind).toBe('warn');
      const n = gameStore.getState().game.events.length;
      performStat('foul', h[0]!);
      performStat('tech', h[0]!);
      expect(gameStore.getState().game.events).toHaveLength(n);
      expect(toast()).toMatchObject({ kind: 'warn' });
      expect(toast()?.text).toContain('Fouled out');
    });

    test('two technicals eject; technicals count toward the 5', () => {
      const { h } = ids();
      performStat('foul', h[1]!);
      performStat('tech', h[1]!);
      expect(toast()?.text).not.toContain('EJECTED');
      performStat('tech', h[1]!);
      expect(toast()?.text).toContain('EJECTED');
      expect(stat(h[1]!)).toMatchObject({ pf: 1, tf: 2 });
      performStat('tech', h[1]!); // refused
      performStat('foul', h[1]!); // refused too: he is out of the game
      expect(stat(h[1]!)).toMatchObject({ pf: 1, tf: 2 });
      expect(toast()?.text).toContain('Ejected');
    });

    test('team fouls: the 5th foul of a quarter announces the bonus; the next quarter starts clean', () => {
      const { h } = ids();
      const g = () => gameStore.getState().game;
      for (let i = 0; i < 4; i++) performStat('foul', h[i]!);
      expect(toast()?.text).not.toContain('BONUS');
      expect(teamFoulStatus(g(), g().teams[0], 1).opponentInBonus).toBe(false);
      performStat('foul', h[4]!);
      expect(toast()?.text).toContain('opponent IN BONUS');
      expect(teamFoulStatus(g(), g().teams[0], 1)).toMatchObject({ periodFouls: 5, opponentInBonus: true });

      gameStore.getState().nextPeriod();
      expect(teamFoulStatus(g(), g().teams[0], 2)).toMatchObject({ periodFouls: 0, opponentInBonus: false });
      performStat('foul', h[0]!);
      expect(teamFoulStatus(g(), g().teams[0], 2).periodFouls).toBe(1);
    });

    test('undoing a foul gives the foul back', () => {
      const { h } = ids();
      for (let i = 0; i < 5; i++) performStat('foul', h[0]!);
      gameStore.getState().undo();
      expect(stat(h[0]!)?.pf).toBe(4);
      performStat('foul', h[0]!); // allowed again
      expect(stat(h[0]!)?.pf).toBe(5);
    });
  });
});

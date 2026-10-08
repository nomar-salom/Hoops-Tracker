import { describe, expect, test } from 'vitest';
import { GAME_ENDED_MESSAGE, createGameStore, isGameEnded, periodsInGame, selectStatFilter } from './store';
import { createNextGame } from './factory';
import { computeStats } from './stats';
import { exportGameToXlsx, importGameFromXlsx } from './xlsx';
import { playerShooting, visibleShots } from './eventLog';
import { validateGame } from './validate';
import { generateGame, sampleGame } from './fixtures';
import type { Game } from './types';

const fresh = () => createGameStore({
  initialGame: { ...sampleGame(), events: [], currentPeriod: 1 } as Game,
  now: () => Date.parse('2026-11-05T21:30:00Z'),
});
// home h1 h2 h3 / away a1 a2

describe('viewing any period', () => {
  test('a past period can be viewed while recording in a later one', () => {
    const s = fresh();
    s.getState().addSteal('h1');            // Q1
    s.getState().setPeriod(2); s.getState().addSteal('h2');
    s.getState().setPeriod(3); s.getState().addSteal('a1');
    s.getState().setViewPeriod(1);
    expect(s.getState().viewPeriod).toBe(1);
    expect(computeStats(s.getState().game, selectStatFilter(s.getState())).get('h1')?.stl).toBe(1);
    expect(computeStats(s.getState().game, selectStatFilter(s.getState())).get('a1')).toBeUndefined();
    s.getState().setViewPeriod(2);
    expect(s.getState().game.currentPeriod).toBe(3); // untouched
  });

  test('a period that does not exist falls back to the whole game', () => {
    const s = fresh();
    s.getState().setViewPeriod(4);
    expect(s.getState().viewPeriod).toBe('game');
    s.getState().setViewPeriod(0);
    expect(s.getState().viewPeriod).toBe('game');
  });

  test('periodsInGame covers every period with events even if the current period is lower', () => {
    const g = { ...sampleGame(), currentPeriod: 1 }; // has events in Q5
    expect(periodsInGame(g)).toEqual([1, 2, 3, 4, 5]);
    expect(periodsInGame({ ...sampleGame(), events: [], currentPeriod: 2 })).toEqual([1, 2]);
  });

  test('a new event keeps the view; a new game and a loaded game reset it', () => {
    const s = fresh();
    s.getState().setPeriod(2); s.getState().setViewPeriod(2);
    s.getState().addSteal('h1');
    expect(s.getState().viewPeriod).toBe(2);
    s.getState().startNewGame({ keepRoster: [true, true] });
    expect(s.getState().viewPeriod).toBe('game');
    s.getState().setPeriod(2); s.getState().setViewPeriod(2);
    expect(s.getState().loadGame(sampleGame())).toEqual([]);
    expect(s.getState().viewPeriod).toBe('game');
  });
});

describe('ending and reopening a game', () => {
  test('endGame stamps the time, clears the selection and shows the whole game', () => {
    const s = fresh();
    s.getState().addSteal('h1');
    s.getState().selectPlayer('h1');
    s.getState().setViewPeriod(1);
    s.getState().endGame();
    expect(s.getState().game.endedAt).toBe('2026-11-05T21:30:00.000Z');
    expect(isGameEnded(s.getState().game)).toBe(true);
    expect(s.getState().selectedPlayerId).toBeNull();
    expect(s.getState().viewPeriod).toBe('game');
  });

  test('every way of recording something is refused after the game ends', () => {
    const s = fresh();
    s.getState().endGame();
    const st = s.getState();
    const attempts = [
      () => st.addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5 }),
      () => st.addFreeThrow('h1', true),
      () => st.addRebound('h1', 'defensive'),
      () => st.addSteal('h1'),
      () => st.addTurnover('h1'),
      () => st.addFoul('h1', 'personal'),
      () => st.creditAssist('h1'),
      () => st.creditBlock('a1'),
      () => st.setPeriod(2),
      () => st.nextPeriod(),
    ];
    for (const f of attempts) expect(f).toThrow(GAME_ENDED_MESSAGE);
    expect(s.getState().game.events).toHaveLength(0);
    expect(s.getState().game.currentPeriod).toBe(1);
  });

  test('corrections are still allowed after the game ends (event log edits, roster fixes)', () => {
    const s = fresh();
    const e = s.getState().addSteal('h1');
    const shot = s.getState().addShot({ playerId: 'h2', points: 2, made: true, x: 0.9, y: 0.5 });
    s.getState().endGame();
    expect(s.getState().updateEvent(e.id, { playerId: 'h3' })).toBeNull();
    s.getState().deleteEvent(shot.id);
    s.getState().updatePlayer('h1', { name: 'Alexander' });
    expect(s.getState().game.events).toHaveLength(1);
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'h3' });
    s.getState().undo(); // undo of an edit is allowed too
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'h3' });
  });

  test('reopenGame removes the stamp and recording works again; ending twice is a no-op', () => {
    const s = fresh();
    s.getState().endGame();
    const stamp = s.getState().game.endedAt;
    s.getState().endGame();
    expect(s.getState().game.endedAt).toBe(stamp);
    s.getState().reopenGame();
    expect(s.getState().game).not.toHaveProperty('endedAt');
    expect(() => s.getState().addSteal('h1')).not.toThrow();
    s.getState().reopenGame(); // no-op on a live game
    expect(s.getState().game.events).toHaveLength(1);
  });

  test('undo/redo history is not wiped by ending, and a reopened game can keep undoing', () => {
    const s = fresh();
    s.getState().addSteal('h1');
    s.getState().endGame();
    s.getState().reopenGame();
    s.getState().undo();
    expect(s.getState().game.events).toHaveLength(0);
  });

  test('a new game made from an ended one is live', () => {
    const g = { ...generateGame(2, 30), endedAt: '2026-11-05T21:30:00.000Z' };
    expect(createNextGame(g, { keepRoster: [true, true] })).not.toHaveProperty('endedAt');
  });
});

describe('persistence', () => {
  test('endedAt survives an XLSX export and import; a live game stays live', async () => {
    const ended = { ...generateGame(3, 60), endedAt: '2026-11-05T21:30:00.000Z' };
    const res = await importGameFromXlsx(await exportGameToXlsx(ended));
    expect(res.errors).toEqual([]);
    expect(res.game).toEqual(ended);

    const live = generateGame(3, 60);
    const res2 = await importGameFromXlsx(await exportGameToXlsx(live));
    expect(res2.game).toEqual(live);
    expect(res2.game).not.toHaveProperty('endedAt');
  });

  test('a file from before this feature (no endedAt row) imports as a live game', async () => {
    const g = sampleGame();
    const res = await importGameFromXlsx(await exportGameToXlsx(g));
    expect(res.game).not.toHaveProperty('endedAt');
  });

  test('validateGame rejects a garbage endedAt', () => {
    expect(validateGame({ ...sampleGame(), endedAt: 'yesterday-ish' })).toEqual([expect.stringMatching(/endedAt is not a valid date/)]);
    expect(validateGame({ ...sampleGame(), endedAt: '2026-11-05T21:30:00.000Z' })).toEqual([]);
  });
});

describe('visibleShots', () => {
  // sampleGame shots: #0 h1 3PT made Q1 | #1 h2 2PT miss Q1 | #3 a1 2PT made Q1 | #9 a2 3PT made Q5
  const g = sampleGame();
  const ids = (v: Parameters<typeof visibleShots>[1]) => visibleShots(g, v).map((e) => e.id);
  const all = { period: 'game' as const, teams: [true, true] as [boolean, boolean], playerId: null };

  test('everything by default, in chronological order', () => {
    expect(visibleShots(g, all).map((e) => e.type)).toEqual(['shot', 'shot', 'shot', 'shot']);
    expect(ids(all)).toHaveLength(4);
  });
  test('one period', () => {
    expect(ids({ ...all, period: 1 })).toHaveLength(3);
    expect(ids({ ...all, period: 5 })).toHaveLength(1);
    expect(ids({ ...all, period: 3 })).toHaveLength(0);
  });
  test('team switches', () => {
    expect(visibleShots(g, { ...all, teams: [true, false] }).every((e) => e.teamId === 'home')).toBe(true);
    expect(ids({ ...all, teams: [false, false] })).toHaveLength(0);
  });
  test('one player, alone and combined with the other filters', () => {
    expect(visibleShots(g, { ...all, playerId: 'a1' }).map((e) => e.playerId)).toEqual(['a1']);
    expect(ids({ ...all, playerId: 'a2', period: 1 })).toHaveLength(0);       // a2 only shot in Q5
    expect(ids({ ...all, playerId: 'a2', period: 5 })).toHaveLength(1);
    expect(ids({ ...all, playerId: 'h1', teams: [false, true] })).toHaveLength(0); // his team is hidden
  });
  test('only shots: never free throws or other events', () => {
    expect(visibleShots(generateGame(1, 200), all).every((e) => e.type === 'shot')).toBe(true);
  });
});

describe('playerShooting', () => {
  const g = sampleGame();
  test('points and makes/attempts for a player', () => {
    expect(playerShooting(g, 'h1')).toMatchObject({ pts: 3, fgm: 1, fga: 1, fg3m: 1, fg3a: 1, fg2a: 0 });
    expect(playerShooting(g, 'h3')).toMatchObject({ pts: 1, fgm: 0, fga: 0, ftm: 1, fta: 2 });
  });
  test('one period only', () => {
    expect(playerShooting(g, 'a2', 5)).toMatchObject({ pts: 3, fg3m: 1 });
    expect(playerShooting(g, 'a2', 1)).toMatchObject({ pts: 0, fga: 0 });
  });
  test('a player with no events is all zeros', () => {
    expect(playerShooting(g, 'ghost')).toMatchObject({ pts: 0, fga: 0, fta: 0 });
  });
  test('per-player lines add up to the team total over a large game', () => {
    const big = generateGame(8, 300);
    const total = big.teams[0].players.reduce((n, p) => n + playerShooting(big, p.id).fga, 0);
    const shots = visibleShots(big, { period: 'game', teams: [true, false], playerId: null }).length;
    expect(total).toBe(shots);
  });
});

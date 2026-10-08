import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { attachAutosave, contextPrompt, createGameStore, describeEvent, previewShot, pendingRebound, suggestReboundKind, selectStatFilter, type GameStore } from './store';
import { computeStats, lineScore } from './stats';
import { validateGame } from './validate';
import { sampleGame } from './fixtures';
import type { Game } from './types';

let idCounter = 0;
const mk = (initialGame?: Game): GameStore =>
  createGameStore({ initialGame, newId: () => `id${++idCounter}`, now: () => 1000 + idCounter });

/** Empty rosters game: home h1,h2 / away a1,a2 */
const rosterGame = (): Game => {
  const g = sampleGame();
  return { ...g, events: [], currentPeriod: 1 };
};

describe('stat entry', () => {
  test('stamps team, period, id, ts and derives stats', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 3, made: true, x: 0.8, y: 0.2, assistedBy: 'h2' });
    const e = s.getState().game.events[0]!;
    expect(e).toMatchObject({ type: 'shot', teamId: 'home', period: 1, points: 3, made: true });
    const stats = computeStats(s.getState().game);
    expect(stats.get('h1')?.pts).toBe(3);
    expect(stats.get('h2')?.ast).toBe(1);
  });

  test('new events use the current period', () => {
    const s = mk(rosterGame());
    s.getState().setPeriod(3);
    s.getState().addSteal('a1');
    expect(s.getState().game.events[0]!.period).toBe(3);
  });

  test('rejects invalid assists/blocks and unknown players', () => {
    const s = mk(rosterGame());
    const { addShot } = s.getState();
    expect(() => addShot({ playerId: 'h1', points: 2, made: false, x: 0.5, y: 0.5, assistedBy: 'h2' })).toThrow();
    expect(() => addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'h1' })).toThrow();
    expect(() => addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'a1' })).toThrow();
    expect(() => addShot({ playerId: 'h1', points: 2, made: false, x: 0.5, y: 0.5, blockedBy: 'h2' })).toThrow();
    expect(() => s.getState().addSteal('nobody')).toThrow();
    expect(s.getState().game.events).toHaveLength(0);
  });

  test('clamps coordinates to 0..1', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 1.4, y: -0.2 });
    expect(s.getState().game.events[0]).toMatchObject({ x: 1, y: 0 });
  });

  test('produces a game that passes validation', () => {
    const s = mk(rosterGame());
    const st = s.getState();
    st.addShot({ playerId: 'h1', points: 2, made: false, x: 0.7, y: 0.5, blockedBy: 'a1' });
    st.addRebound('a2', 'defensive');
    st.addFreeThrow('h2', true);
    st.addTurnover('a1');
    expect(validateGame(s.getState().game)).toEqual([]);
  });
});

describe('undo / redo', () => {
  test('undo pops last event, redo restores it', () => {
    const s = mk(rosterGame());
    s.getState().addSteal('h1');
    s.getState().addTurnover('a1');
    s.getState().undo();
    expect(s.getState().game.events).toHaveLength(1);
    expect(s.getState().redoStack).toHaveLength(1);
    s.getState().redo();
    expect(s.getState().game.events.map((e) => e.type)).toEqual(['steal', 'turnover']);
    expect(s.getState().redoStack).toHaveLength(0);
  });

  test('new event clears redo stack', () => {
    const s = mk(rosterGame());
    s.getState().addSteal('h1');
    s.getState().undo();
    s.getState().addTurnover('a1');
    expect(s.getState().redoStack).toHaveLength(0);
  });

  test('undo/redo on empty stacks are no-ops', () => {
    const s = mk(rosterGame());
    s.getState().undo();
    s.getState().redo();
    expect(s.getState().game.events).toHaveLength(0);
  });
});

describe('editing events', () => {
  test('delete removes the event and its stats', () => {
    const s = mk(rosterGame());
    const e = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5 });
    s.getState().deleteEvent(e.id);
    expect(computeStats(s.getState().game).get('h1')).toBeUndefined();
  });

  test('flipping a made shot to missed drops the assist', () => {
    const s = mk(rosterGame());
    const e = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'h2' });
    s.getState().updateEvent(e.id, { made: false });
    const stats = computeStats(s.getState().game);
    expect(stats.get('h1')).toMatchObject({ pts: 0, fg2a: 1, fg2m: 0 });
    expect(stats.get('h2')?.ast ?? 0).toBe(0);
    expect(validateGame(s.getState().game)).toEqual([]);
  });

  test('changing player moves the event to that team', () => {
    const s = mk(rosterGame());
    const e = s.getState().addSteal('h1');
    s.getState().updateEvent(e.id, { playerId: 'a1' });
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'a1', teamId: 'away' });
  });

  test('ignores fields that do not apply to the event type', () => {
    const s = mk(rosterGame());
    const e = s.getState().addSteal('h1');
    s.getState().updateEvent(e.id, { points: 3, made: true });
    expect(s.getState().game.events[0]).not.toHaveProperty('points');
  });
});

describe('periods', () => {
  test('next/prev period and overtime', () => {
    const s = mk(rosterGame());
    for (let i = 0; i < 4; i++) s.getState().nextPeriod();
    expect(s.getState().game.currentPeriod).toBe(5);
    s.getState().prevPeriod();
    expect(s.getState().game.currentPeriod).toBe(4);
  });

  test('cannot go below period 1 or below the latest period with events', () => {
    const s = mk(rosterGame());
    s.getState().prevPeriod();
    expect(s.getState().game.currentPeriod).toBe(1);
    s.getState().setPeriod(3);
    s.getState().addSteal('h1');
    s.getState().setPeriod(1);
    expect(s.getState().game.currentPeriod).toBe(3);
    expect(lineScore(s.getState().game).byPeriod[3]).toBeDefined();
  });

  test('the stat filter follows the VIEWED period, which can differ from the current one', () => {
    const s = mk(rosterGame());
    s.getState().setPeriod(3);
    s.getState().addSteal('h1');
    s.getState().setViewPeriod(1);
    expect(selectStatFilter(s.getState())).toEqual({ periods: [1] });
    expect(s.getState().game.currentPeriod).toBe(3); // viewing Q1 does not move where new stats go
    s.getState().setViewPeriod('game');
    expect(selectStatFilter(s.getState())).toEqual({});
  });
});

describe('roster', () => {
  test('add, update, remove players', () => {
    const s = mk(rosterGame());
    const id = s.getState().addPlayer('home', { number: '7', name: 'Zed' });
    expect(s.getState().game.teams[0].players.some((p) => p.id === id)).toBe(true);
    s.getState().updatePlayer(id, { name: 'Zeke' });
    expect(s.getState().game.teams[0].players.find((p) => p.id === id)?.name).toBe('Zeke');
    expect(s.getState().removePlayer(id)).toBe(true);
  });

  test('cannot remove a player who has events (incl. assists/blocks)', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'h2' });
    expect(s.getState().removePlayer('h1')).toBe(false);
    expect(s.getState().removePlayer('h2')).toBe(false);
    expect(s.getState().removePlayer('h3')).toBe(true);
  });

  test('removing the selected player clears selection', () => {
    const s = mk(rosterGame());
    s.getState().selectPlayer('h3');
    s.getState().removePlayer('h3');
    expect(s.getState().selectedPlayerId).toBeNull();
  });
});

describe('lifecycle & helpers', () => {
  test('loadGame rejects invalid games and keeps the current one', () => {
    const s = mk(rosterGame());
    const bad = sampleGame();
    bad.events.push({ id: 'x', teamId: 'home', playerId: 'ghost', period: 1, ts: 1, type: 'steal' });
    expect(s.getState().loadGame(bad).length).toBeGreaterThan(0);
    expect(s.getState().game.events).toHaveLength(0);
    expect(s.getState().loadGame(sampleGame())).toEqual([]);
    expect(s.getState().game.events.length).toBeGreaterThan(0);
  });

  test('pendingRebound and suggestReboundKind', () => {
    const s = mk(rosterGame());
    expect(pendingRebound(s.getState().game)).toBeNull();
    s.getState().addShot({ playerId: 'h1', points: 2, made: false, x: 0.5, y: 0.5 });
    expect(pendingRebound(s.getState().game)?.type).toBe('shot');
    expect(suggestReboundKind(s.getState().game, 'h1', 'h2')).toBe('offensive');
    expect(suggestReboundKind(s.getState().game, 'h1', 'a1')).toBe('defensive');
    s.getState().addRebound('a1', 'defensive');
    expect(pendingRebound(s.getState().game)).toBeNull();
  });
});

describe('autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('debounces game changes and ignores UI-only changes', () => {
    const s = mk(rosterGame());
    const save = vi.fn();
    attachAutosave(s, save, 500);
    s.getState().selectPlayer('h1'); // UI only
    vi.advanceTimersByTime(1000);
    expect(save).not.toHaveBeenCalled();

    s.getState().addSteal('h1');
    s.getState().addSteal('h1');
    s.getState().addSteal('h1');
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].events).toHaveLength(3);
  });

  test('flush saves immediately, stop detaches', () => {
    const s = mk(rosterGame());
    const save = vi.fn();
    const auto = attachAutosave(s, save, 500);
    s.getState().addSteal('h1');
    auto.flush();
    expect(save).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1); // no double save

    auto.stop();
    s.getState().addSteal('h1');
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('auto 3-point detection', () => {
  test('points omitted -> derived from click, using team direction and period', () => {
    const s = mk(rosterGame());
    // Home attacks right in Q1: layup near right basket = 2, deep from the right = 3
    s.getState().addShot({ playerId: 'h1', made: true, x: 0.94, y: 0.5 });
    s.getState().addShot({ playerId: 'h1', made: false, x: 0.66, y: 0.5 });
    expect(s.getState().game.events.map((e) => e.type === 'shot' && e.points)).toEqual([2, 3]);
  });

  test('direction flips at halftime; away team attacks the opposite way', () => {
    const s = mk(rosterGame());
    // x = 0.10 is right under the LEFT basket.
    s.getState().addShot({ playerId: 'h1', made: true, x: 0.1, y: 0.5 }); // Q1: home attacks right -> far -> 3
    s.getState().addShot({ playerId: 'a1', made: true, x: 0.1, y: 0.5 }); // Q1: away attacks left  -> close -> 2
    s.getState().setPeriod(3);
    s.getState().addShot({ playerId: 'h1', made: true, x: 0.1, y: 0.5 }); // Q3: home attacks left -> 2
    expect(s.getState().game.events.map((e) => e.type === 'shot' && e.points)).toEqual([3, 2, 2]);
  });

  test('explicit points override the auto value', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 3, made: true, x: 0.94, y: 0.5 });
    expect(s.getState().game.events[0]).toMatchObject({ points: 3 });
  });

  test('previewShot reports nearLine without recording anything', () => {
    const s = mk(rosterGame());
    const p = previewShot(s.getState().game, 'h1', (88.75 - 23.4) / 94, 0.5);
    expect(p).toMatchObject({ points: 2, nearLine: true });
    expect(s.getState().game.events).toHaveLength(0);
  });

  test('court type changes the line', () => {
    const s = mk(rosterGame());
    const x = (94 - 5.25 - 23) / 94; // 23 ft out: inside NBA arc, beyond NCAA arc
    expect(previewShot(s.getState().game, 'h1', x, 0.5).points).toBe(2);
    s.getState().setCourtType('ncaa');
    expect(previewShot(s.getState().game, 'h1', x, 0.5).points).toBe(3);
  });
});

describe('creditAssist / creditBlock', () => {
  const shot = (s: GameStore, playerId: string, made: boolean) =>
    s.getState().addShot({ playerId, points: 2, made, x: 0.9, y: 0.5 });

  test('assist attaches to the most recent unassisted made shot by a teammate', () => {
    const s = mk(rosterGame());
    shot(s, 'h1', true);
    const credited = s.getState().creditAssist('h2');
    expect(credited).toMatchObject({ playerId: 'h1', assistedBy: 'h2' });
    expect(computeStats(s.getState().game).get('h2')?.ast).toBe(1);
    expect(validateGame(s.getState().game)).toEqual([]);
  });

  test('assist is refused for self, opponents, missed shots, already-assisted shots and other periods', () => {
    const s = mk(rosterGame());
    shot(s, 'h1', true);
    expect(s.getState().creditAssist('h1')).toBeNull(); // own shot
    expect(s.getState().creditAssist('a1')).toBeNull(); // opponent
    expect(s.getState().creditAssist('h2')).not.toBeNull();
    expect(s.getState().creditAssist('h3')).toBeNull(); // already assisted
    shot(s, 'h1', false);
    expect(s.getState().creditAssist('h2')).toBeNull(); // only a miss is pending
    shot(s, 'h1', true);
    s.getState().setPeriod(2);
    expect(s.getState().creditAssist('h2')).toBeNull(); // shot was in period 1
  });

  test('assists go to the latest shot first, then earlier unassisted ones', () => {
    const s = mk(rosterGame());
    shot(s, 'h1', true);
    shot(s, 'h3', true);
    expect(s.getState().creditAssist('h2')).toMatchObject({ playerId: 'h3' });
    expect(s.getState().creditAssist('h2')).toMatchObject({ playerId: 'h1' });
  });

  test('block attaches to an opponent\'s missed shot only', () => {
    const s = mk(rosterGame());
    shot(s, 'h1', false);
    expect(s.getState().creditBlock('h2')).toBeNull(); // teammate
    expect(s.getState().creditBlock('a1')).toMatchObject({ playerId: 'h1', blockedBy: 'a1' });
    expect(computeStats(s.getState().game).get('a1')?.blk).toBe(1);
    expect(s.getState().creditBlock('a2')).toBeNull(); // already blocked
    shot(s, 'h1', true);
    expect(s.getState().creditBlock('a1')).toBeNull(); // made shots can't be blocked
    expect(validateGame(s.getState().game)).toEqual([]);
  });

  test('undo removes only the assist, then the shot; redo restores in order', () => {
    const s = mk(rosterGame());
    shot(s, 'h1', true);
    s.getState().creditAssist('h2');
    s.getState().addSteal('a1');

    s.getState().undo(); // the steal
    expect(s.getState().game.events.map((e) => e.type)).toEqual(['shot']);
    s.getState().undo(); // the assist, not the shot
    expect(s.getState().game.events).toHaveLength(1);
    expect(s.getState().game.events[0]).not.toHaveProperty('assistedBy');
    s.getState().undo(); // the shot
    expect(s.getState().game.events).toHaveLength(0);

    s.getState().redo();
    s.getState().redo();
    expect(s.getState().game.events[0]).toMatchObject({ assistedBy: 'h2' });
    s.getState().redo();
    expect(s.getState().game.events.map((e) => e.type)).toEqual(['shot', 'steal']);
  });

  test('a new action clears redo', () => {
    const s = mk(rosterGame());
    s.getState().addSteal('h1');
    s.getState().undo();
    expect(s.getState().redoStack).toHaveLength(1);
    s.getState().addSteal('h3');
    expect(s.getState().redoStack).toHaveLength(0);
  });

  test('undo still works on a game restored from disk (no tracked history)', () => {
    const s = mk(sampleGame());
    const n = s.getState().game.events.length;
    s.getState().undo();
    expect(s.getState().game.events).toHaveLength(n - 1);
    s.getState().redo();
    expect(s.getState().game.events).toHaveLength(n);
  });
});

describe('contextPrompt / describeEvent', () => {
  test('made unassisted shot asks for an assist; assisting clears it', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 3, made: true, x: 0.7, y: 0.5 });
    expect(contextPrompt(s.getState().game)).toMatchObject({ needsAssist: true, canBlock: false, needsRebound: false });
    s.getState().creditAssist('h2');
    expect(contextPrompt(s.getState().game)).toMatchObject({ needsAssist: false });
  });

  test('missed shot asks for a rebound and allows a block; missed FT only a rebound', () => {
    const s = mk(rosterGame());
    s.getState().addShot({ playerId: 'h1', points: 2, made: false, x: 0.9, y: 0.5 });
    expect(contextPrompt(s.getState().game)).toMatchObject({ needsRebound: true, canBlock: true, needsAssist: false });
    s.getState().creditBlock('a1');
    expect(contextPrompt(s.getState().game)).toMatchObject({ needsRebound: true, canBlock: false });
    s.getState().addFreeThrow('h1', false);
    expect(contextPrompt(s.getState().game)).toMatchObject({ needsRebound: true, canBlock: false });
    s.getState().addFreeThrow('h1', true);
    expect(contextPrompt(s.getState().game)).toBeNull();
  });

  test('no prompt for an empty game or after non-shot events', () => {
    const s = mk(rosterGame());
    expect(contextPrompt(s.getState().game)).toBeNull();
    s.getState().addSteal('a1');
    expect(contextPrompt(s.getState().game)).toBeNull();
  });

  test('describeEvent', () => {
    const s = mk(rosterGame());
    const e = s.getState().addShot({ playerId: 'h1', points: 3, made: true, x: 0.7, y: 0.5 });
    expect(describeEvent(s.getState().game, e)).toBe('#1 Alex: 3PT made');
    expect(describeEvent(s.getState().game, s.getState().addRebound('a1', 'offensive'))).toContain('offensive rebound');
  });
});

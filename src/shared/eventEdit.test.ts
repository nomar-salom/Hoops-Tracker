import { describe, expect, test } from 'vitest';
import { createGameStore } from './store';
import { computeStats, MAX_FOULS } from './stats';
import { validateGame } from './validate';
import { sampleGame } from './fixtures';
import type { Game } from './types';

const fresh = () => createGameStore({ initialGame: { ...sampleGame(), events: [], currentPeriod: 3 } as Game });
// home: h1 h2 h3   away: a1 a2
const stat = (s: ReturnType<typeof fresh>, id: string) => computeStats(s.getState().game).get(id);

describe('deleteEvent is undoable', () => {
  test('undo puts the event back in the SAME position; redo deletes it again', () => {
    const s = fresh();
    const e1 = s.getState().addSteal('h1');
    const e2 = s.getState().addTurnover('a1');
    const e3 = s.getState().addSteal('h2');
    s.getState().deleteEvent(e2.id);
    expect(s.getState().game.events.map((e) => e.id)).toEqual([e1.id, e3.id]);

    s.getState().undo();
    expect(s.getState().game.events.map((e) => e.id)).toEqual([e1.id, e2.id, e3.id]);
    s.getState().redo();
    expect(s.getState().game.events.map((e) => e.id)).toEqual([e1.id, e3.id]);
  });

  test('deleting a made shot takes its assist with it, and undo brings both back', () => {
    const s = fresh();
    const shot = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5, assistedBy: 'h2' });
    s.getState().deleteEvent(shot.id);
    expect(stat(s, 'h2')?.ast ?? 0).toBe(0);
    s.getState().undo();
    expect(stat(s, 'h2')?.ast).toBe(1);
    expect(stat(s, 'h1')?.pts).toBe(2);
  });

  test('deleting an unknown id does nothing and records no history', () => {
    const s = fresh();
    s.getState().deleteEvent('nope');
    expect(s.getState().undoStack).toHaveLength(0);
  });

  test('delete, then other actions, then undo walks back in order', () => {
    const s = fresh();
    const a = s.getState().addSteal('h1');
    s.getState().deleteEvent(a.id);
    s.getState().addTurnover('a1');
    s.getState().undo(); // the turnover
    s.getState().undo(); // the delete
    expect(s.getState().game.events.map((e) => e.type)).toEqual(['steal']);
    s.getState().undo(); // the original add
    expect(s.getState().game.events).toEqual([]);
  });
});

describe('updateEvent is undoable and returns null on success', () => {
  test('reassign to another player and undo it', () => {
    const s = fresh();
    const e = s.getState().addSteal('h1');
    expect(s.getState().updateEvent(e.id, { playerId: 'h2' })).toBeNull();
    expect(stat(s, 'h2')?.stl).toBe(1);
    expect(stat(s, 'h1')?.stl ?? 0).toBe(0);
    s.getState().undo();
    expect(stat(s, 'h1')?.stl).toBe(1);
    s.getState().redo();
    expect(stat(s, 'h2')?.stl).toBe(1);
  });

  test('moving an event to the other team updates its teamId', () => {
    const s = fresh();
    const e = s.getState().addSteal('h1');
    s.getState().updateEvent(e.id, { playerId: 'a1' });
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'a1', teamId: 'away' });
  });

  test('a no-op edit adds no history', () => {
    const s = fresh();
    const e = s.getState().addSteal('h1');
    const n = s.getState().undoStack.length;
    expect(s.getState().updateEvent(e.id, { playerId: 'h1' })).toBeNull();
    expect(s.getState().undoStack).toHaveLength(n);
  });

  test('flipping made/missed drops the now-invalid assist, and undo restores it', () => {
    const s = fresh();
    const e = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5, assistedBy: 'h2' });
    s.getState().updateEvent(e.id, { made: false });
    expect(s.getState().game.events[0]).not.toHaveProperty('assistedBy');
    s.getState().undo();
    expect(s.getState().game.events[0]).toMatchObject({ made: true, assistedBy: 'h2' });
  });

  test('clearing an assist with undefined removes the key entirely', () => {
    const s = fresh();
    const e = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5, assistedBy: 'h2' });
    expect(s.getState().updateEvent(e.id, { assistedBy: undefined })).toBeNull();
    expect(s.getState().game.events[0]).not.toHaveProperty('assistedBy');
    expect(Object.keys(s.getState().game.events[0]!)).not.toContain('assistedBy');
  });

  test('changing the points of a shot re-scores it', () => {
    const s = fresh();
    const e = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5 });
    s.getState().updateEvent(e.id, { points: 3 });
    expect(stat(s, 'h1')).toMatchObject({ pts: 3, fg3m: 1, fg2m: 0 });
  });

  test('editing an unknown id is refused', () => {
    expect(fresh().getState().updateEvent('nope', { made: true })).toMatch(/no longer exists/);
  });

  test('edit then delete then undo twice restores the edited event, then the original', () => {
    const s = fresh();
    const e = s.getState().addSteal('h1');
    s.getState().updateEvent(e.id, { playerId: 'h2' });
    s.getState().deleteEvent(e.id);
    s.getState().undo();
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'h2' });
    s.getState().undo();
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'h1' });
  });
});

describe('updateEvent refuses edits that would make the game impossible', () => {
  test('moving a foul to a player who already has 5 (technicals count)', () => {
    const s = fresh();
    for (let i = 0; i < MAX_FOULS; i++) s.getState().addFoul('h1', 'personal');
    const other = s.getState().addFoul('h2', 'personal')!;
    const before = JSON.stringify(s.getState().game);
    const err = s.getState().updateEvent(other.id, { playerId: 'h1' });
    expect(err).toMatch(/#1 Alex would have 6 fouls/);
    expect(JSON.stringify(s.getState().game)).toBe(before);
    expect(s.getState().undoStack.at(-1)).toMatchObject({ kind: 'add' }); // no history entry for the refused edit
  });

  test('a third technical', () => {
    const s = fresh();
    s.getState().addFoul('h1', 'technical');
    s.getState().addFoul('h1', 'technical');
    const p = s.getState().addFoul('h2', 'personal')!;
    expect(s.getState().updateEvent(p.id, { playerId: 'h1', kind: 'technical' })).toMatch(/technical/);
  });

  test('an assist from an opponent, from the shooter himself, or a block from a teammate', () => {
    const s = fresh();
    const made = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5 });
    expect(s.getState().updateEvent(made.id, { assistedBy: 'a1' })).toMatch(/teammate/);
    expect(s.getState().updateEvent(made.id, { assistedBy: 'h1' })).toMatch(/own shot/);
    expect(s.getState().updateEvent(made.id, { assistedBy: 'h2' })).toBeNull();

    const miss = s.getState().addShot({ playerId: 'h1', points: 2, made: false, x: 0.9, y: 0.5 });
    expect(s.getState().updateEvent(miss.id, { blockedBy: 'h2' })).toMatch(/opponent/);
    expect(s.getState().updateEvent(miss.id, { blockedBy: 'a1' })).toBeNull();
  });

  test('reassigning a shot to an opponent of its assister is refused', () => {
    const s = fresh();
    const made = s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5, assistedBy: 'h2' });
    expect(s.getState().updateEvent(made.id, { playerId: 'a1' })).toMatch(/teammate/);
    expect(s.getState().game.events[0]).toMatchObject({ playerId: 'h1' });
  });

  test('a successful edit always leaves a valid game', () => {
    const s = fresh();
    const e = s.getState().addShot({ playerId: 'h1', points: 3, made: false, x: 0.7, y: 0.5, blockedBy: 'a1' });
    s.getState().updateEvent(e.id, { made: true });
    s.getState().updateEvent(e.id, { assistedBy: 'h3', period: 2, playerId: 'h2' });
    expect(validateGame(s.getState().game)).toEqual([]);
  });

  test('period edits are clamped into the game', () => {
    const s = fresh(); // currentPeriod 3
    const e = s.getState().addSteal('h1');
    s.getState().updateEvent(e.id, { period: 9 });
    expect(s.getState().game.events[0]!.period).toBe(3);
    s.getState().updateEvent(e.id, { period: 0 });
    expect(s.getState().game.events[0]!.period).toBe(1);
  });
});

describe('validateGame team rules (imports)', () => {
  test('rejects assists from opponents / self and blocks from teammates', () => {
    const g = { ...sampleGame(), events: [
      { id: 'a', teamId: 'home', playerId: 'h1', period: 1, ts: 1, type: 'shot', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'a1' },
      { id: 'b', teamId: 'home', playerId: 'h1', period: 1, ts: 2, type: 'shot', points: 2, made: true, x: 0.5, y: 0.5, assistedBy: 'h1' },
      { id: 'c', teamId: 'home', playerId: 'h1', period: 1, ts: 3, type: 'shot', points: 2, made: false, x: 0.5, y: 0.5, blockedBy: 'h2' },
    ] } as Game;
    const errs = validateGame(g).join('\n');
    expect(errs).toMatch(/Event a: the assist must come from a teammate/);
    expect(errs).toMatch(/Event b: a player can't assist his own shot/);
    expect(errs).toMatch(/Event c: the block must come from an opponent/);
  });
});

import { describe, expect, test } from 'vitest';
import { createNextGame } from './factory';
import { createGameStore, attachAutosave } from './store';
import { archiveFileName, fromDateTimeLocalValue, gameFileName, localDateStamp, toDateTimeLocalValue } from './dates';
import { validateGame } from './validate';
import { computeStats } from './stats';
import { generateGame, sampleGame } from './fixtures';
import { vi } from 'vitest';

describe('createNextGame', () => {
  const prev = generateGame(3, 120);

  test('keeps teams, rosters, colors, sides and court; drops events and resets the period', () => {
    const next = createNextGame(prev, { keepRoster: [true, true] }, 'g2', '2026-11-02T00:00:00.000Z');
    expect(next.id).toBe('g2');
    expect(next.events).toEqual([]);
    expect(next.currentPeriod).toBe(1);
    expect(next.courtType).toBe(prev.courtType);
    expect(next.regulationPeriods).toBe(4);
    expect(next.teams).toEqual(prev.teams); // names, colors, sides, players, ids all kept
    expect(next.date).toBe('2026-11-02T00:00:00.000Z');
    expect(validateGame(next)).toEqual([]);
  });

  test('a cleared roster loses its players and its name but keeps its color and side', () => {
    const next = createNextGame(prev, { keepRoster: [true, false] });
    expect(next.teams[0]).toEqual(prev.teams[0]);
    expect(next.teams[1]).toMatchObject({ name: 'Away', players: [], color: prev.teams[1].color, attacksRightInPeriod1: prev.teams[1].attacksRightInPeriod1 });
    const both = createNextGame(prev, { keepRoster: [false, false] });
    expect(both.teams.map((t) => [t.name, t.players.length])).toEqual([['Home', 0], ['Away', 0]]);
  });

  test('uses the given date and trims the location; blank location is omitted', () => {
    const a = createNextGame(prev, { keepRoster: [true, true], date: '2027-01-05T02:00:00.000Z', location: '  Main Gym ' });
    expect(a).toMatchObject({ date: '2027-01-05T02:00:00.000Z', location: 'Main Gym' });
    expect(createNextGame(prev, { keepRoster: [true, true], location: '   ' })).not.toHaveProperty('location');
    expect(createNextGame(prev, { keepRoster: [true, true] })).not.toHaveProperty('location');
  });

  test('does not mutate or share player objects with the previous game', () => {
    const before = JSON.stringify(prev);
    const next = createNextGame(prev, { keepRoster: [true, true] });
    next.teams[0].players[0]!.name = 'CHANGED';
    expect(JSON.stringify(prev)).toBe(before);
  });
});

describe('store.startNewGame', () => {
  test('replaces the game; clears undo/redo, selection and the stat view', () => {
    const s = createGameStore({ initialGame: { ...sampleGame(), events: [], currentPeriod: 1 }, newId: () => 'fresh-id', now: () => Date.parse('2026-12-24T12:00:00Z') });
    s.getState().addShot({ playerId: 'h1', points: 2, made: true, x: 0.9, y: 0.5 });
    s.getState().addFoul('h2', 'personal');
    s.getState().setPeriod(3);
    s.getState().undo();
    s.getState().selectPlayer('h1');
    s.getState().setViewPeriod(2);
    expect(s.getState().redoStack.length).toBeGreaterThan(0);

    s.getState().startNewGame({ keepRoster: [true, true], location: 'Gym B' });
    const st = s.getState();
    expect(st.game).toMatchObject({ id: 'fresh-id', events: [], currentPeriod: 1, location: 'Gym B', date: '2026-12-24T12:00:00.000Z' });
    expect(st.undoStack).toEqual([]);
    expect(st.redoStack).toEqual([]);
    expect(st.selectedPlayerId).toBeNull();
    expect(st.viewPeriod).toBe('game');
    expect(st.game.teams[0].players.map((p) => p.id)).toEqual(['h1', 'h2', 'h3']);
    st.undo(); // nothing to undo in a new game
    expect(s.getState().game.events).toEqual([]);
  });

  test('the new game is playable: stats start from zero, fouls start from zero', () => {
    const s = createGameStore({ initialGame: sampleGame() });
    s.getState().startNewGame({ keepRoster: [true, true] });
    expect(computeStats(s.getState().game).size).toBe(0);
    for (let i = 0; i < 5; i++) expect(s.getState().addFoul('h1', 'personal')).not.toBeNull(); // a fouled-out player is fresh again
  });

  test('autosave sees the new game', () => {
    vi.useFakeTimers();
    const s = createGameStore({ initialGame: sampleGame() });
    const save = vi.fn();
    attachAutosave(s, save, 100);
    s.getState().startNewGame({ keepRoster: [true, false] });
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].events).toEqual([]);
    expect(save.mock.calls[0]![0].teams[1].players).toEqual([]);
    vi.useRealTimers();
  });
});

describe('dates', () => {
  test('localDateStamp is the LOCAL calendar date, not the UTC one', () => {
    const evening = new Date(2026, 9, 1, 20, 30).toISOString(); // 8:30 pm local on Oct 1 (UTC date may be Oct 2)
    expect(localDateStamp(evening)).toBe('2026-10-01');
    expect(localDateStamp(new Date(2026, 0, 5, 0, 5).toISOString())).toBe('2026-01-05');
  });

  test('datetime-local round trip', () => {
    const iso = new Date(2026, 9, 1, 20, 30).toISOString();
    expect(toDateTimeLocalValue(iso)).toBe('2026-10-01T20:30');
    expect(fromDateTimeLocalValue('2026-10-01T20:30')).toBe(iso);
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('garbage')).toBeNull();
    expect(toDateTimeLocalValue('garbage')).toBe('');
  });

  test('file names are safe and archives never collide', () => {
    const g = { date: new Date(2026, 9, 1, 20, 30).toISOString(), teams: [{ name: 'St. Mary’s / "A"' }, { name: '' }] } as never;
    expect(gameFileName(g)).toBe('2026-10-01_St_Mary_s_A_vs_team.xlsx');
    const a = archiveFileName(g, '2026-10-02T03:04:05.678Z');
    const b = archiveFileName(g, '2026-10-02T03:04:06.001Z');
    expect(a).toBe('2026-10-01_St_Mary_s_A_vs_team_saved-2026-10-02T03-04-05-678.xlsx');
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/[:\\/]/);
  });
});

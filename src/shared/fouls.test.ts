import { describe, expect, test } from 'vitest';
import {
  BONUS_AT, MAX_FOULS, MAX_TECHNICALS, computeStats, emptyLine, foulBlockedReason, foulTotal,
  playerFoulStatus, teamFoulStatus, teamFoulsByPeriod, sumLines, lineScore,
} from './stats';
import { createGameStore } from './store';
import { validateGame } from './validate';
import { home, away, sampleGame } from './fixtures';
import type { Game } from './types';

const empty = (): Game => ({ ...sampleGame(), events: [], currentPeriod: 1 });
// home: h1 h2 h3   away: a1 a2

describe('constants match the NFHS rules we researched', () => {
  test('5 fouls out, 2 technicals out, bonus on the 5th team foul of a quarter', () => {
    expect([MAX_FOULS, MAX_TECHNICALS, BONUS_AT]).toEqual([5, 2, 5]);
  });
});

describe('player foul status', () => {
  test('personals and technicals both count toward 5; 2 technicals eject', () => {
    expect(playerFoulStatus({ pf: 0, tf: 0 })).toMatchObject({ total: 0, remaining: 5, out: false });
    expect(playerFoulStatus({ pf: 4, tf: 0 })).toMatchObject({ remaining: 1, disqualified: false });
    expect(playerFoulStatus({ pf: 5, tf: 0 })).toMatchObject({ disqualified: true, out: true });
    expect(playerFoulStatus({ pf: 3, tf: 2 })).toMatchObject({ total: 5, disqualified: true, ejected: true });
    expect(playerFoulStatus({ pf: 0, tf: 2 })).toMatchObject({ total: 2, disqualified: false, ejected: true, out: true });
    expect(playerFoulStatus({ pf: 3, tf: 1 })).toMatchObject({ remaining: 1, out: false });
  });

  test('foulBlockedReason', () => {
    expect(foulBlockedReason({ pf: 4, tf: 0 }, 'personal')).toBeNull();
    expect(foulBlockedReason({ pf: 5, tf: 0 }, 'personal')).toMatch(/Fouled out/);
    expect(foulBlockedReason({ pf: 4, tf: 1 }, 'technical')).toMatch(/Fouled out/); // 5 total
    expect(foulBlockedReason({ pf: 0, tf: 2 }, 'technical')).toMatch(/Ejected/);
    expect(foulBlockedReason({ pf: 0, tf: 2 }, 'personal')).toMatch(/Ejected/); // out of the game: nothing more can be charged
  });
});

describe('addFoul', () => {
  test('records personal and technical fouls and counts them', () => {
    const s = createGameStore({ initialGame: empty() });
    s.getState().addFoul('h1', 'personal');
    s.getState().addFoul('h1', 'technical');
    const l = computeStats(s.getState().game).get('h1')!;
    expect(l).toMatchObject({ pf: 1, tf: 1 });
    expect(foulTotal(l)).toBe(2);
    expect(s.getState().game.events[1]).toMatchObject({ type: 'foul', kind: 'technical', period: 1, teamId: 'home' });
  });

  test('the 5th foul is allowed (disqualifies); a 6th is refused and records nothing', () => {
    const s = createGameStore({ initialGame: empty() });
    for (let i = 0; i < 5; i++) expect(s.getState().addFoul('h1', 'personal')).not.toBeNull();
    expect(playerFoulStatus(computeStats(s.getState().game).get('h1')!).disqualified).toBe(true);
    expect(s.getState().addFoul('h1', 'personal')).toBeNull();
    expect(s.getState().addFoul('h1', 'technical')).toBeNull();
    expect(s.getState().game.events).toHaveLength(5);
    expect(validateGame(s.getState().game)).toEqual([]);
  });

  test('technicals count toward the 5: 3 personals + 2 technicals = out; a 3rd technical is refused', () => {
    const s = createGameStore({ initialGame: empty() });
    ['personal', 'personal', 'personal', 'technical', 'technical'].forEach((k) =>
      expect(s.getState().addFoul('h1', k as 'personal' | 'technical')).not.toBeNull());
    expect(s.getState().addFoul('h1', 'technical')).toBeNull();
    expect(s.getState().addFoul('h1', 'personal')).toBeNull();
  });

  test('2 technicals alone eject, and a 3rd technical is refused even with fouls to spare', () => {
    const s = createGameStore({ initialGame: empty() });
    s.getState().addFoul('h1', 'technical');
    s.getState().addFoul('h1', 'technical');
    expect(playerFoulStatus(computeStats(s.getState().game).get('h1')!).ejected).toBe(true);
    expect(s.getState().addFoul('h1', 'technical')).toBeNull();
    expect(s.getState().addFoul('h1', 'personal')).toBeNull(); // an ejected player can't pick up a personal either
  });

  test('unknown player throws; fouls are undoable', () => {
    const s = createGameStore({ initialGame: empty() });
    expect(() => s.getState().addFoul('nobody', 'personal')).toThrow();
    s.getState().addFoul('h1', 'personal');
    s.getState().undo();
    expect(s.getState().game.events).toHaveLength(0);
    s.getState().redo();
    expect(s.getState().game.events).toHaveLength(1);
  });

  test('a foul can be edited to a different kind, and does not affect scoring', () => {
    const s = createGameStore({ initialGame: empty() });
    const e = s.getState().addFoul('h1', 'personal')!;
    s.getState().updateEvent(e.id, { kind: 'technical', points: 3 } as never);
    expect(s.getState().game.events[0]).toMatchObject({ kind: 'technical' });
    expect(s.getState().game.events[0]).not.toHaveProperty('points');
    expect(lineScore(s.getState().game).total).toEqual([0, 0]);
  });
});

describe('team fouls per quarter', () => {
  const foul = (s: ReturnType<typeof createGameStore>, id: string, n: number, kind: 'personal' | 'technical' = 'personal') => {
    for (let i = 0; i < n; i++) s.getState().addFoul(id, kind);
  };

  test('counted per team and per period, personal and technical together', () => {
    const s = createGameStore({ initialGame: empty() });
    foul(s, 'h1', 2); foul(s, 'h2', 1, 'technical'); foul(s, 'a1', 1);
    s.getState().setPeriod(2);
    foul(s, 'h3', 2); foul(s, 'a2', 3);
    const g = s.getState().game;
    expect(teamFoulsByPeriod(g, home)).toEqual({ 1: 3, 2: 2 });
    expect(teamFoulsByPeriod(g, away)).toEqual({ 1: 1, 2: 3 });
  });

  test('the opponent is in the bonus from the 5th team foul in a quarter, and it resets each quarter', () => {
    const s = createGameStore({ initialGame: empty() });
    foul(s, 'h1', 2); foul(s, 'h2', 2);
    expect(teamFoulStatus(s.getState().game, home, 1)).toMatchObject({ periodFouls: 4, opponentInBonus: false });
    foul(s, 'h3', 1);
    expect(teamFoulStatus(s.getState().game, home, 1)).toMatchObject({ periodFouls: 5, opponentInBonus: true });
    s.getState().setPeriod(2);
    expect(teamFoulStatus(s.getState().game, home, 2)).toMatchObject({ periodFouls: 0, opponentInBonus: false });
    expect(teamFoulStatus(s.getState().game, home, 1).opponentInBonus).toBe(true); // history unchanged
  });

  test('overtime carries the 4th-quarter count', () => {
    const s = createGameStore({ initialGame: empty() });
    s.getState().setPeriod(4);
    foul(s, 'h1', 3); foul(s, 'h2', 1);
    s.getState().setPeriod(5); // OT1
    foul(s, 'h3', 1);
    expect(teamFoulStatus(s.getState().game, home, 5)).toMatchObject({ periodFouls: 1, bonusCount: 5, opponentInBonus: true });
    // Q3 fouls don't leak into OT
    const s2 = createGameStore({ initialGame: empty() });
    s2.getState().setPeriod(3); foul(s2, 'h1', 4);
    s2.getState().setPeriod(5); foul(s2, 'h2', 1);
    expect(teamFoulStatus(s2.getState().game, home, 5)).toMatchObject({ bonusCount: 1, opponentInBonus: false });
  });

  test('team foul totals equal the sum of player fouls', () => {
    const g = sampleGame();
    const stats = computeStats(g);
    const players = home.players.map((p) => stats.get(p.id) ?? emptyLine());
    const sum = Object.values(teamFoulsByPeriod(g, home)).reduce((a, b) => a + b, 0);
    const fromPlayers = sumLines(players);
    expect(sum).toBe(fromPlayers.pf + fromPlayers.tf);
  });
});

describe('validateGame with fouls', () => {
  test('rejects a 6th foul and a 3rd technical coming from an imported file', () => {
    const g = empty();
    for (let i = 0; i < 6; i++) g.events.push({ id: `f${i}`, teamId: 'home', playerId: 'h1', period: 1, ts: i, type: 'foul', kind: 'personal' });
    expect(validateGame(g).join(' ')).toMatch(/6 fouls/);
    const g2 = empty();
    for (let i = 0; i < 3; i++) g2.events.push({ id: `t${i}`, teamId: 'home', playerId: 'h1', period: 1, ts: i, type: 'foul', kind: 'technical' });
    expect(validateGame(g2).join(' ')).toMatch(/3 technical/);
  });
  test('rejects an unknown foul kind', () => {
    const g = empty();
    g.events.push({ id: 'x', teamId: 'home', playerId: 'h1', period: 1, ts: 1, type: 'foul', kind: 'flagrant' as never });
    expect(validateGame(g).join(' ')).toMatch(/foul kind/);
  });
  test('the fixtures are valid', () => {
    expect(validateGame(sampleGame())).toEqual([]);
  });
});

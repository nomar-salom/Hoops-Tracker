import { describe, expect, test } from 'vitest';
import { shotCounts, eventCountByPlayer, eventExtra, eventWhat, filterEvents, involvesPlayer, playerLabel } from './eventLog';
import { generateGame, sampleGame } from './fixtures';

const g = sampleGame();
// events: 0 h1 3PT made (assist h2) | 1 h2 2PT miss (block a1) | 2 a2 DREB | 3 a1 2PT made | 4 h3 FT made | 5 h3 FT miss
//         6 h1 OREB | 7 a2 steal | 8 h2 turnover | 9 a2 3PT made (Q5) | 10 h1 foul | 11 a1 foul | 12 h2 tech

describe('descriptions', () => {
  test('eventWhat', () => {
    expect(g.events.map(eventWhat)).toEqual([
      '3PT made', '2PT missed', 'Defensive rebound', '2PT made', 'Free throw made', 'Free throw missed',
      'Offensive rebound', 'Steal', 'Turnover', '3PT made', 'Personal foul', 'Personal foul', 'Technical foul',
    ]);
  });
  test('eventExtra names the assister and blocker; empty for everything else', () => {
    expect(eventExtra(g, g.events[0]!)).toBe('assist: #23 Ben');
    expect(eventExtra(g, g.events[1]!)).toBe('blocked by #5 Dan');
    expect(eventExtra(g, g.events[7]!)).toBe('');
    expect(eventExtra(g, g.events[3]!)).toBe('');
  });
  test('playerLabel', () => {
    expect(playerLabel(g, 'h3')).toBe('#00 Cal');
    expect(playerLabel(g, 'ghost')).toBe('Unknown player');
    expect(playerLabel(g, undefined)).toBe('Unknown player');
  });
});

describe('filterEvents', () => {
  const idx = (f: Parameters<typeof filterEvents>[1]) => filterEvents(g, f).map((r) => r.index);

  test('no filter returns everything in order, with log positions', () => {
    expect(idx({})).toEqual(g.events.map((_, i) => i));
    expect(idx({ type: 'all' })).toHaveLength(g.events.length);
  });
  test('period, team and type', () => {
    expect(idx({ period: 1 })).toEqual([0, 1, 2, 3, 10, 11]);
    expect(idx({ period: 5 })).toEqual([9]);
    expect(idx({ teamId: 'away' })).toEqual([2, 3, 7, 9, 11]);
    expect(idx({ type: 'foul' })).toEqual([10, 11, 12]);
    expect(idx({ type: 'freeThrow' })).toEqual([4, 5]);
  });
  test('assist and block match the shots that carry them', () => {
    expect(idx({ type: 'assist' })).toEqual([0]);
    expect(idx({ type: 'block' })).toEqual([1]);
  });
  test('a player filter includes events where he assisted or blocked', () => {
    expect(idx({ playerId: 'h2' })).toEqual([0, 1, 8, 12]);  // assisted #0, own miss #1, TO, tech
    expect(idx({ playerId: 'a1' })).toEqual([1, 3, 11]);     // blocked #1, own shot, own foul
  });
  test('filters combine', () => {
    expect(idx({ teamId: 'home', type: 'foul', period: 3 })).toEqual([12]);
    expect(idx({ playerId: 'h2', type: 'shot' })).toEqual([0, 1]);
    expect(idx({ period: 2, type: 'shot' })).toEqual([]);
  });
  test('involvesPlayer', () => {
    expect(involvesPlayer(g.events[0]!, 'h2')).toBe(true);
    expect(involvesPlayer(g.events[0]!, 'a1')).toBe(false);
  });
});

describe('eventCountByPlayer matches what the roster editor protects', () => {
  test('counts actor + assister + blocker', () => {
    const m = eventCountByPlayer(g);
    expect(m.get('h2')).toBe(4);
    expect(m.get('a1')).toBe(3);
    expect(m.get('h1')).toBe(3);
  });
  test("equals the player filter's row count for every player of a large game", () => {
    const big = generateGame(21, 300);
    const m = eventCountByPlayer(big);
    for (const p of big.teams.flatMap((t) => t.players)) {
      expect(filterEvents(big, { playerId: p.id }).length).toBe(m.get(p.id) ?? 0);
    }
  });
});

describe('shotCounts', () => {
  // sampleGame shots: #0 h1 3PT made (Q1) | #1 h2 2PT miss (Q1) | #3 a1 2PT made (Q1) | #9 a2 3PT made (Q5)
  test('made / attempted per team, whole game', () => {
    expect(shotCounts(g)).toEqual([{ made: 1, attempts: 2 }, { made: 2, attempts: 2 }]);
  });
  test('one period only', () => {
    expect(shotCounts(g, { period: 1 })).toEqual([{ made: 1, attempts: 2 }, { made: 1, attempts: 1 }]);
    expect(shotCounts(g, { period: 5 })).toEqual([{ made: 0, attempts: 0 }, { made: 1, attempts: 1 }]);
    expect(shotCounts(g, { period: 2 })).toEqual([{ made: 0, attempts: 0 }, { made: 0, attempts: 0 }]);
  });
  test('ignores free throws and every other event type', () => {
    const only = shotCounts({ ...g, events: g.events.filter((e) => e.type !== 'shot') });
    expect(only).toEqual([{ made: 0, attempts: 0 }, { made: 0, attempts: 0 }]);
  });
  test('adds up to the team FG totals for a big game', () => {
    const big = generateGame(5, 300);
    const [h, a] = shotCounts(big);
    const shots = big.events.filter((e) => e.type === 'shot');
    expect(h.attempts + a.attempts).toBe(shots.length);
    expect(h.made + a.made).toBe(shots.filter((e) => e.type === 'shot' && e.made).length);
  });
});

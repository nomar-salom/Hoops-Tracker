import { describe, expect, test } from 'vitest';
import { compareJersey, parseRosterText, rosterIssues } from './roster';
import { createGameStore } from './store';
import { sampleGame } from './fixtures';
import { attacksRight } from './stats';
import type { Team } from './types';

describe('parseRosterText', () => {
  test.each([
    ['23 Ben Smith', '23', 'Ben Smith'],
    ['#23 Ben', '23', 'Ben'],
    ['23, Ben', '23', 'Ben'],
    ['23\tBen', '23', 'Ben'],
    ['23 - Ben', '23', 'Ben'],
    ['23. Ben', '23', 'Ben'],
    ['Ben Smith 23', '23', 'Ben Smith'],
    ['Ben #23', '23', 'Ben'],
    ['Ben, 23', '23', 'Ben'],
    ['00 Eli', '00', 'Eli'],
    ['7', '7', ''],
    ['Ben', '', 'Ben'],
  ])('%j', (line, number, name) => {
    expect(parseRosterText(line)).toEqual([{ number, name }]);
  });

  test('multiple lines, blanks and Windows line endings', () => {
    expect(parseRosterText('1 A\r\n\r\n  2 B  \n\n#3, C')).toEqual([
      { number: '1', name: 'A' }, { number: '2', name: 'B' }, { number: '3', name: 'C' },
    ]);
  });

  test('a name that merely contains digits is not split wrongly', () => {
    expect(parseRosterText('Mike 2nd')).toEqual([{ number: '', name: 'Mike 2nd' }]);
  });

  test('"0" and "00" stay distinct strings', () => {
    expect(parseRosterText('0 A\n00 B').map((p) => p.number)).toEqual(['0', '00']);
  });
});

describe('compareJersey', () => {
  test('numeric order, 0 before 00, then text, then blank last', () => {
    const sorted = ['23', '5', '00', '', 'A', '0', '10'].sort(compareJersey);
    expect(sorted).toEqual(['0', '00', '5', '10', '23', 'A', '']);
  });
});

describe('rosterIssues', () => {
  const team = (players: [string, string][]): Team => ({
    id: 't', name: 'T', color: '#000', attacksRightInPeriod1: true,
    players: players.map(([number, name], i) => ({ id: `p${i}`, number, name })),
  });
  test('clean roster has none', () => {
    expect(rosterIssues(team([['1', 'A'], ['2', 'B']]))).toEqual([]);
  });
  test('duplicate numbers, missing numbers and missing names', () => {
    const issues = rosterIssues(team([['5', 'A'], ['5', 'B'], ['', 'C'], ['7', '']]));
    expect(issues).toEqual(expect.arrayContaining([
      '2 players wear #5 (A, B).', 'C has no jersey number.', '#7 has no name.',
    ]));
  });
  test('"0" and "00" are not duplicates', () => {
    expect(rosterIssues(team([['0', 'A'], ['00', 'B']]))).toEqual([]);
  });
});

describe('store: sortRoster / swapSides', () => {
  test('sortRoster orders by jersey and keeps ids/stats intact', () => {
    const s = createGameStore({ initialGame: sampleGame() });
    const before = s.getState().game.teams[0].players.map((p) => p.id).sort();
    s.getState().sortRoster('home'); // home: 1, 23, 00 -> 00, 1, 23
    const after = s.getState().game.teams[0].players;
    expect(after.map((p) => p.number)).toEqual(['00', '1', '23']);
    expect(after.map((p) => p.id).sort()).toEqual(before);
    expect(s.getState().game.events).toEqual(sampleGame().events);
  });

  test('swapSides flips both teams so they always attack opposite ends', () => {
    const s = createGameStore({ initialGame: sampleGame() });
    const [h, a] = s.getState().game.teams;
    expect([h.attacksRightInPeriod1, a.attacksRightInPeriod1]).toEqual([true, false]);
    s.getState().swapSides();
    const [h2, a2] = s.getState().game.teams;
    expect([h2.attacksRightInPeriod1, a2.attacksRightInPeriod1]).toEqual([false, true]);
    for (const p of [1, 2, 3, 4, 5]) expect(attacksRight(h2, p)).not.toBe(attacksRight(a2, p));
  });

  test('swapping sides changes how the next shot is classified', () => {
    const s = createGameStore({ initialGame: { ...sampleGame(), events: [], currentPeriod: 1 } });
    const x = 0.1; // right under the LEFT basket
    s.getState().addShot({ playerId: 'h1', made: true, x, y: 0.5 }); // home attacks right: far -> 3
    s.getState().swapSides();
    s.getState().addShot({ playerId: 'h1', made: true, x, y: 0.5 }); // home now attacks left: close -> 2
    expect(s.getState().game.events.map((e) => e.type === 'shot' && e.points)).toEqual([3, 2]);
  });

  test('roster edits never touch recorded events', () => {
    const s = createGameStore({ initialGame: sampleGame() });
    s.getState().updatePlayer('h1', { name: 'Alexander', number: '11' });
    s.getState().updateTeam('home', { name: 'Hawks', color: '#123456' });
    expect(s.getState().game.events).toEqual(sampleGame().events);
    expect(s.getState().game.teams[0]).toMatchObject({ name: 'Hawks', color: '#123456' });
  });
});

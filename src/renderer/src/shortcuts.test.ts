import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { computeStats } from '@shared/stats';
import { gameStore } from './store';
import { useUi } from './ui';
import { createDemoGame } from './demo';
import { BUFFER_IDLE_MS, STAT_KEYS, handleShortcut, helpGroups, resetShortcuts, type KeyContext, type KeyInfo } from './shortcuts';

const base: KeyContext = { typing: false, modalOpen: false, popoverOpen: false };
const info = (key: string, extra: Partial<KeyInfo> = {}): KeyInfo =>
  ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra });
const press = (key: string, extra: Partial<KeyInfo> = {}, ctx: KeyContext = base) => handleShortcut(info(key, extra), ctx);
const typeKeys = (s: string) => [...s].forEach((c) => press(c));
const idle = () => vi.advanceTimersByTime(BUFFER_IDLE_MS + 1);

// demo roster, both teams: #1 Alex, #5 Ben, #10 Cal, #23 Dan, #00 Eli
const ids = () => {
  const g = gameStore.getState().game;
  return { h: g.teams[0].players.map((p) => p.id), a: g.teams[1].players.map((p) => p.id) };
};
const stat = (id: string) => computeStats(gameStore.getState().game).get(id);
const selected = () => gameStore.getState().selectedPlayerId;
const toast = () => useUi.getState().toast;
const nEvents = () => gameStore.getState().game.events.length;

beforeEach(() => {
  vi.useFakeTimers();
  gameStore.getState().newGame(createDemoGame());
  useUi.setState({ showShots: [true, true], shotPlayerId: null, activeTeam: 0, toast: null, helpOpen: false, numberBuffer: '', inputMode: 'mouse' });
  resetShortcuts();
});
afterEach(() => { resetShortcuts(); vi.useRealTimers(); });

describe('picking a player by jersey number', () => {
  test('digits then Enter selects on the active team', () => {
    typeKeys('23');
    expect(useUi.getState().numberBuffer).toBe('23');
    expect(selected()).toBeNull();
    expect(press('Enter')).toBe(true);
    expect(selected()).toBe(ids().h[3]); // Dan
    expect(useUi.getState().numberBuffer).toBe('');
  });

  test('a pause accepts the number without Enter', () => {
    typeKeys('5');
    idle();
    expect(selected()).toBe(ids().h[1]); // Ben
  });

  test('a stat key accepts the pending number first: "2","3","F" fouls #23', () => {
    typeKeys('23');
    press('f');
    expect(stat(ids().h[3]!)).toMatchObject({ pf: 1 });
    expect(selected()).toBe(ids().h[3]);
  });

  test('typing 2 then 3 quickly picks #23, not #2', () => {
    gameStore.getState().addPlayer(gameStore.getState().game.teams[0].id, { number: '2', name: 'Two' });
    typeKeys('2'); vi.advanceTimersByTime(300); typeKeys('3'); idle();
    expect(selected()).toBe(ids().h[3]);
  });

  test('"0" and "00" are different players', () => {
    const home = gameStore.getState().game.teams[0].id;
    const zero = gameStore.getState().addPlayer(home, { number: '0', name: 'Zero' });
    typeKeys('00'); press('Enter');
    expect(selected()).toBe(ids().h[4]); // Eli #00
    typeKeys('0'); press('Enter');
    expect(selected()).toBe(zero);
  });

  test('no such number: warns and keeps the old selection', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    typeKeys('9'); press('Enter');
    expect(toast()).toMatchObject({ kind: 'warn', text: 'No #9 on Home' });
    expect(selected()).toBe(ids().h[0]);
  });

  test('a 4th digit starts a new number; Backspace removes one digit', () => {
    typeKeys('1234');
    expect(useUi.getState().numberBuffer).toBe('4');
    resetShortcuts();
    typeKeys('23'); press('Backspace');
    expect(useUi.getState().numberBuffer).toBe('2');
    expect(press('Backspace')).toBe(true);
    expect(press('Backspace')).toBe(false); // nothing to delete: let the key through
  });

  test('Esc cancels the number, then deselects, then passes through', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    typeKeys('2');
    expect(press('Escape')).toBe(true);
    expect(useUi.getState().numberBuffer).toBe('');
    expect(selected()).toBe(ids().h[0]);
    expect(press('Escape')).toBe(true);
    expect(selected()).toBeNull();
    expect(press('Escape')).toBe(false);
  });

  test('held digit keys do not repeat', () => {
    press('2'); press('2', { repeat: true }); press('2', { repeat: true });
    expect(useUi.getState().numberBuffer).toBe('2');
  });
});

describe('teams and the roster', () => {
  test('arrows switch the team (Left = Home, Right = Away) and clear a selection from the other team', () => {
    gameStore.getState().selectPlayer(ids().h[1]!);
    press('ArrowRight');
    expect(useUi.getState().activeTeam).toBe(1);
    expect(selected()).toBeNull();
    typeKeys('5'); press('Enter');
    expect(selected()).toBe(ids().a[1]); // Away Ben
    press('ArrowRight');
    expect(selected()).toBe(ids().a[1]); // same team: selection stays
    press('ArrowLeft');
    expect(useUi.getState().activeTeam).toBe(0);
    expect(selected()).toBeNull();
  });

  test('up/down walk the active roster and wrap; first press picks first/last', () => {
    press('ArrowDown');
    expect(selected()).toBe(ids().h[0]);
    press('ArrowDown'); press('ArrowDown');
    expect(selected()).toBe(ids().h[2]);
    gameStore.getState().selectPlayer(ids().h[4]!);
    press('ArrowDown');
    expect(selected()).toBe(ids().h[0]); // wrapped
    press('ArrowUp');
    expect(selected()).toBe(ids().h[4]); // wrapped back
    gameStore.getState().selectPlayer(null);
    press('ArrowUp');
    expect(selected()).toBe(ids().h[4]); // from nothing, Up picks the last
  });

  test('arrow keys may repeat for fast navigation', () => {
    press('ArrowDown'); press('ArrowDown', { repeat: true }); press('ArrowDown', { repeat: true });
    expect(selected()).toBe(ids().h[2]);
  });

  test('an empty roster warns instead of crashing', () => {
    useUi.setState({ activeTeam: 1 });
    ids().a.forEach((id) => gameStore.getState().removePlayer(id));
    press('ArrowDown');
    expect(toast()?.text).toBe('Away has no players');
  });
});

describe('stat keys', () => {
  const expectations: Record<string, (id: string) => void> = {
    foul: (id) => expect(stat(id)).toMatchObject({ pf: 1, tf: 0 }),
    tech: (id) => expect(stat(id)).toMatchObject({ pf: 0, tf: 1 }),
    stl: (id) => expect(stat(id)?.stl).toBe(1),
    tov: (id) => expect(stat(id)?.tov).toBe(1),
    oreb: (id) => expect(stat(id)).toMatchObject({ oreb: 1, reb: 1 }),
    dreb: (id) => expect(stat(id)).toMatchObject({ dreb: 1, reb: 1 }),
    ftMade: (id) => expect(stat(id)).toMatchObject({ ftm: 1, fta: 1, pts: 1 }),
    ftMiss: (id) => expect(stat(id)).toMatchObject({ ftm: 0, fta: 1, pts: 0 }),
  };

  test.each(STAT_KEYS.filter((s) => expectations[s.action]).map((s) => [s.key + (s.shift ? ' (shift)' : ''), s] as const))(
    'key %s records %s',
    (_name, s) => {
      gameStore.getState().selectPlayer(ids().h[0]!);
      expect(press(s.key, { shiftKey: !!s.shift })).toBe(true);
      expectations[s.action]!(ids().h[0]!);
      expect(nEvents()).toBe(1);
    },
  );

  test('Caps Lock does not turn a personal foul into a technical (only Shift does)', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('F', { shiftKey: false });
    expect(stat(ids().h[0]!)).toMatchObject({ pf: 1, tf: 0 });
    press('F', { shiftKey: true });
    expect(stat(ids().h[0]!)).toMatchObject({ pf: 1, tf: 1 });
  });

  test('a stat key with nobody selected warns and records nothing', () => {
    expect(press('s')).toBe(true);
    expect(toast()).toMatchObject({ kind: 'warn' });
    expect(toast()?.text).toContain('Select a player first');
    expect(nEvents()).toBe(0);
  });

  test('holding a stat key records it once', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('s'); press('s', { repeat: true }); press('s', { repeat: true });
    expect(stat(ids().h[0]!)?.stl).toBe(1);
  });

  test('assist and block credit the right shots', () => {
    const { h, a } = ids();
    gameStore.getState().addShot({ playerId: h[1]!, points: 2, made: true, x: 0.9, y: 0.5 });
    gameStore.getState().selectPlayer(h[0]!);
    press('a');
    expect(stat(h[0]!)?.ast).toBe(1);

    gameStore.getState().addShot({ playerId: h[1]!, points: 2, made: false, x: 0.9, y: 0.5 });
    gameStore.getState().selectPlayer(a[0]!);
    press('b');
    expect(stat(a[0]!)?.blk).toBe(1);
  });

  test('R is the smart rebound: offensive for the shooter\u2019s team, defensive for the other', () => {
    const { h, a } = ids();
    gameStore.getState().addShot({ playerId: h[0]!, points: 3, made: false, x: 0.7, y: 0.5 });
    gameStore.getState().selectPlayer(h[1]!);
    press('r');
    expect(stat(h[1]!)).toMatchObject({ oreb: 1, dreb: 0 });

    gameStore.getState().addShot({ playerId: h[0]!, points: 3, made: false, x: 0.7, y: 0.5 });
    gameStore.getState().selectPlayer(a[0]!);
    press('r');
    expect(stat(a[0]!)).toMatchObject({ dreb: 1, oreb: 0 });
  });

  test('R with no miss to rebound warns and records nothing', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('r');
    expect(toast()).toMatchObject({ kind: 'warn' });
    expect(nEvents()).toBe(0);
  });

  test('foul limits still apply from the keyboard', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    for (let i = 0; i < 5; i++) press('f');
    expect(toast()?.text).toContain('FOULED OUT');
    press('f');
    expect(stat(ids().h[0]!)?.pf).toBe(5);
    expect(toast()?.text).toContain('Fouled out');
  });
});

describe('game keys', () => {
  test('] and [ change the period; [ cannot go below recorded events', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('s');                      // an event in Q1
    press(']');
    expect(gameStore.getState().game.currentPeriod).toBe(2);
    expect(toast()?.text).toBe('Now in Q2');
    press('s');                      // an event in Q2
    press('[');
    expect(gameStore.getState().game.currentPeriod).toBe(2); // blocked by the Q2 event
  });

  test('V cycles whole game -> Q1 -> Q2 ... and wraps; Shift+V goes back', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('s'); press(']'); press('s'); press(']'); press('s');       // events in Q1, Q2, Q3 (current = Q3)
    expect(gameStore.getState().viewPeriod).toBe('game');
    press('v'); expect(gameStore.getState().viewPeriod).toBe(1);
    expect(toast()?.text).toBe('Showing Q1 only');
    press('v'); expect(gameStore.getState().viewPeriod).toBe(2);
    press('v'); expect(gameStore.getState().viewPeriod).toBe(3);
    press('V', { shiftKey: true }); expect(gameStore.getState().viewPeriod).toBe(2);
    press('v'); press('v');                                           // 3 -> game
    expect(gameStore.getState().viewPeriod).toBe('game');
    expect(toast()?.text).toBe('Showing the whole game');
    press('V', { shiftKey: true });                                   // game -> last period
    expect(gameStore.getState().viewPeriod).toBe(3);
  });

  test('viewing a past period does not move where new stats are recorded', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press(']'); press(']');                                           // current = Q3
    press('v');                                                       // view Q1
    press('s');
    expect(gameStore.getState().game.events.at(-1)).toMatchObject({ type: 'steal', period: 3 });
    expect(gameStore.getState().viewPeriod).toBe(1);
  });

  test('P shows only the selected player\u2019s shots; again (or with nobody selected) clears it', () => {
    const { h } = ids();
    expect(press('p')).toBe(true);
    expect(toast()).toMatchObject({ kind: 'warn' });                  // nobody selected
    gameStore.getState().selectPlayer(h[1]!);
    press('p');
    expect(useUi.getState().shotPlayerId).toBe(h[1]);
    expect(toast()?.text).toBe('Showing only Ben\u2019s shots');
    press('p');
    expect(useUi.getState().shotPlayerId).toBeNull();
    press('p'); press('Escape'); gameStore.getState().selectPlayer(null);
    press('p');                                                       // active filter + nobody selected -> clear
    expect(useUi.getState().shotPlayerId).toBeNull();
  });

  test('P switches on the player\u2019s team if its shots were hidden', () => {
    useUi.setState({ showShots: [false, true] });
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('p');
    expect(useUi.getState().showShots).toEqual([true, true]);
  });

  test('after the game ends: stat, period and undo keys explain instead of acting; looking around still works', () => {
    const { h } = ids();
    gameStore.getState().selectPlayer(h[0]!);
    press('s');
    gameStore.getState().endGame();
    const n = nEvents();
    for (const [key, extra] of [['s', {}], ['f', {}], ['d', {}], ['+', {}], [']', {}], ['[', {}], ['u', {}], ['z', { ctrlKey: true }], ['y', { ctrlKey: true }]] as const) {
      useUi.setState({ toast: null });
      expect(press(key, extra as Partial<KeyInfo>)).toBe(true);
      expect(toast(), key).toMatchObject({ kind: 'warn' });
    }
    expect(nEvents()).toBe(n);
    expect(gameStore.getState().game.currentPeriod).toBe(1);
    press('v');
    expect(gameStore.getState().viewPeriod).toBe(1);                  // viewing still works
    gameStore.getState().selectPlayer(h[0]!);
    press('p');
    expect(useUi.getState().shotPlayerId).toBe(h[0]);
  });

  test('U undoes, Shift+U redoes; so do Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Cmd+Z', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    press('s');
    press('u');
    expect(nEvents()).toBe(0);
    press('U', { shiftKey: true });
    expect(nEvents()).toBe(1);
    press('z', { ctrlKey: true });
    expect(nEvents()).toBe(0);
    press('z', { ctrlKey: true, shiftKey: true });
    expect(nEvents()).toBe(1);
    press('z', { metaKey: true });
    expect(nEvents()).toBe(0);
    press('y', { ctrlKey: true });
    expect(nEvents()).toBe(1);
  });

  test('? and F1 open the help sheet', () => {
    press('?', { shiftKey: true });
    expect(useUi.getState().helpOpen).toBe(true);
    useUi.setState({ helpOpen: false });
    press('F1');
    expect(useUi.getState().helpOpen).toBe(true);
  });

  test('L opens the event log (with no filter), and it is in the help sheet', () => {
    useUi.setState({ logOpen: false, logFilter: { playerId: 'x' } });
    expect(press('l')).toBe(true);
    expect(useUi.getState().logOpen).toBe(true);
    expect(useUi.getState().logFilter).toEqual({});
    expect(JSON.stringify(helpGroups())).toContain('Open the event log');
    useUi.setState({ logOpen: false });
    expect(press('l', {}, { ...base, modalOpen: true })).toBe(false);
  });

  test('Shift+H / Shift+A hide and show each team\u2019s shots, with a toast', () => {
    expect(press('H', { shiftKey: true })).toBe(true);
    expect(useUi.getState().showShots).toEqual([false, true]);
    expect(toast()?.text).toBe('Home shots hidden');
    press('A', { shiftKey: true });
    expect(useUi.getState().showShots).toEqual([false, false]);
    expect(toast()?.text).toBe('Away shots hidden');
    press('H', { shiftKey: true });
    expect(useUi.getState().showShots).toEqual([true, false]);
    expect(toast()?.text).toBe('Home shots shown');
  });

  test('a plain H does nothing, and a plain A is still the ASSIST key (never hides a team)', () => {
    expect(press('h')).toBe(false);
    expect(useUi.getState().showShots).toEqual([true, true]);
    const { h } = ids();
    gameStore.getState().addShot({ playerId: h[1]!, points: 2, made: true, x: 0.9, y: 0.5 });
    gameStore.getState().selectPlayer(h[0]!);
    press('a');
    expect(stat(h[0]!)?.ast).toBe(1);
    expect(useUi.getState().showShots).toEqual([true, true]);
  });

  test('shot toggles use the real team names and are inert while typing or in a dialog', () => {
    gameStore.getState().updateTeam(gameStore.getState().game.teams[1].id, { name: 'Owls' });
    press('A', { shiftKey: true });
    expect(toast()?.text).toBe('Owls shots hidden');
    useUi.setState({ showShots: [true, true] });
    expect(press('H', { shiftKey: true }, { ...base, typing: true })).toBe(false);
    expect(press('H', { shiftKey: true }, { ...base, modalOpen: true })).toBe(false);
    expect(press('H', { shiftKey: true }, { ...base, popoverOpen: true })).toBe(false);
    expect(useUi.getState().showShots).toEqual([true, true]);
  });

  test('held Shift+H toggles once, not repeatedly', () => {
    press('H', { shiftKey: true }); press('H', { shiftKey: true, repeat: true }); press('H', { shiftKey: true, repeat: true });
    expect(useUi.getState().showShots).toEqual([false, true]);
  });

  test('the toggles are listed in the help sheet', () => {
    expect(JSON.stringify(helpGroups())).toContain('Shift+H');
  });

  test('keyboard use is remembered (for the focus highlight)', () => {
    expect(useUi.getState().inputMode).toBe('mouse');
    typeKeys('1');
    expect(useUi.getState().inputMode).toBe('keyboard');
  });
});

describe('when the shortcuts must stay out of the way', () => {
  test('typing in a text field: nothing is handled, nothing is recorded', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    for (const key of ['f', 's', 't', '3', 'Enter', 'ArrowDown', 'u', ']']) {
      expect(press(key, {}, { ...base, typing: true })).toBe(false);
    }
    expect(press('z', { ctrlKey: true }, { ...base, typing: true })).toBe(false); // the field's own undo
    expect(nEvents()).toBe(0);
    expect(useUi.getState().numberBuffer).toBe('');
  });

  test('a dialog is open: nothing is handled', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    expect(press('f', {}, { ...base, modalOpen: true })).toBe(false);
    expect(press('z', { ctrlKey: true }, { ...base, modalOpen: true })).toBe(false);
    expect(nEvents()).toBe(0);
  });

  test('the shot popover owns plain keys, but Ctrl+Z still works', () => {
    gameStore.getState().selectPlayer(ids().h[0]!);
    const pop = { ...base, popoverOpen: true };
    for (const key of ['m', 'x', '2', '3', 'f', 's', 'Escape', 'Enter']) expect(press(key, {}, pop)).toBe(false);
    expect(nEvents()).toBe(0);
    press('s'); // one real event
    expect(press('z', { ctrlKey: true }, pop)).toBe(true);
    expect(nEvents()).toBe(0);
  });

  test('other Ctrl/Alt shortcuts are left to the browser/app', () => {
    for (const k of ['r', 'w', 'f', 's', 'p', 'a']) expect(press(k, { ctrlKey: true })).toBe(false);
    expect(press('f', { altKey: true })).toBe(false);
    expect(nEvents()).toBe(0);
  });

  test('unrecognized keys are not swallowed and do not disturb a half-typed number', () => {
    typeKeys('2');
    expect(press('z')).toBe(false);
    expect(press('Tab')).toBe(false);
    expect(press('g')).toBe(false);
    expect(useUi.getState().numberBuffer).toBe('2');
  });
});

describe('help sheet is generated from the key table', () => {
  test('no two stat keys share a binding', () => {
    const seen = new Set<string>();
    for (const s of STAT_KEYS) {
      const id = `${s.key}|${s.shift ?? 'any'}`;
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    }
  });

  test('every stat key appears in the help, aliases merged', () => {
    const text = JSON.stringify(helpGroups());
    for (const s of STAT_KEYS) expect(text).toContain(s.label);
    const ft = helpGroups().flatMap((g) => g.rows).find((r) => r.label === 'Free throw made')!;
    expect(ft.keys).toEqual(['+', '=']);
    expect(helpGroups().flatMap((g) => g.rows).find((r) => r.label === 'Technical foul')!.keys).toEqual(['Shift+F']);
  });

  test('plain stat keys do not collide with navigation or digits', () => {
    const reserved = ['v', 'u', '[', ']', '?'];
    for (const s of STAT_KEYS) {
      expect(reserved).not.toContain(s.key);
      expect(/^\d$/.test(s.key)).toBe(false);
    }
  });
});

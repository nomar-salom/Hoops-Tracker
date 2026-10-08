import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FoulBoxes, PlayerCard, TeamFoulsStrip, TeamTotalsGrid } from './PlayerCard';
import { emptyLine } from '@shared/stats';
import { home } from '@shared/fixtures';
import type { StatLine } from '@shared/types';
import type { StatAction } from '../statActions';

const player = home.players[0]!;
const line: StatLine = {
  ...emptyLine(), pts: 14, reb: 5, oreb: 2, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 3,
  fg2m: 3, fg2a: 5, fg3m: 2, fg3a: 4, ftm: 2, fta: 3, pf: 2, tf: 1,
};
const render = (over: { selected?: boolean; quick?: StatAction[]; gameLine?: StatLine; line?: StatLine; onShots?: () => void; shotsActive?: boolean; locked?: boolean } = {}) =>
  renderToStaticMarkup(
    <ul>
      <PlayerCard team={home} player={player} line={over.line ?? line} gameLine={over.gameLine ?? line} selected={over.selected ?? false}
        quick={over.quick ?? []} onSelect={() => {}} onAction={() => {}}
        onShots={over.onShots} shotsActive={over.shotsActive} locked={over.locked} />
    </ul>,
  );
const buttons = (m: string, attr: string) => [...m.matchAll(new RegExp(`data-${attr}="([^"]+)"`, 'g'))].map((x) => x[1]);

describe('PlayerCard', () => {
  test('shows number, name, points and the full stat line', () => {
    const m = render();
    expect(m).toContain('#1');
    expect(m).toContain('Alex');
    expect(m).toContain('REB 5 · AST 2 · STL 1 · BLK 0 · TO 3');
    expect(m).toContain('FG 5-9 · 2P 3-5 · 3P 2-4 · FT 2-3'); // FG is 2P + 3P
  });

  test('stat buttons appear only for the selected player, in order, with live counts', () => {
    expect(buttons(render({ selected: false }), 'action')).toEqual([]);
    const m = render({ selected: true });
    expect(buttons(m, 'action')).toEqual(['ftMade', 'ftMiss', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'foul', 'tech']);
    expect(m).toContain('data-selected="true"');
    // counts: FT made 2, FT miss 1, OREB 2, DREB 3, AST 2, STL 1, BLK 0, TO 3, personal fouls 2, technicals 1
    const counts = [...m.matchAll(/tabular-nums">(\d+)(?:<span[^>]*>\/\d+<\/span>)?<\/div>/g)].map((x) => Number(x[1]));
    expect(counts).toEqual([2, 1, 2, 3, 2, 1, 0, 3, 2, 1]);
    expect(m).toContain('>/2<'); // technicals show their limit
  });

  test('quick buttons show even when not selected', () => {
    const m = render({ selected: false, quick: ['dreb', 'blk'] });
    expect(buttons(m, 'quick')).toEqual(['dreb', 'blk']);
    expect(m).toContain('+ DREB');
    expect(m).toContain('+ BLK');
  });
});

test('team totals grid', () => {
  const m = renderToStaticMarkup(<TeamTotalsGrid line={line} />);
  expect(m).toContain('5-9 56%'); // FG
  expect(m).toContain('2-4 50%'); // 3P
  expect(m).toContain('2-3 67%'); // FT
  expect(m).toContain('5 (2 off)'); // REB
});

describe('foul display', () => {
  const boxes = (m: string) => [...m.matchAll(/data-foul-box="(\w+)"/g)].map((x) => x[1]);

  test('five boxes: personals amber, technicals red T, then empty; total out of 5', () => {
    const m = renderToStaticMarkup(<FoulBoxes line={{ pf: 2, tf: 1 }} />);
    expect(boxes(m)).toEqual(['personal', 'personal', 'technical', 'empty', 'empty']);
    expect(m).toContain('3/5');
    expect(m).toContain('T 1/2');
    expect(m).not.toContain('data-badge="out"');
  });

  test('foul trouble at 4, FOULED OUT at 5, EJECTED at 2 technicals', () => {
    expect(renderToStaticMarkup(<FoulBoxes line={{ pf: 4, tf: 0 }} />)).toContain('data-badge="trouble"');
    const out = renderToStaticMarkup(<FoulBoxes line={{ pf: 5, tf: 0 }} />);
    expect(out).toContain('FOULED OUT');
    expect(boxes(out)).toEqual(['personal', 'personal', 'personal', 'personal', 'personal']);
    expect(renderToStaticMarkup(<FoulBoxes line={{ pf: 3, tf: 2 }} />)).toContain('FOULED OUT'); // 5 total
    const ej = renderToStaticMarkup(<FoulBoxes line={{ pf: 0, tf: 2 }} />);
    expect(ej).toContain('EJECTED');
    expect(ej).not.toContain('FOULED OUT');
  });

  test('card boxes come from the WHOLE-GAME line even when the view is a single period', () => {
    const periodLine = { ...emptyLine(), pf: 0, tf: 0 }; // this quarter: no fouls
    const gameLine = { ...emptyLine(), pf: 4, tf: 0 };
    const m = render({ selected: true, line: periodLine, gameLine });
    expect(boxes(m)).toEqual(['personal', 'personal', 'personal', 'personal', 'empty']);
    expect(m).toContain('4/5');
  });

  test('foul buttons are disabled at the limits, with a reason', () => {
    // Match the real attribute (disabled=""), not Tailwind's "disabled:" class variants.
    const disabled = (m: string, a: string) => {
      const tag = new RegExp(`<button[^>]*data-action="${a}"[^>]*>`).exec(m)?.[0] ?? '';
      return / disabled=""/.test(tag);
    };
    const ok = render({ selected: true, gameLine: { ...emptyLine(), pf: 4, tf: 0 } });
    expect(disabled(ok, 'foul')).toBe(false);
    expect(disabled(ok, 'tech')).toBe(false);

    const dq = render({ selected: true, gameLine: { ...emptyLine(), pf: 5, tf: 0 } });
    expect(disabled(dq, 'foul')).toBe(true);
    expect(disabled(dq, 'tech')).toBe(true); // technicals count toward the 5 too
    expect(dq).toContain('title="Fouled out (5 fouls)"');

    const ej = render({ selected: true, gameLine: { ...emptyLine(), pf: 1, tf: 2 } });
    expect(disabled(ej, 'tech')).toBe(true);
    expect(disabled(ej, 'foul')).toBe(true); // ejected: no more fouls of any kind
    expect(ej).toContain('title="Ejected (2 technicals)"');
    expect(disabled(render({ selected: true, gameLine: { ...emptyLine(), pf: 0, tf: 1 } }), 'tech')).toBe(false);
  });
});

describe('TeamFoulsStrip', () => {
  const strip = (over: Partial<React.ComponentProps<typeof TeamFoulsStrip>> = {}) =>
    renderToStaticMarkup(
      <TeamFoulsStrip byPeriod={{ 1: 3, 2: 5, 3: 0 }} currentPeriod={2} label={(p) => (p <= 4 ? `Q${p}` : `OT${p - 4}`)}
        bonusCount={5} bonusAt={5} inBonus={false} {...over} />,
    );

  test('shows every quarter with its count and highlights the current one', () => {
    const m = strip();
    const chips = [...m.matchAll(/data-period="(\d)"[^>]*>.*?<div class="font-bold">(\d+)<\/div>/g)].map((x) => [x[1], x[2]]);
    expect(chips).toEqual([['1', '3'], ['2', '5'], ['3', '0'], ['4', '0']]); // always at least Q1-Q4
    expect(m).toMatch(/data-period="2" class="[^"]*bg-sky-700/);
    expect(m).toMatch(/Q2:.*5.*\/5/);
  });

  test('BONUS lamp only when the opponent reached the limit', () => {
    expect(strip({ inBonus: false })).not.toContain('IN BONUS');
    expect(strip({ inBonus: true })).toContain('IN BONUS');
  });

  test('overtime adds a column', () => {
    const m = strip({ byPeriod: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 1 }, currentPeriod: 5 });
    expect(m).toContain('OT1');
    expect((m.match(/data-period=/g) ?? []).length).toBe(5);
  });
});

describe('player shots button and locked mode', () => {
  test('the target button only exists when a handler is supplied', () => {
    expect(render()).not.toContain('data-player-shots');
    expect(render({ onShots: () => {} })).toContain(`data-player-shots="${player.id}"`);
  });
  test('it reflects whether this player\u2019s shots are on the court', () => {
    expect(render({ onShots: () => {}, shotsActive: true })).toMatch(/aria-pressed="true"[^>]*data-player-shots|data-player-shots[^>]*aria-pressed="true"/);
    expect(render({ onShots: () => {}, shotsActive: false })).toContain('aria-pressed="false"');
    expect(render({ onShots: () => {}, shotsActive: true })).toContain('click for everyone');
  });
  test('locked (game ended): no stat grid, no quick buttons, but the stat lines and shots button remain', () => {
    const m = render({ selected: true, quick: ['dreb'], locked: true, onShots: () => {} });
    expect(m).not.toContain('data-action=');
    expect(m).not.toContain('data-quick=');
    expect(m).toContain('REB 5');
    expect(m).toContain('data-player-shots');
    expect(m).toContain('data-part="fouls"');
  });
  test('not locked: unchanged', () => {
    const m = render({ selected: true, quick: ['dreb'] });
    expect(m).toContain('data-action="foul"');
    expect(m).toContain('data-quick="dreb"');
  });
});

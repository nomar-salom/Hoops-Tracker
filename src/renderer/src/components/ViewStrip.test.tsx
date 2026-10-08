import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ViewStrip } from './ViewStrip';

const label = (p: number) => (p <= 4 ? `Q${p}` : `OT${p - 4}`);
const render = (over: Partial<React.ComponentProps<typeof ViewStrip>> = {}) =>
  renderToStaticMarkup(<ViewStrip periods={[1, 2, 3]} live={3} view="game" label={label} onView={() => {}} {...over} />);
const views = (m: string) => [...m.matchAll(/data-view="(\w+)"/g)].map((x) => x[1]);

describe('ViewStrip', () => {
  test('Game plus every period that exists, in order', () => {
    expect(views(render())).toEqual(['game', '1', '2', '3']);
    expect(views(render({ periods: [1, 2, 3, 4, 5] }))).toEqual(['game', '1', '2', '3', '4', '5']);
    expect(render({ periods: [1, 2, 3, 4, 5] })).toContain('OT1');
  });

  test('exactly one button is pressed: the one being viewed', () => {
    const pressed = (m: string) => [...m.matchAll(/aria-pressed="true"[^>]*data-view="(\w+)"/g)].map((x) => x[1]);
    expect(pressed(render({ view: 'game' }))).toEqual(['game']);
    expect(pressed(render({ view: 2 }))).toEqual(['2']);
  });

  test('the live period is marked, and only while the game is live', () => {
    const live = render({ live: 3 });
    expect((live.match(/aria-label="live"/g) ?? []).length).toBe(1);
    expect(live).toMatch(/data-view="3"[^>]*data-live="true"/);
    expect(live).toContain('(the period being recorded)');
    expect(render({ ended: true })).not.toContain('aria-label="live"');
  });

  test('viewing a past period is distinct from the live one', () => {
    const m = render({ view: 1, live: 3 });
    expect(m).toMatch(/aria-pressed="true"[^>]*data-view="1"/);
    expect(m).toMatch(/data-view="3"[^>]*data-live="true"/);
  });

  test('has an accessible group name', () => {
    expect(render()).toContain('aria-label="View"');
  });
});

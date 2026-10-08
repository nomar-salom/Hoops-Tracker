import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameSummary } from './GameSummary';
import { sampleGame } from '@shared/fixtures';

// sampleGame: Home 4 (h1 3PT + h3 FT) | Away 5 (a1 2PT + a2 3PT in Q5) | periods Q1..Q5 | techs/fouls
const g = sampleGame();
const render = (over: Partial<React.ComponentProps<typeof GameSummary>> = {}) =>
  renderToStaticMarkup(<GameSummary game={g} activePlayerId={null} onShowPlayerShots={() => {}} open={false} {...over} />);

describe('GameSummary', () => {
  test('line score: a column per period (including overtime) and the final', () => {
    const m = render();
    const table = m.slice(m.indexOf('data-part="line-score"'), m.indexOf('</table>', m.indexOf('data-part="line-score"')));
    for (const h of ['Q1', 'Q2', 'Q3', 'Q4', 'OT1', 'Final']) expect(table).toContain(`>${h}<`);
    expect(table).toMatch(/Home<\/td>.*>3<\/td>.*>1<\/td>.*<td[^>]*>4<\/td>/s); // Q1 3, Q3.. , final 4
    expect(table).toMatch(/Away.*>5<\/td>\s*<\/tr>/s);
  });

  test('one shooting row per player, with points and FG', () => {
    const m = render();
    expect((m.match(/data-summary-player=/g) ?? []).length).toBe(5); // 3 home + 2 away
    const row = (id: string) => m.slice(m.indexOf(`data-summary-player="${id}"`), m.indexOf('</tr>', m.indexOf(`data-summary-player="${id}"`)));
    expect(row('h1')).toContain('>3<');           // 3 pts
    expect(row('h1')).toContain('1-1');           // FG
    expect(row('a2')).toContain('1-1');           // 3P
  });

  test('the Shots button is disabled for a player who took no shots', () => {
    const m = render();
    const btn = (id: string) => new RegExp(`<button[^>]*data-show-shots="${id}"[^>]*>`).exec(m)![0];
    expect(btn('h1')).not.toContain(' disabled=""');   // h1 shot once
    expect(btn('h3')).toContain(' disabled=""');       // h3 only shot free throws
  });

  test('the active player is highlighted and pressed', () => {
    const m = render({ activePlayerId: 'a1' });
    expect(m).toMatch(/data-summary-player="a1"/);
    const tr = (id: string, html: string) => new RegExp(`<tr[^>]*data-summary-player="${id}"[^>]*>`).exec(html)![0];
    expect(tr('a1', m)).toContain('bg-sky-900/40');
    expect(tr('h1', m)).not.toContain('bg-sky-900/40');
    expect(/<button[^>]*data-show-shots="a1"[^>]*>/.exec(m)![0]).toContain('aria-pressed="true"');
    expect(/<button[^>]*data-show-shots="h1"[^>]*>/.exec(render({ activePlayerId: 'a1' }))![0]).toContain('aria-pressed="false"');
  });

  test('open only when asked (review mode)', () => {
    expect(render({ open: true })).toMatch(/<details open=""/);
    expect(render({ open: false })).not.toMatch(/<details open/);
  });
});

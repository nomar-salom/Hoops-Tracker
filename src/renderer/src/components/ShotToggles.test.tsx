import { beforeEach, describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ShotToggles } from './ShotToggles';
import { useUi } from '../ui';

const teams = [
  { name: 'Home', color: '#1d4ed8', made: 5, attempts: 11 },
  { name: 'Away', color: '#dc2626', made: 0, attempts: 0 },
] as const;
const render = (visible: [boolean, boolean]) =>
  renderToStaticMarkup(<ShotToggles teams={[teams[0], teams[1]]} visible={visible} onToggle={() => {}} />);

describe('ShotToggles', () => {
  test('one button per team with its made/attempted count', () => {
    const m = render([true, true]);
    expect((m.match(/data-shot-toggle=/g) ?? []).length).toBe(2);
    expect(m).toContain('Home');
    expect(m).toContain('>5/11<');
    expect(m).toContain('>0/0<');
  });

  test('pressed state is exposed to assistive tech and styling', () => {
    const both = render([true, true]);
    expect((both.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
    const oneOff = render([true, false]);
    expect(oneOff).toMatch(/aria-pressed="true"[^>]*data-shot-toggle="0"|data-shot-toggle="0"[^>]*aria-pressed="true"/);
    expect(oneOff).toMatch(/aria-pressed="false"[^>]*data-shot-toggle="1"|data-shot-toggle="1"[^>]*aria-pressed="false"/);
    expect(oneOff).toContain('data-on="false"');
  });

  test('titles say what a click will do and name the shortcut', () => {
    expect(render([true, false])).toContain('title="Hide Home shots (Shift+H)"');
    expect(render([true, false])).toContain('title="Show Away shots (Shift+A)"');
  });

  test('a hidden team keeps showing its count (so you know what you are hiding)', () => {
    expect(render([false, true])).toContain('>5/11<');
  });
});

describe('ui store: shot visibility', () => {
  beforeEach(() => useUi.setState({ showShots: [true, true] }));

  test('both teams start visible', () => {
    expect(useUi.getState().showShots).toEqual([true, true]);
  });
  test('toggling one team leaves the other alone and returns the new state', () => {
    expect(useUi.getState().toggleShots(0)).toBe(false);
    expect(useUi.getState().showShots).toEqual([false, true]);
    expect(useUi.getState().toggleShots(1)).toBe(false);
    expect(useUi.getState().showShots).toEqual([false, false]);
    expect(useUi.getState().toggleShots(0)).toBe(true);
    expect(useUi.getState().showShots).toEqual([true, false]);
  });
  test('setShowShots is explicit and idempotent', () => {
    useUi.getState().setShowShots(1, false);
    useUi.getState().setShowShots(1, false);
    expect(useUi.getState().showShots).toEqual([true, false]);
    useUi.getState().setShowShots(1, true);
    expect(useUi.getState().showShots).toEqual([true, true]);
  });
});

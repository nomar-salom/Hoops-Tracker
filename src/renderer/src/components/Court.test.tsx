import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Court, courtToPercent, MARGIN_FT } from './Court';

const html = (props: Partial<React.ComponentProps<typeof Court>> = {}) =>
  renderToStaticMarkup(<Court courtType="nfhs" shots={[]} {...props} />);
const count = (markup: string, part: string) => (markup.match(new RegExp(`data-part="${part}"`, 'g')) ?? []).length;

describe('Court (high school)', () => {
  const markup = html();

  test('draws the lane ("the box") at both ends', () => {
    expect(count(markup, 'lane')).toBe(2);
    expect(count(markup, 'lane-lines')).toBe(2);
  });
  test('draws a free-throw line, solid + dashed semicircle at both ends', () => {
    expect(count(markup, 'free-throw-line')).toBe(2);
    expect(count(markup, 'free-throw-arc')).toBe(2);
    expect(count(markup, 'free-throw-arc-dashed')).toBe(2);
  });
  test('draws the lane hash marks: 1 neutral block + 3 marks per side, both ends', () => {
    expect(count(markup, 'lane-neutral-zone')).toBe(4);
    expect(count(markup, 'lane-space-mark')).toBe(12);
  });
  test('draws 3-point lines, centre circle, division line, boundary, backboards and rims', () => {
    expect(count(markup, 'three-point-line')).toBe(2);
    expect(count(markup, 'center-circle')).toBe(1);
    expect(count(markup, 'division-line')).toBe(1);
    expect(count(markup, 'boundary')).toBe(1);
    expect(count(markup, 'backboard')).toBe(2);
    expect(count(markup, 'rim')).toBe(2);
  });
  test('is an 84 x 50 ft court plus margin', () => {
    expect(markup).toContain(`viewBox="-3 -3 90 56"`);
  });
  test('renders made and missed markers and ghost/pending overlays', () => {
    const m = html({
      shots: [
        { id: 'a', x: 0.5, y: 0.5, made: true, color: '#00f' },
        { id: 'b', x: 0.2, y: 0.3, made: false, color: '#f00' },
      ],
      preview: { x: 0.7, y: 0.5, points: 3, nearLine: false, color: '#00f' },
      pending: { x: 0.9, y: 0.5, points: 2, nearLine: true, color: '#00f' },
    });
    expect(m).toContain('data-made="true"');
    expect(m).toContain('data-made="false"');
    expect(m).toContain('3PT');
    expect(m).toContain('2PT (near line)');
  });
});

test('courtToPercent maps court corners inside the margin', () => {
  const tl = courtToPercent('nfhs', { x: 0, y: 0 });
  expect(tl.left).toBeCloseTo((MARGIN_FT / 90) * 100);
  expect(courtToPercent('nfhs', { x: 1, y: 1 })).toEqual({ left: (87 / 90) * 100, top: (53 / 56) * 100 });
});

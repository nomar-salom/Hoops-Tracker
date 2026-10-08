import { describe, expect, test } from 'vitest';
import { COURTS } from './court';
import { MARKINGS, endMarkings } from './courtMarkings';

describe('NFHS markings (from the rulebook)', () => {
  const m = MARKINGS.nfhs;
  const e = endMarkings('nfhs');

  test('lane is 12 ft wide and runs 19 ft from the end line to the OUTSIDE of the free-throw line', () => {
    expect(e.lanePaint).toEqual({ x: 0, y: 19, w: 19, h: 12 });
  });
  test('free-throw line is 15 ft from the face of the backboard, 12 ft long', () => {
    expect(m.freeThrowLineFt - m.backboardFromBaselineFt).toBe(15);
    expect(e.freeThrowLine.y2 - e.freeThrowLine.y1).toBe(12);
  });
  test('free-throw circle and centre circle are 6 ft radius; lines are 2 in wide', () => {
    expect(m.freeThrowCircleRadiusFt).toBe(6);
    expect(m.centerCircleRadiusFt).toBe(6);
    expect(m.lineWidthFt).toBeCloseTo(2 / 12);
  });
  test('rim centre is 5\'3" from the end line; backboard is 72 in wide', () => {
    expect(e.rim.cx).toBe(5.25);
    expect(m.backboardWidthFt * 12).toBe(72);
  });
  test('lane-space marks: a 12x8 in neutral block plus three 2x8 in marks, on both sides', () => {
    const neutral = e.laneMarks.filter((k) => k.kind === 'neutral');
    const spaces = e.laneMarks.filter((k) => k.kind === 'space');
    expect(neutral).toHaveLength(2);
    expect(spaces).toHaveLength(6); // 3 per side => "three lane spaces on each lane boundary"
    expect(neutral[0]).toMatchObject({ x: 7, w: 1 });
    expect(neutral[0]!.h * 12).toBeCloseTo(8);
    expect(spaces[0]!.w * 12).toBeCloseTo(2);
    expect(spaces.map((k) => k.x).filter((_, i) => i % 2 === 0)).toEqual([11, 14, 17]);
  });
  test('marks sit OUTSIDE the lane on both sides', () => {
    for (const k of e.laneMarks) {
      const aboveLane = k.y + k.h <= 19 + 1e-9; // lane spans y = 19..31
      const belowLane = k.y >= 31 - 1e-9;
      expect(aboveLane || belowLane).toBe(true);
    }
  });
  test('the drawn 3-point boundary and the classifier agree on the same spec', () => {
    expect(COURTS.nfhs.threePointRadiusFt).toBe(19.75);
    expect(COURTS.nfhs.cornerThreeFromCenterFt).toBe(19.75);
  });
});

test('every court type produces markings', () => {
  for (const t of ['nfhs', 'ncaa', 'nba', 'fiba'] as const) {
    const e = endMarkings(t);
    expect(e.lanePaint.w).toBeGreaterThan(18);
    expect(e.rim.cx).toBeGreaterThan(5);
  }
});

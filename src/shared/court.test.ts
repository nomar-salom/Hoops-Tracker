import { describe, expect, test } from 'vitest';
import {
  COURTS, basketNormalized, classifyShot, distanceToBasketFt, threePointLinePath,
  toAttackRightFrame, toFeet, toHalfCourtFrame, type CourtSpec,
} from './court';

const nba = COURTS.nba;
/** Normalized point from feet. */
const n = (fx: number, fy: number, spec: CourtSpec = nba) => ({ x: fx / spec.lengthFt, y: fy / spec.widthFt });
const cls = (fx: number, fy: number, right = true, spec: CourtSpec = nba) => {
  const p = n(fx, fy, spec);
  return classifyShot(p.x, p.y, right, spec);
};
const BX = nba.lengthFt - nba.basketFromBaselineFt; // 88.75, right basket

describe('specs', () => {
  test.each(Object.entries(COURTS))('%s spec is internally consistent', (_k, s) => {
    expect(s.cornerThreeFromCenterFt).toBeLessThanOrEqual(s.threePointRadiusFt);
    expect(s.cornerThreeFromCenterFt).toBeLessThan(s.widthFt / 2);
    expect(s.basketFromBaselineFt).toBeLessThan(s.lengthFt / 2);
  });
});

describe('basket & distance', () => {
  test('basket positions', () => {
    expect(basketNormalized(true, nba).x).toBeCloseTo(88.75 / 94);
    expect(basketNormalized(false, nba).x).toBeCloseTo(5.25 / 94);
    expect(basketNormalized(true, nba).y).toBe(0.5);
  });
  test('distance uses feet, not normalized units', () => {
    // 10 ft straight out from the right basket
    const p = n(BX - 10, 25);
    expect(distanceToBasketFt(p.x, p.y, true)).toBeCloseTo(10);
    // 10 ft to the side: differently scaled axis, same distance
    const q = n(BX, 15);
    expect(distanceToBasketFt(q.x, q.y, true)).toBeCloseTo(10);
  });
});

describe('classifyShot (NBA)', () => {
  test('layup and mid-range are 2s', () => {
    expect(cls(BX + 2, 25).points).toBe(2);
    expect(cls(BX - 15, 25).points).toBe(2);
  });
  test('top of the arc: just inside is 2, just outside is 3', () => {
    expect(cls(BX - 23, 25).points).toBe(2);
    expect(cls(BX - 24, 25).points).toBe(3);
  });
  test('exactly on the arc is a 2', () => {
    const c = cls(BX - nba.threePointRadiusFt, 25);
    expect(c.points).toBe(2);
    expect(Math.abs(c.marginFt)).toBeLessThan(1e-6);
  });
  test('corner three: lateral distance beyond 22 ft is a 3, inside is a 2', () => {
    expect(cls(nba.lengthFt - 1, 25 - 24).points).toBe(3); // 24 ft off centre
    expect(cls(nba.lengthFt - 1, 25 - 20).points).toBe(2); // 20 ft off centre
    expect(cls(nba.lengthFt - 1, 25 + 24).points).toBe(3); // symmetric
  });
  test('exactly on the corner line is a 2', () => {
    expect(cls(nba.lengthFt - 1, 25 - 22).points).toBe(2);
  });
  test('near the arc/corner junction, arc governs', () => {
    // 21.9 ft lateral (inside corner line), 10 ft up-court from basket: dist ~24.07 > 23.75
    expect(cls(BX - 10, 25 - 21.9).points).toBe(3);
    // 21.9 ft lateral, 5 ft up-court: dist ~22.5 < 23.75
    expect(cls(BX - 5, 25 - 21.9).points).toBe(2);
  });
  test('nearLine flags shots within 1 ft of the line', () => {
    expect(cls(BX - 23.5, 25).nearLine).toBe(true);
    expect(cls(BX - 20, 25).nearLine).toBe(false);
    expect(cls(BX - 30, 25).nearLine).toBe(false);
  });
  test('half-court heave is a 3', () => {
    expect(cls(47, 25).points).toBe(3);
  });
});

describe('direction symmetry', () => {
  test('left basket mirrors the right', () => {
    // Same physical situation mirrored: (fx,fy) attacking right == (L-fx, W-fy) attacking left
    for (const [fx, fy] of [[65, 25], [64, 25], [93, 3], [93, 10], [80, 5], [70, 40]] as const) {
      const r = cls(fx, fy, true);
      const l = cls(nba.lengthFt - fx, nba.widthFt - fy, false);
      expect(l.points).toBe(r.points);
      expect(l.distanceFt).toBeCloseTo(r.distanceFt);
    }
  });
  test('grid sweep: rotation invariance for every court', () => {
    for (const spec of Object.values(COURTS)) {
      for (let x = 0; x <= 1; x += 0.05) {
        for (let y = 0; y <= 1; y += 0.05) {
          const a = classifyShot(x, y, true, spec);
          const b = classifyShot(1 - x, 1 - y, false, spec);
          expect(b.points).toBe(a.points);
        }
      }
    }
  });
});

describe('other courts', () => {
  test('NFHS: 19\'9" arc, no separate corner break', () => {
    const s = COURTS.nfhs;
    const bx = s.lengthFt - s.basketFromBaselineFt;
    expect(cls(bx - 19, 25, true, s).points).toBe(2);
    expect(cls(bx - 20.5, 25, true, s).points).toBe(3);
    expect(cls(s.lengthFt - 1, 25 - 21, true, s).points).toBe(3); // beyond 19.75 lateral
    expect(cls(s.lengthFt - 1, 25 - 18, true, s).points).toBe(2);
  });
  test('FIBA uses its own smaller court', () => {
    const s = COURTS.fiba;
    const bx = s.lengthFt - s.basketFromBaselineFt;
    expect(cls(bx - 21.5, s.widthFt / 2, true, s).points).toBe(2); // < 6.75 m
    expect(cls(bx - 22.8, s.widthFt / 2, true, s).points).toBe(3);
  });
  test('NCAA arc is shorter than NBA', () => {
    const s = COURTS.ncaa;
    const bx = s.lengthFt - s.basketFromBaselineFt;
    expect(cls(bx - 23, 25, true, s).points).toBe(3);
    expect(cls(bx - 23, 25, true, nba).points).toBe(2);
  });
});

describe('frames for heat maps', () => {
  test('toAttackRightFrame rotates left-attacking shots 180°', () => {
    expect(toAttackRightFrame(0.2, 0.3, true)).toEqual({ x: 0.2, y: 0.3 });
    const p = toAttackRightFrame(0.2, 0.3, false);
    expect(p.x).toBeCloseTo(0.8);
    expect(p.y).toBeCloseTo(0.7);
  });
  test('toHalfCourtFrame maps the attacked half to 0..1', () => {
    expect(toHalfCourtFrame(1, 0.5, true)).toEqual({ x: 1, y: 0.5 });
    expect(toHalfCourtFrame(0.5, 0.5, true).x).toBe(0);
    expect(toHalfCourtFrame(0, 0.5, false).x).toBe(1);
    expect(toHalfCourtFrame(0.25, 0.5, true).x).toBeLessThan(0); // backcourt
  });
  test('toFeet', () => {
    expect(toFeet(0.5, 0.5, nba)).toEqual({ x: 47, y: 25 });
  });
});

describe('threePointLinePath', () => {
  test('NBA right side starts and ends on the baseline at the corner lines', () => {
    const d = threePointLinePath('right', nba);
    expect(d.startsWith('M 94 3 H')).toBe(true); // 25 - 22
    expect(d.endsWith('H 94')).toBe(true);
    expect(d).toContain('A 23.75 23.75 0 0 0');
    expect(d).toContain('79.8'); // 88.75 - sqrt(23.75^2 - 22^2)=79.80
  });
  test('left side mirrors it', () => {
    const d = threePointLinePath('left', nba);
    expect(d.startsWith('M 0 3 H')).toBe(true);
    expect(d).toContain('A 23.75 23.75 0 0 1');
  });
});

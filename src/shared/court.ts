import type { CourtType } from './types';

/**
 * Court geometry. All lengths are in FEET.
 *
 * Shot coordinates are stored normalized (x: 0..1 along the length, y: 0..1
 * across the width), which is NOT square, so every distance calculation must
 * convert to feet first (see toFeet).
 *
 * Verify the numbers below against your league's rulebook before relying on
 * them; they are plain data, so fixing one is a one-line change.
 */
export interface CourtSpec {
  label: string;
  lengthFt: number;
  widthFt: number;
  /** Baseline to the centre of the basket. */
  basketFromBaselineFt: number;
  /** Radius of the three-point arc, measured from the centre of the basket. */
  threePointRadiusFt: number;
  /**
   * Lateral distance from the court's centre line to the straight corner
   * segment. Set equal to the radius for courts with no straight-to-arc break
   * (the arc then runs straight into parallel lines at the arc's full width).
   */
  cornerThreeFromCenterFt: number;
}

const fromMeters = (m: number) => m / 0.3048;

export const COURTS: Record<CourtType, CourtSpec> = {
  nba: {
    label: 'NBA',
    lengthFt: 94,
    widthFt: 50,
    basketFromBaselineFt: 5.25,
    threePointRadiusFt: 23.75,
    cornerThreeFromCenterFt: 22,
  },
  ncaa: {
    label: 'NCAA',
    lengthFt: 94,
    widthFt: 50,
    basketFromBaselineFt: 5.25,
    threePointRadiusFt: 22 + 1.75 / 12, // 22' 1.75"
    cornerThreeFromCenterFt: 21 + 8 / 12, // 21' 8"
  },
  fiba: {
    label: 'FIBA',
    lengthFt: fromMeters(28),
    widthFt: fromMeters(15),
    basketFromBaselineFt: fromMeters(1.575),
    threePointRadiusFt: fromMeters(6.75),
    cornerThreeFromCenterFt: fromMeters(7.5 - 0.9), // line is 0.90 m from the sideline
  },
  nfhs: {
    label: 'High School (NFHS)',
    lengthFt: 84,
    widthFt: 50,
    basketFromBaselineFt: 5.25,
    threePointRadiusFt: 19.75,
    cornerThreeFromCenterFt: 19.75,
  },
};

/** Floating-point tolerance so a click computed to be exactly on the line is a 2. */
const EPS = 1e-9;

/** Default distance (ft) within which the UI should flag a shot as "close to the line". */
export const NEAR_LINE_FT = 1.0;

export interface Point {
  x: number;
  y: number;
}

/** Normalized (0..1) court position -> feet from the left baseline / top sideline. */
export function toFeet(x: number, y: number, spec: CourtSpec): Point {
  return { x: x * spec.lengthFt, y: y * spec.widthFt };
}

/** Basket centre in feet. */
export function basketFt(attackingRight: boolean, spec: CourtSpec): Point {
  return {
    x: attackingRight ? spec.lengthFt - spec.basketFromBaselineFt : spec.basketFromBaselineFt,
    y: spec.widthFt / 2,
  };
}

/** Basket centre in normalized coordinates (for drawing). */
export function basketNormalized(attackingRight: boolean, spec: CourtSpec): Point {
  const b = basketFt(attackingRight, spec);
  return { x: b.x / spec.lengthFt, y: b.y / spec.widthFt };
}

export function distanceToBasketFt(
  x: number,
  y: number,
  attackingRight: boolean,
  spec: CourtSpec = COURTS.nba,
): number {
  const p = toFeet(x, y, spec);
  const b = basketFt(attackingRight, spec);
  return Math.hypot(p.x - b.x, p.y - b.y);
}

export interface ShotClassification {
  points: 2 | 3;
  distanceFt: number;
  /**
   * Signed distance (ft) to the three-point line: positive = beyond it (a 3),
   * negative = inside it, ~0 = on the line.
   */
  marginFt: number;
  /** True when the click is within `nearLineFt` of the line, so the UI can ask for confirmation. */
  nearLine: boolean;
}

/**
 * Decide whether a shot taken from (x, y) at the basket being attacked is a
 * two or a three.
 *
 * The three-point region is the union of:
 *  - everything farther than the arc radius from the basket, and
 *  - everything lateral of the straight corner lines.
 * A shooter standing ON the line has not shot a three, so exactly-on-the-line is a 2.
 */
export function classifyShot(
  x: number,
  y: number,
  attackingRight: boolean,
  spec: CourtSpec = COURTS.nba,
  nearLineFt: number = NEAR_LINE_FT,
): ShotClassification {
  const p = toFeet(x, y, spec);
  const b = basketFt(attackingRight, spec);
  const dist = Math.hypot(p.x - b.x, p.y - b.y);
  const lateral = Math.abs(p.y - b.y);

  const marginFt = Math.max(dist - spec.threePointRadiusFt, lateral - spec.cornerThreeFromCenterFt);
  return {
    points: marginFt > EPS ? 3 : 2,
    distanceFt: dist,
    marginFt,
    nearLine: Math.abs(marginFt) <= nearLineFt,
  };
}

/**
 * Rotate a shot 180° so every shot looks like it was taken attacking the RIGHT
 * basket. Rotation (not mirroring) keeps the shooter's left/right side correct.
 * Use for team heat maps that overlay all periods on one half court.
 */
export function toAttackRightFrame(x: number, y: number, attackingRight: boolean): Point {
  return attackingRight ? { x, y } : { x: 1 - x, y: 1 - y };
}

/**
 * Map onto the attacked half court: x runs 0 (midcourt) to 1 (baseline), y 0..1.
 * Backcourt shots come out with negative x; the UI can clip or ignore them.
 */
export function toHalfCourtFrame(x: number, y: number, attackingRight: boolean): Point {
  const p = toAttackRightFrame(x, y, attackingRight);
  return { x: (p.x - 0.5) * 2, y: p.y };
}

/**
 * SVG path (in FEET, viewBox 0 0 lengthFt widthFt) for the three-point line at
 * one end of the court. Draw both so the picture matches classifyShot exactly.
 */
export function threePointLinePath(side: 'left' | 'right', spec: CourtSpec, inset = 0): string {
  // The rules measure to the OUTSIDE edge of the line. To draw a line of width w
  // with its outside edge on that boundary, stroke along the centre: inset = w / 2.
  const R = spec.threePointRadiusFt - inset;
  const c = spec.cornerThreeFromCenterFt - inset;
  const cy = spec.widthFt / 2;
  const k = Math.sqrt(Math.max(0, R * R - c * c)); // basket -> arc/corner junction, along the length
  const f = (n: number) => +n.toFixed(3);

  if (side === 'right') {
    const bx = spec.lengthFt - spec.basketFromBaselineFt;
    const ax = bx - k;
    return `M ${f(spec.lengthFt)} ${f(cy - c)} H ${f(ax)} A ${f(R)} ${f(R)} 0 0 0 ${f(ax)} ${f(cy + c)} H ${f(spec.lengthFt)}`;
  }
  const bx = spec.basketFromBaselineFt;
  const ax = bx + k;
  return `M 0 ${f(cy - c)} H ${f(ax)} A ${f(R)} ${f(R)} 0 0 1 ${f(ax)} ${f(cy + c)} H 0`;
}

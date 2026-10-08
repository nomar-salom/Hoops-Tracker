import type { CourtType } from './types';
import { COURTS } from './court';

/**
 * Visible court markings, in FEET, for drawing. Kept separate from CourtSpec
 * (which only has what the 2-vs-3 decision needs).
 *
 * SOURCES: the NFHS values are from NFHS Rule 1 (Figure 1-1) and the published
 * court-marking specs: lines 2" wide; lane 12' wide measured to the OUTSIDE of
 * the lane lines; free-throw line 15' from the face of the backboard (= 19' from
 * the end line) to its outside edge; free-throw semicircle and centre circle
 * 6' radius to the outside edge; backboard 72" wide, 4' from the end line;
 * lane-space marks 2" x 8" and a 12" x 8" neutral-zone block.
 * NCAA reuses the NFHS lane layout. NBA and FIBA values are approximations
 * for illustration only and have not been checked against those rulebooks.
 */
const IN = 1 / 12;

export interface LaneMark {
  kind: 'neutral' | 'space';
  /** End line to the nearer edge of the mark. */
  fromBaselineFt: number;
  /** Size along the lane. */
  lengthFt: number;
  /** How far the mark extends outward from the outer edge of the lane line. */
  outFt: number;
}

export interface CourtMarkings {
  lineWidthFt: number;
  laneWidthFt: number;
  /** End line to the OUTSIDE edge of the free-throw line. */
  freeThrowLineFt: number;
  freeThrowCircleRadiusFt: number;
  centerCircleRadiusFt: number;
  backboardFromBaselineFt: number;
  backboardWidthFt: number;
  rimRadiusFt: number;
  laneMarks: LaneMark[];
}

const NCAA_LANE_MARKS: LaneMark[] = [
  { kind: 'neutral', fromBaselineFt: 7, lengthFt: 1, outFt: 8 * IN },
  { kind: 'space', fromBaselineFt: 11, lengthFt: 2 * IN, outFt: 8 * IN },
  { kind: 'space', fromBaselineFt: 14, lengthFt: 2 * IN, outFt: 8 * IN },
  { kind: 'space', fromBaselineFt: 17, lengthFt: 2 * IN, outFt: 8 * IN },
];

const fromMeters = (m: number) => m / 0.3048;

const NFHS: CourtMarkings = {
  lineWidthFt: 2 * IN,
  laneWidthFt: 12,
  freeThrowLineFt: 19,
  freeThrowCircleRadiusFt: 6,
  centerCircleRadiusFt: 6,
  backboardFromBaselineFt: 4,
  backboardWidthFt: 6,
  rimRadiusFt: 0.75, // 18" inside diameter
  laneMarks: NCAA_LANE_MARKS,
};

export const MARKINGS: Record<CourtType, CourtMarkings> = {
  nfhs: NFHS,
  ncaa: { ...NFHS },
  nba: { ...NFHS, laneWidthFt: 16 },
  fiba: {
    ...NFHS,
    laneWidthFt: fromMeters(4.9),
    freeThrowLineFt: fromMeters(5.8),
    freeThrowCircleRadiusFt: fromMeters(1.8),
    centerCircleRadiusFt: fromMeters(1.8),
    backboardFromBaselineFt: fromMeters(1.2),
    backboardWidthFt: fromMeters(1.8),
    laneMarks: [],
  },
};

export interface Rect { x: number; y: number; w: number; h: number }

/** Everything at ONE end of the court, in feet, with the end line at x = 0. Mirror it for the other end. */
export interface EndMarkings {
  lanePaint: Rect;
  /** The two lane lines, as a stroked path (stroke width = lineWidthFt). */
  laneLines: string;
  freeThrowLine: { x1: number; y1: number; x2: number; y2: number };
  /** Semicircle on the court side of the free-throw line (solid). */
  freeThrowArcSolid: string;
  /** Semicircle inside the lane (drawn dashed). */
  freeThrowArcDashed: string;
  laneMarks: (Rect & { kind: LaneMark['kind'] })[];
  backboard: { x1: number; y1: number; x2: number; y2: number };
  rimNeck: { x1: number; y1: number; x2: number; y2: number };
  rim: { cx: number; cy: number; r: number };
}

const f = (n: number) => +n.toFixed(4);

export function endMarkings(type: CourtType): EndMarkings {
  const spec = COURTS[type];
  const m = MARKINGS[type];
  const w = m.lineWidthFt;
  const cy = spec.widthFt / 2;
  const half = m.laneWidthFt / 2;

  // Rules measure to outside edges; stroke along the centre of each 2" line.
  const xFt = m.freeThrowLineFt - w / 2;
  const yTop = cy - half + w / 2;
  const yBot = cy + half - w / 2;
  const r = m.freeThrowCircleRadiusFt - w / 2;

  const marks: EndMarkings['laneMarks'] = [];
  for (const mk of m.laneMarks) {
    marks.push({ kind: mk.kind, x: f(mk.fromBaselineFt), y: f(cy - half - mk.outFt), w: f(mk.lengthFt), h: f(mk.outFt) });
    marks.push({ kind: mk.kind, x: f(mk.fromBaselineFt), y: f(cy + half), w: f(mk.lengthFt), h: f(mk.outFt) });
  }

  const bx = m.backboardFromBaselineFt;
  const rimX = spec.basketFromBaselineFt;
  return {
    lanePaint: { x: 0, y: f(cy - half), w: f(m.freeThrowLineFt), h: f(m.laneWidthFt) },
    laneLines: `M 0 ${f(yTop)} H ${f(xFt)} M 0 ${f(yBot)} H ${f(xFt)}`,
    freeThrowLine: { x1: f(xFt), y1: f(cy - half), x2: f(xFt), y2: f(cy + half) },
    freeThrowArcSolid: `M ${f(xFt)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 0 1 ${f(xFt)} ${f(cy + r)}`,
    freeThrowArcDashed: `M ${f(xFt)} ${f(cy - r)} A ${f(r)} ${f(r)} 0 0 0 ${f(xFt)} ${f(cy + r)}`,
    laneMarks: marks,
    backboard: { x1: f(bx), y1: f(cy - m.backboardWidthFt / 2), x2: f(bx), y2: f(cy + m.backboardWidthFt / 2) },
    rimNeck: { x1: f(bx), y1: f(cy), x2: f(rimX - m.rimRadiusFt), y2: f(cy) },
    rim: { cx: f(rimX), cy: f(cy), r: m.rimRadiusFt },
  };
}

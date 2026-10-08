import { useRef, type PointerEvent } from 'react';
import { COURTS, threePointLinePath } from '@shared/court';
import { MARKINGS, endMarkings } from '@shared/courtMarkings';
import type { CourtType } from '@shared/types';

/** Out-of-bounds margin drawn around the court, in feet. */
export const MARGIN_FT = 3;

const FLOOR = '#e7cf9f';
const OUT_OF_BOUNDS = '#c7ab78';
const LANE_PAINT = '#b9c9e3';
const LINE = '#1e293b';
const AMBER = '#f59e0b';

export interface ShotMarker {
  id: string;
  x: number; // normalized 0..1 (0 = left baseline)
  y: number; // normalized 0..1 (0 = top sideline)
  made: boolean;
  color: string;
  title?: string;
  selected?: boolean;
}

export interface CourtPoint { x: number; y: number }

export interface ShotPreview extends CourtPoint {
  points: 2 | 3;
  nearLine: boolean;
  color: string;
}

export interface CourtProps {
  courtType: CourtType;
  shots: ShotMarker[];
  /** Ghost marker that follows the pointer. */
  preview?: ShotPreview | null;
  /** A click that has been placed but not yet confirmed. */
  pending?: ShotPreview | null;
  interactive?: boolean;
  onHover?: (p: CourtPoint | null) => void;
  onPlot?: (p: CourtPoint) => void;
  onMarkerClick?: (id: string) => void;
}

/** Normalized court position -> percentage inside the SVG box (for HTML overlays such as popovers). */
export function courtToPercent(courtType: CourtType, p: CourtPoint): { left: number; top: number } {
  const { lengthFt, widthFt } = COURTS[courtType];
  return {
    left: ((MARGIN_FT + p.x * lengthFt) / (lengthFt + 2 * MARGIN_FT)) * 100,
    top: ((MARGIN_FT + p.y * widthFt) / (widthFt + 2 * MARGIN_FT)) * 100,
  };
}

export function Court({
  courtType, shots, preview, pending, interactive = true, onHover, onPlot, onMarkerClick,
}: CourtProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const spec = COURTS[courtType];
  const m = MARKINGS[courtType];
  const end = endMarkings(courtType);
  const L = spec.lengthFt;
  const W = spec.widthFt;
  const w = m.lineWidthFt;

  /** Pointer -> normalized court coordinates, or null if outside the playing surface. */
  const toCourt = (e: PointerEvent<SVGElement>): CourtPoint | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = pt.x / L;
    const y = pt.y / W;
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
  };

  // One end is drawn at x = 0; the other is the same thing mirrored about the centre line.
  const renderEnd = (side: 'left' | 'right') => (
    <g key={side} data-end={side} transform={side === 'right' ? `translate(${L} 0) scale(-1 1)` : undefined}>
      <rect data-part="lane" x={end.lanePaint.x} y={end.lanePaint.y}
        width={end.lanePaint.w} height={end.lanePaint.h} fill={LANE_PAINT} />
      {end.laneMarks.map((k, i) => (
        <rect key={i} data-part={k.kind === 'neutral' ? 'lane-neutral-zone' : 'lane-space-mark'}
          x={k.x} y={k.y} width={k.w} height={k.h} fill={LINE} />
      ))}
      <path data-part="lane-lines" d={end.laneLines} stroke={LINE} strokeWidth={w} fill="none" />
      <line data-part="free-throw-line" {...end.freeThrowLine} stroke={LINE} strokeWidth={w} />
      <path data-part="free-throw-arc" d={end.freeThrowArcSolid} stroke={LINE} strokeWidth={w} fill="none" />
      <path data-part="free-throw-arc-dashed" d={end.freeThrowArcDashed} stroke={LINE} strokeWidth={w}
        strokeDasharray="0.6 0.45" fill="none" />
      <line data-part="backboard" {...end.backboard} stroke={LINE} strokeWidth={0.25} strokeLinecap="round" />
      <line {...end.rimNeck} stroke="#c2410c" strokeWidth={0.12} />
      <circle data-part="rim" cx={end.rim.cx} cy={end.rim.cy} r={end.rim.r} fill="none" stroke="#c2410c" strokeWidth={0.2} />
    </g>
  );

  return (
    <svg
      ref={svgRef}
      viewBox={`${-MARGIN_FT} ${-MARGIN_FT} ${L + 2 * MARGIN_FT} ${W + 2 * MARGIN_FT}`}
      className="block w-full h-auto select-none"
      style={{ cursor: interactive ? 'crosshair' : 'default', touchAction: 'none' }}
      role="img"
      aria-label={`${spec.label} basketball court`}
      data-court-type={courtType}
      onPointerMove={interactive ? (e) => onHover?.(toCourt(e)) : undefined}
      onPointerLeave={interactive ? () => onHover?.(null) : undefined}
      onClick={interactive ? (e) => { const p = toCourt(e as unknown as PointerEvent<SVGElement>); if (p) onPlot?.(p); } : undefined}
    >
      <rect x={-MARGIN_FT} y={-MARGIN_FT} width={L + 2 * MARGIN_FT} height={W + 2 * MARGIN_FT} fill={OUT_OF_BOUNDS} />
      <rect data-part="floor" x={0} y={0} width={L} height={W} fill={FLOOR} />

      {renderEnd('left')}
      {renderEnd('right')}

      {/* Boundary, division line, centre circle */}
      <rect data-part="boundary" x={w / 2} y={w / 2} width={L - w} height={W - w} fill="none" stroke={LINE} strokeWidth={w} />
      <line data-part="division-line" x1={L / 2} y1={0} x2={L / 2} y2={W} stroke={LINE} strokeWidth={w} />
      <circle data-part="center-circle" cx={L / 2} cy={W / 2} r={m.centerCircleRadiusFt - w / 2}
        fill="none" stroke={LINE} strokeWidth={w} />

      {/* Three-point line: same spec the 2-vs-3 classifier uses; stroke centred 1" inside the outside edge. */}
      <path data-part="three-point-line" d={threePointLinePath('left', spec, w / 2)} fill="none" stroke={LINE} strokeWidth={w} />
      <path data-part="three-point-line" d={threePointLinePath('right', spec, w / 2)} fill="none" stroke={LINE} strokeWidth={w} />

      {/* Shots */}
      <g data-part="shots">
        {shots.map((s) => {
          const cx = s.x * L;
          const cy = s.y * W;
          return (
            <g key={s.id} data-shot={s.id} data-made={s.made}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
              onClick={(e) => { e.stopPropagation(); onMarkerClick?.(s.id); }}>
              {s.title && <title>{s.title}</title>}
              {s.selected && <circle cx={cx} cy={cy} r={1.5} fill="none" stroke="#0ea5e9" strokeWidth={0.25} />}
              {s.made ? (
                <circle cx={cx} cy={cy} r={0.9} fill={s.color} stroke="#fff" strokeWidth={0.2} />
              ) : (
                <g stroke={s.color} strokeWidth={0.35} strokeLinecap="round">
                  <circle cx={cx} cy={cy} r={0.95} fill="#ffffffaa" stroke="none" />
                  <line x1={cx - 0.65} y1={cy - 0.65} x2={cx + 0.65} y2={cy + 0.65} />
                  <line x1={cx - 0.65} y1={cy + 0.65} x2={cx + 0.65} y2={cy - 0.65} />
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* Ghost + pending marker */}
      {[preview && { p: preview, kind: 'preview' }, pending && { p: pending, kind: 'pending' }].map((o) => {
        if (!o) return null;
        const cx = o.p.x * L;
        const cy = o.p.y * W;
        const ring = o.p.nearLine ? AMBER : o.p.color;
        return (
          <g key={o.kind} data-part={o.kind} pointerEvents="none">
            <circle cx={cx} cy={cy} r={1.1} fill={o.kind === 'pending' ? `${o.p.color}55` : 'none'}
              stroke={ring} strokeWidth={0.28} strokeDasharray={o.kind === 'preview' ? '0.5 0.4' : undefined} />
            {[true, false].map((halo) => (
              <text key={String(halo)} x={cx} y={cy - 1.7} textAnchor="middle" fontSize={1.7} fontWeight={700}
                fill={halo ? 'none' : ring} stroke={halo ? '#fff' : 'none'} strokeWidth={halo ? 0.45 : 0}
                strokeLinejoin="round">
                {o.p.points}PT{o.p.nearLine ? ' (near line)' : ''}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

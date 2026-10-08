export interface ViewStripProps {
  periods: number[];
  /** The period new stats are being recorded in. */
  live: number;
  /** What is being looked at. */
  view: 'game' | number;
  label: (period: number) => string;
  onView: (view: 'game' | number) => void;
  /** An ended game has no "live" period. */
  ended?: boolean;
}

/** Pick what the sidebars and court show: the whole game, or any single period. */
export function ViewStrip({ periods, live, view, label, onView, ended = false }: ViewStripProps) {
  const btn = (on: boolean) =>
    `px-3 py-1.5 text-sm ${on ? 'bg-sky-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`;
  return (
    <div className="flex overflow-hidden rounded ring-1 ring-slate-600" role="group" aria-label="View" data-part="view-strip">
      <button type="button" aria-pressed={view === 'game'} data-view="game" className={btn(view === 'game')}
        title="Show the whole game (V)" onClick={() => onView('game')}>
        Game
      </button>
      {periods.map((p) => {
        const isLive = !ended && p === live;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={view === p}
            data-view={p}
            data-live={isLive}
            className={btn(view === p)}
            title={`Show ${label(p)} only${isLive ? ' (the period being recorded)' : ''}`}
            onClick={() => onView(p)}
          >
            {label(p)}
            {isLive && <span aria-label="live" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle" />}
          </button>
        );
      })}
    </div>
  );
}

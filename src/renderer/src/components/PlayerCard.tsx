import { MAX_FOULS, MAX_TECHNICALS, playerFoulStatus } from '@shared/stats';
import type { Player, StatLine, Team } from '@shared/types';
import { ACTIONS, actionDef, fmt, pctText, type StatAction, type Tone } from '../statActions';

const TONE: Record<Tone, string> = {
  good: 'bg-emerald-700 hover:bg-emerald-600',
  bad: 'bg-rose-700 hover:bg-rose-600',
  neutral: 'bg-slate-600 hover:bg-slate-500',
};

export interface PlayerCardProps {
  team: Team;
  player: Player;
  /** Stats for the sidebar's current view (this period or the whole game). */
  line: StatLine;
  /** Whole-game stats. Fouls always use this: the 5-foul / 2-technical limits are per game. */
  gameLine: StatLine;
  selected: boolean;
  /** One-tap suggestions for this player (rebound / assist / block), already filtered. */
  quick: StatAction[];
  onSelect: () => void;
  onAction: (a: StatAction) => void;
  /** Put this player's shots on the court (the card's target button). */
  onShots?: () => void;
  shotsActive?: boolean;
  /** The game has ended: no stat buttons, no quick actions. */
  locked?: boolean;
}

export function PlayerCard({ team, player, line, gameLine, selected, quick, onSelect, onAction, onShots, shotsActive = false, locked = false }: PlayerCardProps) {
  const fgm = line.fg2m + line.fg3m;
  const fga = line.fg2a + line.fg3a;

  return (
    <li
      data-player={player.id}
      data-selected={selected}
      className="rounded-md bg-slate-700/60"
      style={selected ? { boxShadow: `0 0 0 2px ${team.color}` } : undefined}
    >
      <div className="flex items-start pr-2">
        <button className="flex min-w-0 flex-1 items-center justify-between px-2 pt-2 text-left" onClick={onSelect}>
          <span className="truncate">
            <b className="mr-2 inline-block min-w-8 tabular-nums">#{player.number}</b>
            {player.name}
          </span>
          <span className="text-xl font-bold tabular-nums">
            {line.pts}
            <span className="ml-0.5 text-xs font-normal opacity-60">pts</span>
          </span>
        </button>
        {onShots && (
          <button
            type="button"
            data-player-shots={player.id}
            aria-pressed={shotsActive}
            title={shotsActive ? 'Showing only this player\u2019s shots (click for everyone)' : 'Show only this player\u2019s shots on the court'}
            onClick={onShots}
            className={`mt-2 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm ${shotsActive ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            ◎
          </button>
        )}
      </div>

      <div className="px-2 pt-0.5 text-[11px] leading-4 tabular-nums text-slate-300" data-part="line-1">
        REB {line.reb} · AST {line.ast} · STL {line.stl} · BLK {line.blk} · TO {line.tov}
      </div>
      <div className="px-2 pb-2 text-[11px] leading-4 tabular-nums text-slate-400" data-part="line-2">
        FG {fmt(fgm, fga)} · 2P {fmt(line.fg2m, line.fg2a)} · 3P {fmt(line.fg3m, line.fg3a)} · FT {fmt(line.ftm, line.fta)}
      </div>

      <FoulBoxes line={gameLine} />

      {!locked && quick.length > 0 && (
        <div className="flex gap-1 px-2 pb-2">
          {quick.map((a) => (
            <button
              key={a}
              data-quick={a}
              onClick={() => onAction(a)}
              className="flex-1 rounded bg-amber-500 py-1.5 text-sm font-bold text-slate-900 hover:bg-amber-400"
            >
              + {actionDef(a).label}
            </button>
          ))}
        </div>
      )}

      {selected && !locked && (
        <div className="grid grid-cols-4 gap-1 px-2 pb-2">
          {ACTIONS.map((d) => {
            const l = d.wholeGame ? gameLine : line;
            const blocked = d.blockedReason?.(l) ?? null;
            return (
              <button
                key={d.action}
                data-action={d.action}
                disabled={blocked !== null}
                title={blocked ?? undefined}
                onClick={() => onAction(d.action)}
                className={`rounded py-1 text-center disabled:cursor-not-allowed disabled:opacity-35 ${d.span === 2 ? 'col-span-2' : ''} ${TONE[d.tone]}`}
              >
                <div className="text-[10px] font-semibold uppercase leading-3 opacity-90">{d.label}</div>
                <div className="text-lg font-bold leading-5 tabular-nums">
                  {d.count(l)}
                  {d.limit !== undefined && <span className="text-xs font-normal opacity-70">/{d.limit}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}

/** Compact team totals shown above the roster. */
export function TeamTotalsGrid({ line }: { line: StatLine }) {
  const fgm = line.fg2m + line.fg3m;
  const fga = line.fg2a + line.fg3a;
  const cells: [string, string][] = [
    ['FG', `${fmt(fgm, fga)} ${pctText(fgm, fga)}`],
    ['3P', `${fmt(line.fg3m, line.fg3a)} ${pctText(line.fg3m, line.fg3a)}`],
    ['FT', `${fmt(line.ftm, line.fta)} ${pctText(line.ftm, line.fta)}`],
    ['REB', `${line.reb} (${line.oreb} off)`],
    ['AST', String(line.ast)],
    ['STL', String(line.stl)],
    ['BLK', String(line.blk)],
    ['TO', String(line.tov)],
  ];
  return (
    <dl className="grid grid-cols-4 gap-x-2 gap-y-1 text-[11px]" data-part="team-totals">
      {cells.map(([k, v]) => (
        <div key={k}>
          <dt className="text-slate-400">{k}</dt>
          <dd className="font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Five foul boxes like a paper scorebook: amber = personal, red "T" = technical.
 * Technicals take a box because they count toward the player's 5.
 */
export function FoulBoxes({ line }: { line: Pick<StatLine, 'pf' | 'tf'> }) {
  const st = playerFoulStatus(line);
  const kinds = Array.from({ length: MAX_FOULS }, (_, i) =>
    i < line.pf ? 'personal' : i < line.pf + line.tf ? 'technical' : 'empty');
  return (
    <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px]" data-part="fouls">
      <span className="text-slate-400">Fouls</span>
      <span className="flex gap-0.5">
        {kinds.map((k, i) => (
          <span
            key={i}
            data-foul-box={k}
            className={`flex h-4 w-4 items-center justify-center rounded-sm text-[9px] font-bold ${
              k === 'personal' ? 'bg-amber-400 text-slate-900'
              : k === 'technical' ? 'bg-rose-600 text-white'
              : 'bg-slate-800 ring-1 ring-slate-600'}`}
          >
            {k === 'technical' ? 'T' : ''}
          </span>
        ))}
      </span>
      <span className="tabular-nums text-slate-300">{st.total}/{MAX_FOULS}</span>
      {line.tf > 0 && <span className="tabular-nums text-rose-300">T {line.tf}/{MAX_TECHNICALS}</span>}
      {st.disqualified && <span data-badge="out" className="ml-auto rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">FOULED OUT</span>}
      {!st.disqualified && st.ejected && <span data-badge="out" className="ml-auto rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">EJECTED</span>}
      {!st.out && st.remaining === 1 && <span data-badge="trouble" className="ml-auto rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">foul trouble</span>}
    </div>
  );
}

export interface TeamFoulsStripProps {
  /** Fouls charged in each period (personal + technical). */
  byPeriod: Record<number, number>;
  currentPeriod: number;
  /** Label for a period number, e.g. "Q3" / "OT1". */
  label: (p: number) => string;
  /** Number the bonus is based on (the 4th-quarter count carries into overtime). */
  bonusCount: number;
  bonusAt: number;
  /** The OTHER team has reached the limit, so this team shoots two on common fouls. */
  inBonus: boolean;
}

/** Team fouls per quarter, with a BONUS lamp for the team that is shooting the free throws. */
export function TeamFoulsStrip({ byPeriod, currentPeriod, label, bonusCount, bonusAt, inBonus }: TeamFoulsStripProps) {
  const periods = Object.keys(byPeriod).map(Number).sort((a, b) => a - b);
  const shown = Array.from({ length: Math.max(4, periods.length) }, (_, i) => i + 1);
  return (
    <div className="rounded bg-slate-900/50 px-2 py-1.5" data-part="team-fouls">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wide text-slate-300">Team fouls</span>
        <span className="tabular-nums text-slate-400" title="Fouls reset each quarter; overtime continues the 4th-quarter count">
          {label(currentPeriod)}: <b className={bonusCount >= bonusAt ? 'text-amber-300' : 'text-white'}>{bonusCount}</b>/{bonusAt}
        </span>
        {inBonus && (
          <span data-badge="bonus" className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900"
            title="Opponent has 5+ team fouls this quarter: two free throws on common fouls">
            IN BONUS
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {shown.map((p) => (
          <div key={p} data-period={p}
            className={`flex-1 rounded py-0.5 text-center text-[11px] tabular-nums ${p === currentPeriod ? 'bg-sky-700 text-white' : 'bg-slate-800 text-slate-300'}`}>
            <div className="text-[9px] opacity-70">{label(p)}</div>
            <div className="font-bold">{byPeriod[p] ?? 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

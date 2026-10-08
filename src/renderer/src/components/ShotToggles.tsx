export interface ShotToggleTeam {
  name: string;
  color: string;
  made: number;
  attempts: number;
}

export interface ShotTogglesProps {
  teams: [ShotToggleTeam, ShotToggleTeam];
  visible: [boolean, boolean];
  onToggle: (team: 0 | 1) => void;
}

/** One switch per team: show or hide that team's shots on the court. */
export function ShotToggles({ teams, visible, onToggle }: ShotTogglesProps) {
  const keys = ['Shift+H', 'Shift+A'];
  return (
    <div className="flex items-center gap-2 text-xs" role="group" aria-label="Show shots for" data-part="shot-toggles">
      <span className="text-slate-400">Shots:</span>
      {teams.map((t, i) => {
        const on = visible[i as 0 | 1];
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            data-shot-toggle={i}
            data-on={on}
            title={`${on ? 'Hide' : 'Show'} ${t.name} shots (${keys[i]})`}
            onClick={() => onToggle(i as 0 | 1)}
            className={`flex items-center gap-2 rounded-full px-3 py-1 font-medium ring-1 transition-colors ${
              on ? 'bg-slate-700 text-white ring-slate-500' : 'bg-transparent text-slate-500 ring-slate-700 line-through decoration-slate-600'}`}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: on ? t.color : 'transparent', boxShadow: `inset 0 0 0 2px ${t.color}` }} />
            <span>{t.name}</span>
            <span className="tabular-nums text-slate-300" data-part="count">{t.made}/{t.attempts}</span>
          </button>
        );
      })}
    </div>
  );
}

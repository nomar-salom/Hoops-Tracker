import { useEffect } from 'react';
import { helpGroups } from '../shortcuts';
import { useUi } from '../ui';

const Key = ({ k }: { k: string }) => (
  <kbd className="rounded border border-slate-500 bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-100 shadow-[0_1px_0_#475569]">{k}</kbd>
);

export function ShortcutsDialog() {
  const open = useUi((s) => s.helpOpen);
  const close = () => useUi.getState().setHelpOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?' || e.key === 'F1') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const groups = helpGroups();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-hidden rounded-xl bg-slate-900 p-5 shadow-2xl ring-1 ring-slate-600">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
          <button className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600" onClick={close}>Close (Esc)</button>
        </header>

        <p className="rounded-md bg-sky-900/40 p-3 text-sm text-sky-100">
          <b>The usual flow:</b> press <Key k="←" /> or <Key k="→" /> to pick Home or Away, type the jersey number
          (e.g. <Key k="2" /><Key k="3" />), then a stat key (e.g. <Key k="F" /> for a foul). For a shot, select the
          player, click the court, then <Key k="M" /> or <Key k="X" />.
        </p>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
          {groups.map((g) => (
            <section key={g.title} data-help-group={g.title}>
              <h3 className="mb-1.5 text-sm font-semibold text-slate-300">{g.title}</h3>
              <ul className="flex flex-col gap-1.5">
                {g.rows.map((r) => (
                  <li key={r.keys.join('|') + r.label} className="flex items-start gap-3 text-sm">
                    <span className="flex w-40 shrink-0 flex-wrap gap-1">
                      {r.keys.map((k) => <Key key={k} k={k} />)}
                    </span>
                    <span className="text-slate-300">{r.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          Shortcuts are off while you type in a text box or while a dialog is open. Holding a key records a stat only once.
        </p>
      </div>
    </div>
  );
}

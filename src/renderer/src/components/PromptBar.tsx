import { describeEvent, isGameEnded } from '@shared/store';
import { useGame } from '../store';
import { useActivePrompt, useUi } from '../ui';

/** Tells the scorer what usually comes next and points at the highlighted buttons. */
export function PromptBar() {
  const game = useGame((s) => s.game);
  const prompt = useActivePrompt();
  const dismiss = useUi((s) => s.dismissPrompt);
  // Nothing more can be recorded once the game has ended, so there is nothing to prompt for.
  if (!prompt || isGameEnded(game)) return <div className="h-9" />;

  const what = describeEvent(game, prompt.event);
  const hints: string[] = [];
  if (prompt.needsRebound) hints.push('tap the rebounder’s + REB');
  if (prompt.canBlock) hints.push('+ BLK on a defender if it was blocked');
  if (prompt.needsAssist) hints.push('tap + AST on the passer');

  return (
    <div className="flex h-9 items-center justify-between gap-3 rounded bg-amber-500/15 px-3 text-sm text-amber-200 ring-1 ring-amber-500/40" data-part="prompt">
      <span className="truncate">
        <b>{what}</b> — {hints.join(' · ')}
      </span>
      <button className="shrink-0 text-xs text-amber-300 underline hover:text-white" onClick={() => dismiss(prompt.event.id)}>
        {prompt.needsAssist ? 'Unassisted' : 'Dismiss'}
      </button>
    </div>
  );
}

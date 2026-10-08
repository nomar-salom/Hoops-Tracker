import { describeEvent, isGameEnded } from '@shared/store';
import { MAX_FOULS, computeStats, emptyLine, foulBlockedReason, playerFoulStatus, teamFoulStatus } from '@shared/stats';
import { findTeamOfPlayer } from '@shared/store';
import type { ID } from '@shared/types';
import { gameStore } from './store';
import { useUi } from './ui';
import type { StatAction } from './statActions';

/** Run a stat button press against the store and report the result in a toast. */
export function performStat(action: StatAction, playerId: ID): void {
  const s = gameStore.getState();
  const toast = useUi.getState().showToast;
  if (isGameEnded(s.game)) { toast('The game has ended. Use Reopen game to record more.', 'warn'); return; }

  switch (action) {
    case 'ftMade': toast(describeEvent(s.game, s.addFreeThrow(playerId, true))); return;
    case 'ftMiss': toast(describeEvent(s.game, s.addFreeThrow(playerId, false))); return;
    case 'oreb': toast(describeEvent(s.game, s.addRebound(playerId, 'offensive'))); return;
    case 'dreb': toast(describeEvent(s.game, s.addRebound(playerId, 'defensive'))); return;
    case 'stl': toast(describeEvent(s.game, s.addSteal(playerId))); return;
    case 'tov': toast(describeEvent(s.game, s.addTurnover(playerId))); return;
    case 'foul':
    case 'tech': {
      const kind = action === 'foul' ? 'personal' : 'technical';
      const game = s.game;
      const before = computeStats(game, { playerIds: [playerId] }).get(playerId) ?? emptyLine();
      const reason = foulBlockedReason(before, kind);
      const event = reason ? null : s.addFoul(playerId, kind);
      if (!event) { toast(reason ?? 'Could not record the foul.', 'warn'); return; }

      const after = gameStore.getState().game;
      const st = playerFoulStatus(computeStats(after, { playerIds: [playerId] }).get(playerId) ?? emptyLine());
      const team = findTeamOfPlayer(after, playerId)!;
      const tf = teamFoulStatus(after, team, after.currentPeriod);
      let text = `${describeEvent(after, event)} (${st.total}/${MAX_FOULS})`;
      if (st.disqualified) text += ' — FOULED OUT';
      else if (st.ejected) text += ' — EJECTED (2 technicals)';
      // Say so only on the foul that tips the opponent into the bonus.
      if (tf.opponentInBonus && tf.bonusCount === 5) text += ' — opponent IN BONUS';
      toast(text, st.out || (tf.opponentInBonus && tf.bonusCount === 5) ? 'warn' : 'ok');
      return;
    }
    case 'ast': {
      const shot = s.creditAssist(playerId);
      if (shot) toast(`Assist → ${describeEvent(gameStore.getState().game, shot)}`);
      else toast('No unassisted made shot by a teammate to credit in this period.', 'warn');
      return;
    }
    case 'blk': {
      const shot = s.creditBlock(playerId);
      if (shot) toast(`Block on ${describeEvent(gameStore.getState().game, shot)}`);
      else toast('No unblocked missed shot by an opponent to credit in this period.', 'warn');
      return;
    }
  }
}

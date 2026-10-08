import { useMemo } from 'react';
import { create } from 'zustand';
import { contextPrompt, type ContextPrompt } from '@shared/store';
import type { Game } from '@shared/types';
import type { LogFilter } from '@shared/eventLog';
import { useGame } from './store';

interface UiState {
  toast: { id: number; text: string; kind: 'ok' | 'warn' } | null;
  showToast(text: string, kind?: 'ok' | 'warn'): void;
  /** Event id whose follow-up prompt (rebound / assist / block) the scorer dismissed. */
  dismissedPromptFor: string | null;
  dismissPrompt(eventId: string): void;
  rosterOpen: boolean;
  setRosterOpen(open: boolean): void;
  newGameOpen: boolean;
  setNewGameOpen(open: boolean): void;
  helpOpen: boolean;
  setHelpOpen(open: boolean): void;
  endGameOpen: boolean;
  setEndGameOpen(open: boolean): void;
  /** Court shows only this player's shots (view-only, never saved). */
  shotPlayerId: string | null;
  setShotPlayer(id: string | null): void;
  logOpen: boolean;
  /** The event log's filter. Opening with a filter sets it atomically, so there is no flash of the unfiltered list. */
  logFilter: LogFilter;
  setLogFilter(patch: Partial<LogFilter>): void;
  openEventLog(filter?: LogFilter): void;
  closeEventLog(): void;
  /** Which teams' shots are drawn on the court: [home, away]. View-only; never saved with the game. */
  showShots: [boolean, boolean];
  setShowShots(team: 0 | 1, show: boolean): void;
  toggleShots(team: 0 | 1): boolean;
  /** Which team the keyboard is working on: type a jersey number to pick one of ITS players. */
  activeTeam: 0 | 1;
  setActiveTeam(team: 0 | 1): void;
  /** Digits typed so far while picking a player by jersey number. */
  numberBuffer: string;
  /** Set by the court while its shot popover is open; the court then owns the keyboard. */
  courtPopover: 'none' | 'pending' | 'editing';
  setCourtPopover(p: 'none' | 'pending' | 'editing'): void;
  /** Last input device, so keyboard focus is only highlighted for keyboard users. */
  inputMode: 'mouse' | 'keyboard';
  /** The game object as it was when last exported/imported; if it is still the current game, nothing is unsaved. */
  savedGame: Game | null;
  markSaved(game: Game | null): void;
}

/** True while any dialog is open: global keyboard shortcuts must stay out of the way. */
export const isModalOpen = (): boolean => {
  const s = useUi.getState();
  return s.rosterOpen || s.newGameOpen || s.helpOpen || s.logOpen || s.endGameOpen;
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

export const useUi = create<UiState>()((set, get) => ({
  toast: null,
  showToast(text, kind = 'ok') {
    if (toastTimer) clearTimeout(toastTimer);
    const id = ++toastId;
    set({ toast: { id, text, kind } });
    toastTimer = setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), kind === 'warn' ? 3500 : 2200);
  },
  dismissedPromptFor: null,
  dismissPrompt: (eventId) => set({ dismissedPromptFor: eventId }),
  rosterOpen: false,
  setRosterOpen: (rosterOpen) => set({ rosterOpen }),
  newGameOpen: false,
  setNewGameOpen: (newGameOpen) => set({ newGameOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  endGameOpen: false,
  setEndGameOpen: (endGameOpen) => set({ endGameOpen }),
  shotPlayerId: null,
  setShotPlayer: (shotPlayerId) => set({ shotPlayerId }),
  logOpen: false,
  logFilter: {},
  setLogFilter: (patch) => set((st) => ({ logFilter: { ...st.logFilter, ...patch } })),
  openEventLog: (filter = {}) => set({ logOpen: true, logFilter: filter }),
  closeEventLog: () => set({ logOpen: false }),
  showShots: [true, true],
  setShowShots: (team, show) => set((st) => ({ showShots: team === 0 ? [show, st.showShots[1]] : [st.showShots[0], show] })),
  toggleShots: (team) => {
    const next = !get().showShots[team];
    get().setShowShots(team, next);
    return next;
  },
  activeTeam: 0,
  setActiveTeam: (activeTeam) => set({ activeTeam }),
  numberBuffer: '',
  courtPopover: 'none',
  setCourtPopover: (courtPopover) => set({ courtPopover }),
  inputMode: 'mouse',
  savedGame: null,
  markSaved: (savedGame) => set({ savedGame }),
}));

/** The follow-up prompt for the last event, unless the scorer dismissed it. */
export function useActivePrompt(): ContextPrompt | null {
  const game = useGame((s) => s.game);
  const dismissed = useUi((s) => s.dismissedPromptFor);
  return useMemo(() => {
    const p = contextPrompt(game);
    return p && p.event.id !== dismissed ? p : null;
  }, [game, dismissed]);
}

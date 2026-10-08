import { useStore } from 'zustand';
import { attachAutosave, createGameStore, type GameStoreState } from '@shared/store';
import { createDemoGame } from './demo';

/** The single game store for this window. */
export const gameStore = createGameStore({ initialGame: createDemoGame() });

export function useGame<T>(selector: (s: GameStoreState) => T): T {
  return useStore(gameStore, selector);
}

/**
 * Restore the last autosave (if any) and keep saving from now on.
 * Only works inside Electron; in a plain browser window.api is undefined and this is a no-op.
 */
export async function initPersistence(): Promise<void> {
  const api = window.api;
  if (!api) return;

  try {
    const saved = await api.autosave.load();
    if (saved) {
      const errors = gameStore.getState().loadGame(saved);
      if (errors.length) console.warn('Ignoring invalid autosave:', errors);
    }
  } catch (e) {
    console.warn('Could not read autosave', e);
  }

  const autosave = attachAutosave(gameStore, (g) => api.autosave.save(g), 500);
  // Flush synchronously so the last few taps survive closing the window.
  window.addEventListener('beforeunload', () => {
    autosave.stop();
    api.autosave.saveSync(gameStore.getState().game);
  });
}

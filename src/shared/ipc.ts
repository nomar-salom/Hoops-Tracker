import type { Game } from './types';
import type { ImportResult } from './xlsx';

export type ExportResult =
  | { status: 'saved'; path: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export type ImportDialogResult =
  | { status: 'ok'; path: string; result: ImportResult }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export type ArchiveResult =
  | { status: 'saved'; path: string }
  | { status: 'error'; message: string };

/** The API the preload script exposes as `window.api`. */
export interface HoopsApi {
  exportXlsx(game: Game): Promise<ExportResult>;
  importXlsx(): Promise<ImportDialogResult>;
  /** Save a timestamped XLSX copy of a game in the app's archive folder (no dialog). */
  archiveGame(game: Game): Promise<ArchiveResult>;
  /** Open the archive folder in the system file manager. */
  openArchiveFolder(): Promise<void>;
  autosave: {
    load(): Promise<Game | null>;
    save(game: Game): Promise<void>;
    /** Blocking write, for flushing right before the window closes. */
    saveSync(game: Game): void;
  };
}

export const IPC = {
  exportXlsx: 'game:export-xlsx',
  importXlsx: 'game:import-xlsx',
  archiveGame: 'game:archive',
  openArchiveFolder: 'archive:open-folder',
  autosaveLoad: 'autosave:load',
  autosaveSave: 'autosave:save',
  autosaveSaveSync: 'autosave:save-sync',
} as const;

import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type HoopsApi } from '@shared/ipc';

const api: HoopsApi = {
  exportXlsx: (game) => ipcRenderer.invoke(IPC.exportXlsx, game),
  importXlsx: () => ipcRenderer.invoke(IPC.importXlsx),
  archiveGame: (game) => ipcRenderer.invoke(IPC.archiveGame, game),
  openArchiveFolder: () => ipcRenderer.invoke(IPC.openArchiveFolder),
  autosave: {
    load: () => ipcRenderer.invoke(IPC.autosaveLoad),
    save: (game) => ipcRenderer.invoke(IPC.autosaveSave, game),
    saveSync: (game) => { ipcRenderer.sendSync(IPC.autosaveSaveSync, game); },
  },
};

contextBridge.exposeInMainWorld('api', api);

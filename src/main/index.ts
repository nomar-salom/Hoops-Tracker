import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { promises as fs, writeFileSync, renameSync } from 'node:fs';
import { exportGameToXlsx, importGameFromXlsx } from '@shared/xlsx';
import { IPC, type ArchiveResult, type ExportResult, type ImportDialogResult } from '@shared/ipc';
import { archiveFileName, gameFileName } from '@shared/dates';
import type { Game } from '@shared/types';

// Lets VS Code attach its debugger to the page (see .vscode/launch.json). Dev builds only.
if (!app.isPackaged && process.env['REMOTE_DEBUGGING_PORT']) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env['REMOTE_DEBUGGING_PORT']);
}

// One stable data folder no matter how the app is launched or what it is called, so the installed
// app finds the games the dev build saved. HOOPS_USER_DATA lets automated tests use a throwaway
// folder instead of real game data.
app.setPath('userData', process.env['HOOPS_USER_DATA'] ?? join(app.getPath('appData'), 'hoops-tracker'));

const autosavePath = () => join(app.getPath('userData'), 'autosave.json');
const archiveDir = () => join(app.getPath('userData'), 'archive');

/** Write to a temp file then rename, so a crash mid-write can't corrupt the last good save. */
function writeAtomicSync(path: string, data: string) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

function registerIpc() {
  ipcMain.handle(IPC.exportXlsx, async (event, game: Game): Promise<ExportResult> => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        defaultPath: gameFileName(game), // uses the local date, not the UTC date
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      };
      const { canceled, filePath } = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (canceled || !filePath) return { status: 'canceled' };
      await fs.writeFile(filePath, await exportGameToXlsx(game));
      return { status: 'saved', path: filePath };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.archiveGame, async (_e, game: Game): Promise<ArchiveResult> => {
    try {
      await fs.mkdir(archiveDir(), { recursive: true });
      const path = join(archiveDir(), archiveFileName(game, new Date().toISOString()));
      await fs.writeFile(path, await exportGameToXlsx(game));
      return { status: 'saved', path };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.openArchiveFolder, async () => {
    await fs.mkdir(archiveDir(), { recursive: true });
    await shell.openPath(archiveDir());
  });

  ipcMain.handle(IPC.importXlsx, async (event): Promise<ImportDialogResult> => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts = {
        properties: ['openFile' as const],
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
      };
      const { canceled, filePaths } = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      const path = filePaths[0];
      if (canceled || !path) return { status: 'canceled' };
      const result = await importGameFromXlsx(await fs.readFile(path));
      return { status: 'ok', path, result };
    } catch (e) {
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle(IPC.autosaveLoad, async (): Promise<Game | null> => {
    try {
      return JSON.parse(await fs.readFile(autosavePath(), 'utf8')) as Game;
    } catch {
      return null; // no autosave yet, or unreadable: start fresh
    }
  });

  ipcMain.handle(IPC.autosaveSave, async (_e, game: Game) => {
    writeAtomicSync(autosavePath(), JSON.stringify(game));
  });

  ipcMain.on(IPC.autosaveSaveSync, (event, game: Game) => {
    try { writeAtomicSync(autosavePath(), JSON.stringify(game)); } catch { /* best effort on close */ }
    event.returnValue = true;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Hoops Tracker',
    backgroundColor: '#0f172a', // no white flash while the page loads
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Never open new windows or navigate away from the app; send links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

/**
 * A small menu. In the packaged app there is deliberately no Reload or DevTools: a stray Ctrl+R in
 * the middle of a game would reload the page and lose the undo history.
 */
function buildMenu() {
  const dev = !app.isPackaged;
  const template: MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [{ role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        ...(dev ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only one copy may run: two windows would overwrite each other's autosave.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.hoopstracker.app');
    buildMenu();
    registerIpc();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/**
 * End-to-end test: launches the REAL Electron app and drives it through Playwright.
 *
 *   npm run test:e2e                      (builds, then tests the app from source)
 *   EXE="C:\path\to\Hoops Tracker.exe" node e2e/app.e2e.cjs     (tests an installed/packaged build)
 *
 * Uses a throwaway data folder (HOOPS_USER_DATA), so it never touches your real saved games.
 * On a headless Linux box run it under a virtual display:  xvfb-run -a npm run test:e2e
 * The file dialogs are replaced with stubs that return fixed paths; everything else is real.
 */
const { _electron } = require('playwright-core');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const path = require('path'), fs = require('fs'), os = require('os');

const PROJ = path.resolve(__dirname, '..');
const EXE = process.env.EXE || require('electron');            // `electron` exports the path to its binary
const sandboxFlag = process.platform === 'linux' ? ['--no-sandbox'] : []; // Linux CI/root cannot use the setuid sandbox
const ARGS = process.env.EXE ? sandboxFlag : [...sandboxFlag, PROJ];
const checks = [];
const check = (name, cond) => { checks.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-e2e-'));
const userData = path.join(tmp, 'data');
const exportPath = path.join(tmp, 'exported.xlsx');
const ENV = { ...process.env, HOOPS_USER_DATA: userData };

async function launch() {
  const app = await _electron.launch({ executablePath: EXE, args: ARGS, env: ENV });
  const win = await app.firstWindow();
  await win.waitForSelector('svg[data-court-type]', { timeout: 30000 });
  return { app, win };
}
const stubDialogs = (app, savePath, openPath) => app.evaluate(({ dialog, shell }, { savePath, openPath }) => {
  globalThis.__saveOpts = null; globalThis.__opened = null;
  dialog.showSaveDialog = async (...a) => { globalThis.__saveOpts = a.find((x) => x && x.defaultPath) || null; return { canceled: false, filePath: savePath }; };
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openPath] });
  shell.openPath = async (p) => { globalThis.__opened = p; return ''; };
}, { savePath, openPath });

async function score(win) {
  // keyboard: Home Ben #5 made 2 (court click + M), Alex assists, Away Cal #10 steal, Home Dan #23 foul
  const K = (k) => win.keyboard.press(k);
  await K('ArrowLeft'); await K('5'); await K('Enter');
  const box = await win.locator('svg[data-court-type]').boundingBox();
  await win.mouse.click(box.x + (3 + 0.93 * 84) / 90 * box.width, box.y + (3 + 0.5 * 50) / 56 * box.height);
  await K('m'); await K('1'); await K('a');
  await K('ArrowRight'); await K('1'); await K('0'); await K('Enter'); await K('s');
  await K('ArrowLeft'); await K('2'); await K('3'); await K('f');
}
const homeScore = (win) => win.locator('[data-team]').nth(0).locator('h2 + span').innerText();
const shots = (win) => win.locator('[data-shot]').count();

(async () => {
  // ================= 1. real window, real preload, real security =================
  let { app, win } = await launch();
  check('window title', (await win.title()) === 'Hoops Tracker');
  check('data folder is the one we asked for (HOOPS_USER_DATA)', (await app.evaluate(({ app }) => app.getPath('userData'))) === userData);
  const sec = await win.evaluate(() => ({
    api: typeof window.api, req: typeof window.require, proc: typeof window.process, mod: typeof window.module,
  }));
  check('renderer has the typed api but NO node access (require/process/module undefined)', sec.api === 'object' && sec.req === 'undefined' && sec.proc === 'undefined' && sec.mod === 'undefined');
  const isolated = await app.evaluate(({ BrowserWindow }) => {
    const wp = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { ctx: wp.contextIsolation, node: wp.nodeIntegration, sandbox: wp.sandbox };
  });
  check('contextIsolation on, nodeIntegration off, sandbox on', isolated.ctx === true && isolated.node === false && isolated.sandbox === true);
  const popup = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const before = BrowserWindow.getAllWindows().length;
    await w.webContents.executeJavaScript("window.open('https://example.com'); 1");
    await new Promise((r) => setTimeout(r, 300));
    return BrowserWindow.getAllWindows().length - before;
  });
  check('window.open() cannot create a new window', popup === 0);


  // ================= 1b. the menu: no Reload / DevTools in a packaged build =================
  const menuInfo = await app.evaluate(({ app, Menu }) => {
    const labels = [];
    const walk = (items) => items.forEach((i) => { labels.push(i.role || i.label); if (i.submenu) walk(i.submenu.items); });
    walk(Menu.getApplicationMenu().items);
    return { packaged: app.isPackaged, labels };
  });
  check('menu has Edit/clipboard roles', ['undo', 'copy', 'paste'].every((r) => menuInfo.labels.includes(r)));
  check('Reload & DevTools only exist when NOT packaged', menuInfo.labels.includes('reload') === !menuInfo.packaged && menuInfo.labels.includes('toggledevtools') === !menuInfo.packaged);

  // ================= 1c. only one copy may run =================
  const second = spawn(EXE, ARGS, { env: ENV, stdio: 'ignore' });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { second.kill(); resolve('still running'); }, 15000);
    second.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  check('a second copy exits immediately instead of opening a second window', code === 0);
  check('and the first window is still the only one', (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1);

  // ================= 2. autosave + restore across a restart =================
  await score(win);
  check('scored on the real app: Home 2, 1 shot on court', (await homeScore(win)) === '2' && (await shots(win)) === 1);
  await sleep(900);                                                      // > 500 ms debounce
  const autosaveFile = path.join(userData, 'autosave.json');
  check('autosave.json written', fs.existsSync(autosaveFile));
  const saved = JSON.parse(fs.readFileSync(autosaveFile, 'utf8'));
  check('autosave holds 3 events (shot with its assist attached, steal, foul)', saved.events.length === 3 && saved.events[0].assistedBy);
  check('no leftover .tmp file (atomic write)', !fs.existsSync(autosaveFile + '.tmp'));
  await app.close();

  ({ app, win } = await launch());
  check('restart: game restored (score 2, shot marker back)', (await homeScore(win)) === '2' && (await shots(win)) === 1);
  check('restart: foul restored on Dan', (await win.locator('[data-team]').nth(0).locator('[data-player]').nth(3).locator('[data-foul-box="personal"]').count()) === 1);
  check('restart: undo history is not saved (Undo still works via fallback)', await win.getByRole('button', { name: 'Undo' }).isEnabled());


  // ================= 2b. Ctrl+Z reaches the app (the menu's Undo must not swallow it) =================
  const dan = () => win.locator('[data-team]').nth(0).locator('[data-player]').nth(3).locator('[data-foul-box="personal"]').count();
  check('before: Dan has 1 foul', (await dan()) === 1);
  await win.keyboard.press('Control+z');
  check('Ctrl+Z in the real window undid the foul', (await dan()) === 0);
  await win.keyboard.press('Control+Shift+z');
  check('Ctrl+Shift+Z redid it', (await dan()) === 1);
  await win.getByRole('button', { name: 'Teams & Roster' }).click();
  await win.getByLabel('Home team name').fill('Hawks');
  await win.keyboard.press('Control+z');
  check('inside a text box Ctrl+Z undoes the TEXT, not a game event', (await dan()) === 1);
  await win.keyboard.press('Escape');
  await win.getByLabel('Home team name').count(); // dialog closed
  await win.getByRole('button', { name: 'Teams & Roster' }).click();
  await win.getByLabel('Home team name').fill('Home');   // put the name back so the file-name check below stays simple
  await win.keyboard.press('Escape');

  // ================= 3. a change made right before closing is not lost =================
  await win.keyboard.press('ArrowLeft'); await win.keyboard.press('2'); await win.keyboard.press('3'); await win.keyboard.press('f');   // 2nd foul on Dan
  await app.close();                                                       // immediately: inside the 500 ms window
  ({ app, win } = await launch());
  check('instant close: the last foul survived (sync flush on unload)', (await win.locator('[data-team]').nth(0).locator('[data-player]').nth(3).locator('[data-foul-box="personal"]').count()) === 2);

  // ================= 4. export through the real handler =================
  await stubDialogs(app, exportPath, exportPath);
  await win.getByRole('button', { name: 'Export XLSX' }).click();
  await win.waitForSelector('text=/Saved /', { timeout: 15000 });
  await sleep(500);
  check('export wrote the .xlsx file', fs.existsSync(exportPath) && fs.statSync(exportPath).size > 5000);
  const opts = await app.evaluate(() => globalThis.__saveOpts);
  const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  check('default file name uses the LOCAL date and team names', opts && opts.defaultPath === `${today}_Home_vs_Away.xlsx`);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(exportPath);
  check('workbook has all 5 sheets', wb.worksheets.map((w) => w.name).join(',') === 'Game Info,Roster,Events,Box Score,Summary');
  check('Events sheet has the 4 recorded events', wb.getWorksheet('Events').rowCount - 1 === 4);

  // ================= 5. new game: backup lands in the archive folder =================
  await win.locator('[data-new-game]').click();
  const dlg = win.getByRole('dialog', { name: 'New game' });
  check('dialog says the game was exported', (await dlg.locator('[data-part="export-status"]').innerText()).includes('has been exported'));
  check('backup is ticked by default in the real app', await dlg.locator('[data-backup]').isChecked());
  await dlg.getByText('Open backup folder').click();
  await sleep(300);
  check('"Open backup folder" opens <userData>/archive', (await app.evaluate(() => globalThis.__opened)) === path.join(userData, 'archive'));
  await dlg.locator('[data-clear="1"]').check();
  await dlg.locator('[data-start]').click();
  await win.waitForSelector('[role=status]', { timeout: 15000 });
  const archDir = path.join(userData, 'archive');
  const archived = fs.existsSync(archDir) ? fs.readdirSync(archDir) : [];
  check('exactly one backup file in the archive folder', archived.length === 1 && archived[0].endsWith('.xlsx'));
  check('backup name = local date + teams + timestamp', /^\d{4}-\d{2}-\d{2}_Home_vs_Away_saved-\d{4}-\d{2}-\d{2}T[\d-]+\.xlsx$/.test(archived[0] || ''));
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(path.join(archDir, archived[0]));
  check('the backup contains the finished game (4 events)', wb2.getWorksheet('Events').rowCount - 1 === 4);
  check('the new game is empty and the roster dialog opened for the cleared team', (await shots(win)) === 0 && (await win.getByRole('dialog', { name: 'Teams and roster' }).count()) === 1);
  await win.keyboard.press('Escape');
  await sleep(900);
  check('autosave now holds the NEW (empty) game', JSON.parse(fs.readFileSync(autosaveFile, 'utf8')).events.length === 0);

  // ================= 6. import the exported file back =================
  await win.getByRole('button', { name: 'Import XLSX' }).click();
  await win.waitForSelector('text=Imported 4 events', { timeout: 15000 });
  check('import restored the game (score 2, marker back)', (await homeScore(win)) === '2' && (await shots(win)) === 1);
  await sleep(900);
  check('and autosave followed the import', JSON.parse(fs.readFileSync(autosaveFile, 'utf8')).events.length === 4);

  // ================= 7. a broken file is rejected with a reason =================
  const badPath = path.join(tmp, 'bad.xlsx'); fs.writeFileSync(badPath, 'this is not a spreadsheet');
  await stubDialogs(app, exportPath, badPath);
  await win.getByRole('button', { name: 'Import XLSX' }).click();
  await win.waitForSelector('text=/Import failed|not a valid/', { timeout: 15000 });
  check('garbage file: error shown, current game untouched', (await homeScore(win)) === '2');


  // ================= 8. an ended game stays ended across a restart, and exports as ended =================
  await win.locator('[data-end-game]').click();
  await win.getByRole('dialog', { name: 'End game' }).locator('[data-confirm-end]').click();
  await sleep(900);
  check('autosave records when the game ended', !!JSON.parse(fs.readFileSync(autosaveFile, 'utf8')).endedAt);
  await stubDialogs(app, exportPath, exportPath);
  await win.getByRole('button', { name: 'Export XLSX' }).click();
  await sleep(1200);
  const wbEnded = new ExcelJS.Workbook(); await wbEnded.xlsx.readFile(exportPath);
  let endedCell = null;
  wbEnded.getWorksheet('Game Info').eachRow((row) => { if (row.getCell(1).value === 'endedAt') endedCell = row.getCell(2).value; });
  check('the exported workbook carries endedAt', typeof endedCell === 'string' && endedCell.length > 10);
  await app.close();

  ({ app, win } = await launch());
  check('restart: still FINAL, stat buttons gone, Reopen offered', (await win.locator('[data-part="final-chip"]').count()) === 1 && (await win.locator('[data-action]').count()) === 0 && (await win.locator('[data-reopen-game]').count()) === 1);
  await win.locator('[data-view="1"]').click();
  check('restart: any period can still be viewed in review', (await win.locator('[data-view="1"]').getAttribute('aria-pressed')) === 'true');
  await win.locator('[data-reopen-game]').click();
  await sleep(900);
  check('reopen is saved too (autosave no longer has endedAt)', !JSON.parse(fs.readFileSync(autosaveFile, 'utf8')).endedAt);

  await win.screenshot({ path: path.join(tmp, 'final.png') });
  await app.close();
  const fails = checks.filter(([, ok]) => !ok).map(([n]) => n);
  console.log(`${checks.length - fails.length}/${checks.length} checks passed`, fails);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('E2E CRASHED', e); process.exit(2); });

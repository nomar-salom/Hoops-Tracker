import { contextPrompt, isGameEnded, periodsInGame } from '@shared/store';
import { periodLabel } from '@shared/stats';
import { gameStore } from './store';
import { useUi } from './ui';
import { performStat } from './perform';
import { quickActions, type StatAction } from './statActions';

/** The bits of a KeyboardEvent we use (so the logic can be tested without a DOM). */
export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface KeyContext {
  /** Focus is in a text field / select. */
  typing: boolean;
  /** A dialog is open. */
  modalOpen: boolean;
  /** The court's shot popover is open (it handles M / X / 2 / 3 / F / Delete itself). */
  popoverOpen: boolean;
}

type KeyAction = StatAction | 'rebound';

export interface StatKey {
  key: string;
  /** Letters: must match exactly. Symbols (+ - =): ignored. */
  shift?: boolean;
  action: KeyAction;
  label: string;
}

/** One letter per stat, applied to the selected player. Shift+F is a technical. */
export const STAT_KEYS: StatKey[] = [
  { key: 'f', shift: false, action: 'foul', label: 'Personal foul' },
  { key: 'f', shift: true, action: 'tech', label: 'Technical foul' },
  { key: 's', shift: false, action: 'stl', label: 'Steal' },
  { key: 't', shift: false, action: 'tov', label: 'Turnover' },
  { key: 'b', shift: false, action: 'blk', label: 'Block (credits the last missed shot)' },
  { key: 'a', shift: false, action: 'ast', label: 'Assist (credits the last made shot)' },
  { key: 'o', shift: false, action: 'oreb', label: 'Offensive rebound' },
  { key: 'd', shift: false, action: 'dreb', label: 'Defensive rebound' },
  { key: 'r', shift: false, action: 'rebound', label: 'Rebound after a miss (offensive for the shooter\u2019s team, else defensive)' },
  { key: '+', action: 'ftMade', label: 'Free throw made' },
  { key: '=', action: 'ftMade', label: 'Free throw made' },
  { key: '-', action: 'ftMiss', label: 'Free throw missed' },
];

/** How long after the last digit a typed jersey number is accepted without pressing Enter. */
export const BUFFER_IDLE_MS = 900;
const MAX_DIGITS = 3;

let bufferTimer: ReturnType<typeof setTimeout> | undefined;

const ui = () => useUi.getState();
const store = () => gameStore.getState();
const toast = (text: string, kind: 'ok' | 'warn' = 'ok') => ui().showToast(text, kind);

/** Test helper: forget any half-typed number. */
export function resetShortcuts(): void {
  if (bufferTimer) clearTimeout(bufferTimer);
  bufferTimer = undefined;
  useUi.setState({ numberBuffer: '' });
}

function setBuffer(value: string) {
  if (bufferTimer) clearTimeout(bufferTimer);
  bufferTimer = undefined;
  useUi.setState({ numberBuffer: value });
  if (value) bufferTimer = setTimeout(commitBuffer, BUFFER_IDLE_MS);
}

/** Select the active team's player whose jersey matches the typed digits. */
export function commitBuffer(): void {
  const buf = ui().numberBuffer;
  if (!buf) return;
  setBuffer('');
  const team = store().game.teams[ui().activeTeam];
  const player = team.players.find((p) => p.number === buf); // exact text match: "0" and "00" differ
  if (player) store().selectPlayer(player.id);
  else toast(`No #${buf} on ${team.name}`, 'warn');
}

const ENDED_MSG = 'The game has ended. Use Reopen game to record more (fix mistakes in the Event log).';
const gameEnded = () => isGameEnded(store().game);

const selectedTeamIndex = (): 0 | 1 | null => {
  const id = store().selectedPlayerId;
  if (!id) return null;
  const i = store().game.teams.findIndex((t) => t.players.some((p) => p.id === id));
  return i === 0 || i === 1 ? i : null;
};

function moveSelection(delta: 1 | -1) {
  const team = store().game.teams[ui().activeTeam];
  if (team.players.length === 0) return toast(`${team.name} has no players`, 'warn');
  const idx = team.players.findIndex((p) => p.id === store().selectedPlayerId);
  const next = idx === -1 ? (delta === 1 ? 0 : team.players.length - 1)
    : (idx + delta + team.players.length) % team.players.length;
  store().selectPlayer(team.players[next]!.id);
}

function matchStat(e: KeyInfo): StatKey | undefined {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  return STAT_KEYS.find((s) => s.key === k && (s.shift === undefined || s.shift === e.shiftKey));
}

type Nav = 'playerShots' | 'toggleHome' | 'toggleAway' | 'log' | 'enter' | 'escape' | 'backspace' | 'left' | 'right' | 'up' | 'down' | 'nextPeriod' | 'prevPeriod' | 'view' | 'help' | 'undo' | 'redo';

function matchNav(e: KeyInfo): Nav | undefined {
  switch (e.key) {
    case 'Enter': return 'enter';
    case 'Escape': return 'escape';
    case 'Backspace': return 'backspace';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case ']': return 'nextPeriod';
    case '[': return 'prevPeriod';
    case '?': case 'F1': return 'help';
  }
  const k = e.key.toLowerCase();
  if (k === 'l') return 'log';
  if (k === 'p' && !e.shiftKey) return 'playerShots';
  // Shift is required, so a stray H or A (assist!) never hides a team's shots.
  if (k === 'h' && e.shiftKey) return 'toggleHome';
  if (k === 'a' && e.shiftKey) return 'toggleAway';
  if (k === 'v') return 'view';
  if (k === 'u') return e.shiftKey ? 'redo' : 'undo';
  return undefined;
}

function rebound(playerId: string) {
  const game = store().game;
  const prompt = contextPrompt(game);
  const pick = prompt?.needsRebound ? quickActions(game, prompt, playerId).find((a) => a === 'oreb' || a === 'dreb') : undefined;
  if (!pick) return toast('No missed shot to rebound. Use O (offensive) or D (defensive).', 'warn');
  performStat(pick, playerId);
}

/**
 * Handle one keydown. Returns true if the key was ours (the caller should preventDefault).
 * Undo/redo use Ctrl/Cmd; everything else is plain keys and is off while typing in a field,
 * while a dialog is open, or while the court's shot popover has the keyboard.
 */
export function handleShortcut(e: KeyInfo, ctx: KeyContext): boolean {
  if (ctx.typing || ctx.modalOpen) return false;

  // ---- Ctrl/Cmd: undo & redo only; leave every other browser/app shortcut alone ----
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      setBuffer('');
      if (gameEnded()) { toast(ENDED_MSG, 'warn'); return true; } // ending isn't undoable: don't silently undo a stat
      if (k === 'y' || e.shiftKey) store().redo(); else store().undo();
      useUi.setState({ inputMode: 'keyboard' });
      return true;
    }
    return false;
  }
  if (e.altKey || ctx.popoverOpen) return false;

  // ---- Digits build a jersey number ----
  if (/^\d$/.test(e.key)) {
    if (!e.repeat) {
      const buf = ui().numberBuffer;
      setBuffer(buf.length >= MAX_DIGITS ? e.key : buf + e.key);
    }
    useUi.setState({ inputMode: 'keyboard' });
    return true;
  }

  const nav = matchNav(e);
  const stat = nav ? undefined : matchStat(e);
  if (!nav && !stat) return false;

  // Holding a key must never repeat a stat (or flip pages); only arrow navigation may repeat.
  if (e.repeat && nav !== 'up' && nav !== 'down') return true;
  useUi.setState({ inputMode: 'keyboard' });

  // Keys that edit the half-typed number.
  if (nav === 'enter') { if (!ui().numberBuffer) return false; commitBuffer(); return true; }
  if (nav === 'escape') {
    if (ui().numberBuffer) { setBuffer(''); return true; }
    if (store().selectedPlayerId) { store().selectPlayer(null); return true; }
    return false;
  }
  if (nav === 'backspace') {
    const buf = ui().numberBuffer;
    if (!buf) return false;
    setBuffer(buf.slice(0, -1));
    return true;
  }

  // Anything else accepts a pending number first, so "23" then "F" fouls #23.
  commitBuffer();

  switch (nav) {
    case 'left':
    case 'right': {
      const team = nav === 'left' ? 0 : 1; // matches the sidebar layout: Home left, Away right
      ui().setActiveTeam(team);
      const sel = selectedTeamIndex();
      if (sel !== null && sel !== team) store().selectPlayer(null);
      return true;
    }
    case 'up': moveSelection(-1); return true;
    case 'down': moveSelection(1); return true;
    case 'nextPeriod':
    case 'prevPeriod': {
      if (gameEnded()) { toast(ENDED_MSG, 'warn'); return true; }
      if (nav === 'nextPeriod') store().nextPeriod(); else store().prevPeriod();
      const g = store().game;
      toast(`Now in ${periodLabel(g.currentPeriod, g.regulationPeriods)}`);
      return true;
    }
    case 'view': {
      // V steps forward through: whole game, Q1, Q2, ... ; Shift+V steps back.
      const order: ('game' | number)[] = ['game', ...periodsInGame(store().game)];
      const i = order.indexOf(store().viewPeriod);
      const next = order[(i + (e.shiftKey ? -1 : 1) + order.length) % order.length]!;
      store().setViewPeriod(next);
      const g = store().game;
      toast(next === 'game' ? 'Showing the whole game' : `Showing ${periodLabel(next, g.regulationPeriods)} only`);
      return true;
    }
    case 'playerShots': {
      // P: show only the selected player's shots; press again (or with nobody selected) to see everyone.
      const current = ui().shotPlayerId;
      const sel = store().selectedPlayerId;
      if (current && (!sel || sel === current)) {
        ui().setShotPlayer(null);
        toast('Showing everyone\u2019s shots');
        return true;
      }
      if (!sel) { toast('Select a player first to see only their shots.', 'warn'); return true; }
      ui().setShotPlayer(sel);
      const ti = selectedTeamIndex();
      if (ti !== null && !ui().showShots[ti]) ui().setShowShots(ti, true);
      const g = store().game;
      toast(`Showing only ${g.teams.flatMap((t) => t.players).find((p) => p.id === sel)?.name ?? 'this player'}\u2019s shots`);
      return true;
    }
    case 'help': ui().setHelpOpen(true); return true;
    case 'log': ui().openEventLog(); return true;
    case 'toggleHome':
    case 'toggleAway': {
      const idx = nav === 'toggleHome' ? 0 : 1;
      const shown = ui().toggleShots(idx);
      toast(`${store().game.teams[idx].name} shots ${shown ? 'shown' : 'hidden'}`);
      return true;
    }
    case 'undo':
    case 'redo':
      if (gameEnded()) { toast(ENDED_MSG, 'warn'); return true; }
      if (nav === 'undo') store().undo(); else store().redo();
      return true;
  }

  // ---- Stat keys act on the selected player ----
  if (gameEnded()) { toast(ENDED_MSG, 'warn'); return true; }
  const playerId = store().selectedPlayerId;
  if (!playerId) {
    toast('Select a player first: type a jersey number (\u2190 / \u2192 picks the team).', 'warn');
    return true;
  }
  if (stat!.action === 'rebound') rebound(playerId);
  else performStat(stat!.action, playerId);
  return true;
}

// ---------------------------------------------------------------------------
// Help sheet data (generated from the same tables the handler uses)
// ---------------------------------------------------------------------------

const prettyKey = (k: string) => (k === '=' ? '=' : k.length === 1 ? k.toUpperCase() : k);

export interface HelpRow { keys: string[]; label: string }
export interface HelpGroup { title: string; rows: HelpRow[] }

export function helpGroups(): HelpGroup[] {
  // Merge aliases (+ and =) that do the same thing into one row.
  const stats = new Map<string, HelpRow>();
  for (const s of STAT_KEYS) {
    const id = `${s.action}`;
    const keys = [(s.shift ? 'Shift+' : '') + prettyKey(s.key)];
    const row = stats.get(id);
    if (row) row.keys.push(...keys);
    else stats.set(id, { keys, label: s.label });
  }
  return [
    {
      title: 'Pick a player',
      rows: [
        { keys: ['0\u20139'], label: 'Type a jersey number (acts on the highlighted team; 0 and 00 are different)' },
        { keys: ['Enter'], label: 'Accept the number now (otherwise it is accepted after a short pause or on the next key)' },
        { keys: ['\u2190', '\u2192'], label: 'Switch to the Home (left) or Away (right) team' },
        { keys: ['\u2191', '\u2193'], label: 'Previous / next player on that team' },
        { keys: ['Backspace'], label: 'Delete the last digit' },
        { keys: ['Esc'], label: 'Cancel the number, then deselect the player' },
      ],
    },
    { title: 'Record a stat for the selected player', rows: [...stats.values()] },
    {
      title: 'Shots (click the court first)',
      rows: [
        { keys: ['M'], label: 'Made' },
        { keys: ['X'], label: 'Missed' },
        { keys: ['2', '3'], label: 'Set the shot to 2PT or 3PT' },
        { keys: ['Esc'], label: 'Cancel the shot' },
        { keys: ['Shift+H', 'Shift+A'], label: 'Show / hide the Home / Away team\u2019s shots on the court' },
        { keys: ['F', 'Delete'], label: 'On a marker you clicked: flip made/missed, or delete it' },
      ],
    },
    {
      title: 'Game',
      rows: [
        { keys: ['U', 'Ctrl+Z'], label: 'Undo' },
        { keys: ['Shift+U', 'Ctrl+Shift+Z', 'Ctrl+Y'], label: 'Redo' },
        { keys: [']', '['], label: 'Next / previous period' },
        { keys: ['V', 'Shift+V'], label: 'Look at the next / previous view: whole game, Q1, Q2, ... (stats and shots; new stats still go to the current period)' },
        { keys: ['P'], label: 'Show only the selected player\u2019s shots (press again for everyone)' },
        { keys: ['L'], label: 'Open the event log (fix or delete anything that was recorded)' },
        { keys: ['?', 'F1'], label: 'Show this sheet' },
      ],
    },
  ];
}

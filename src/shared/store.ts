import { createStore, type StoreApi } from 'zustand/vanilla';
import type {
  CourtType, FoulEvent, Game, GameEvent, ID, Player, ReboundEvent, ShotEvent, StatFilter, Team,
} from './types';
import { validateGame } from './validate';
import { createEmptyGame, createNextGame, type NewGameOptions } from './factory';
import { compareJersey } from './roster';
import { COURTS, classifyShot, type ShotClassification } from './court';
import { attacksRight, computeStats, emptyLine, foulBlockedReason } from './stats';

// ---------- Types ----------

/** One undoable user action. */
export type HistoryEntry =
  | { kind: 'add'; event: GameEvent }
  | { kind: 'attach'; eventId: ID; field: 'assistedBy' | 'blockedBy'; playerId: ID }
  | { kind: 'remove'; event: GameEvent; index: number }
  | { kind: 'edit'; before: GameEvent; after: GameEvent };

export interface ShotInput {
  playerId: ID;
  /** Omit to auto-detect from the click position and the court's 3-point line. */
  points?: 2 | 3;
  made: boolean;
  x: number;
  y: number;
  assistedBy?: ID; // teammate, made shots only
  blockedBy?: ID; // opponent, missed shots only
}

/** Fields that may be edited on an existing event. Irrelevant keys are ignored. */
export type EventPatch = Partial<
  Pick<ShotEvent, 'playerId' | 'period' | 'points' | 'made' | 'x' | 'y' | 'assistedBy' | 'blockedBy'> &
    { kind: ReboundEvent['kind'] | FoulEvent['kind'] }
>;

export interface GameStoreState {
  // ----- data -----
  game: Game;
  undoStack: HistoryEntry[]; // UI-only, never saved
  redoStack: HistoryEntry[]; // UI-only, never saved

  // ----- UI state -----
  selectedPlayerId: ID | null;
  /**
   * What the sidebars and court are LOOKING at: the whole game or one period (any period, not just
   * the current one). Independent of `game.currentPeriod`, which is where new stats are recorded.
   */
  viewPeriod: 'game' | number;

  // ----- stat entry -----
  addShot(input: ShotInput): GameEvent;
  addFreeThrow(playerId: ID, made: boolean): GameEvent;
  addRebound(playerId: ID, kind: ReboundEvent['kind']): GameEvent;
  /**
   * Charge a foul. Returns null (and records nothing) if the player is already out:
   * 5 fouls total (technicals count) or 2 technicals.
   */
  addFoul(playerId: ID, kind: FoulEvent['kind']): FoulEvent | null;
  addSteal(playerId: ID): GameEvent;
  addTurnover(playerId: ID): GameEvent;

  /**
   * Credit an assist to `playerId` on the most recent unassisted MADE shot by a
   * teammate in the current period. Returns that shot, or null if there is none.
   */
  creditAssist(playerId: ID): ShotEvent | null;
  /** Credit a block to `playerId` on the most recent unblocked MISSED shot by an opponent (current period). */
  creditBlock(playerId: ID): ShotEvent | null;

  // ----- editing -----
  undo(): void;
  redo(): void;
  /** Delete an event anywhere in the log. Undoable. */
  deleteEvent(id: ID): void;
  /**
   * Edit an event. Returns null on success or a human-readable reason it was refused
   * (the game is left untouched), e.g. a 6th foul or an assist from an opponent. Undoable.
   */
  updateEvent(id: ID, patch: EventPatch): string | null;

  // ----- periods -----
  setPeriod(period: number): void;
  nextPeriod(): void;
  prevPeriod(): void;

  // ----- roster -----
  addPlayer(teamId: ID, player: Omit<Player, 'id'>): ID;
  updatePlayer(playerId: ID, patch: Partial<Omit<Player, 'id'>>): void;
  /** Returns false (and does nothing) if the player is referenced by any event. */
  removePlayer(playerId: ID): boolean;
  /** Reorder a team's roster by jersey number. */
  sortRoster(teamId: ID): void;
  /** Teams switch ends in period 1. Always flips BOTH so they never attack the same basket. */
  swapSides(): void;
  updateTeam(teamId: ID, patch: Partial<Pick<Team, 'name' | 'color' | 'attacksRightInPeriod1'>>): void;

  // ----- game lifecycle -----
  setCourtType(type: CourtType): void;
  /** Replace the current game with a fresh one (see createNextGame). Clears undo/redo and the selection. */
  startNewGame(opts: NewGameOptions): void;
  newGame(game?: Game): void;
  /** Validates first. Returns the list of errors; the game is loaded only if it is empty. */
  loadGame(game: Game): string[];

  // ----- UI -----
  selectPlayer(playerId: ID | null): void;
  setViewPeriod(view: 'game' | number): void;
  /** Mark the game finished. No new stats can be recorded until reopenGame(). Edits in the event log still work. */
  endGame(): void;
  reopenGame(): void;
}

export interface StoreOptions {
  initialGame?: Game;
  newId?: () => ID;
  now?: () => number;
}

export type GameStore = StoreApi<GameStoreState>;

// ---------- Pure helpers (also exported for the UI) ----------

export function findTeamOfPlayer(game: Game, playerId: ID): Team | undefined {
  return game.teams.find((t) => t.players.some((p) => p.id === playerId));
}

const maxEventPeriod = (game: Game) =>
  game.events.reduce((m, e) => Math.max(m, e.period), 1);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * What the app would record for a shot at (x, y) by this player right now.
 * Call it on hover/click to show "3PT" (and warn when `nearLine`) before committing.
 */
export function previewShot(game: Game, playerId: ID, x: number, y: number): ShotClassification {
  const team = findTeamOfPlayer(game, playerId);
  if (!team) throw new Error(`Unknown player: ${playerId}`);
  const right = attacksRight(team, game.currentPeriod, game.regulationPeriods);
  return classifyShot(clamp01(x), clamp01(y), right, COURTS[game.courtType]);
}

/** Same team as the last shooter = offensive rebound. */
export function suggestReboundKind(
  game: Game,
  shooterId: ID,
  reboundPlayerId: ID,
): ReboundEvent['kind'] {
  const a = findTeamOfPlayer(game, shooterId);
  const b = findTeamOfPlayer(game, reboundPlayerId);
  return a && b && a.id === b.id ? 'offensive' : 'defensive';
}

/**
 * If the most recent event is a missed shot or missed free throw, returns it,
 * so the UI can prompt "Rebound by...".
 */
export function pendingRebound(game: Game): ShotEvent | Extract<GameEvent, { type: 'freeThrow' }> | null {
  const last = game.events[game.events.length - 1];
  if (!last) return null;
  if ((last.type === 'shot' || last.type === 'freeThrow') && !last.made) return last;
  return null;
}

export const GAME_ENDED_MESSAGE = 'The game has ended. Reopen it to record more.';
export const isGameEnded = (game: Pick<Game, 'endedAt'>): boolean => !!game.endedAt;

/** Every period that exists in the game: 1 up to the later of the current period and the last one with events. */
export function periodsInGame(game: Game): number[] {
  const last = Math.max(game.currentPeriod, maxEventPeriod(game));
  return Array.from({ length: last }, (_, i) => i + 1);
}

/** Filter to pass to computeStats for the sidebar's current view. */
export function selectStatFilter(s: Pick<GameStoreState, 'viewPeriod'>): StatFilter {
  return s.viewPeriod === 'game' ? {} : { periods: [s.viewPeriod] };
}

const EDITABLE: Record<GameEvent['type'], (keyof EventPatch)[]> = {
  shot: ['playerId', 'period', 'points', 'made', 'x', 'y', 'assistedBy', 'blockedBy'],
  freeThrow: ['playerId', 'period', 'made'],
  rebound: ['playerId', 'period', 'kind'],
  foul: ['playerId', 'period', 'kind'],
  steal: ['playerId', 'period'],
  turnover: ['playerId', 'period'],
};

/** What the scorer is probably about to record, based on the last event. */
export interface ContextPrompt {
  event: ShotEvent | Extract<GameEvent, { type: 'freeThrow' }>;
  /** Last event was a made shot with no assist yet. */
  needsAssist: boolean;
  /** Last event was a missed shot with no block recorded. */
  canBlock: boolean;
  /** Last event was a miss, so a rebound is expected. */
  needsRebound: boolean;
}

export function contextPrompt(game: Game): ContextPrompt | null {
  const last = game.events[game.events.length - 1];
  if (!last) return null;
  if (last.type === 'shot') {
    return {
      event: last,
      needsAssist: last.made && !last.assistedBy,
      canBlock: !last.made && !last.blockedBy,
      needsRebound: !last.made,
    };
  }
  if (last.type === 'freeThrow' && !last.made) {
    return { event: last, needsAssist: false, canBlock: false, needsRebound: true };
  }
  return null;
}

/** Short human description, e.g. "#23 Ben: 3PT made". For toasts and tooltips. */
export function describeEvent(game: Game, e: GameEvent): string {
  const p = game.teams.flatMap((t) => t.players).find((x) => x.id === e.playerId);
  const who = p ? `#${p.number} ${p.name}` : '?';
  switch (e.type) {
    case 'shot': return `${who}: ${e.points}PT ${e.made ? 'made' : 'missed'}`;
    case 'freeThrow': return `${who}: FT ${e.made ? 'made' : 'missed'}`;
    case 'rebound': return `${who}: ${e.kind === 'offensive' ? 'offensive' : 'defensive'} rebound`;
    case 'steal': return `${who}: steal`;
    case 'turnover': return `${who}: turnover`;
    case 'foul': return `${who}: ${e.kind} foul`;
  }
}

function applyUndo(game: Game, entry: HistoryEntry): Game | null {
  if (entry.kind === 'remove') {
    if (game.events.some((e) => e.id === entry.event.id)) return null;
    const events = [...game.events];
    events.splice(Math.min(entry.index, events.length), 0, entry.event);
    return { ...game, events };
  }
  if (entry.kind === 'edit') {
    if (!game.events.some((e) => e.id === entry.before.id)) return null;
    return { ...game, events: game.events.map((e) => (e.id === entry.before.id ? entry.before : e)) };
  }
  if (entry.kind === 'add') {
    if (!game.events.some((e) => e.id === entry.event.id)) return null;
    return { ...game, events: game.events.filter((e) => e.id !== entry.event.id) };
  }
  const target = game.events.find((e) => e.id === entry.eventId);
  if (!target || target.type !== 'shot' || target[entry.field] !== entry.playerId) return null;
  const { [entry.field]: _removed, ...rest } = target;
  void _removed;
  return { ...game, events: game.events.map((e) => (e.id === entry.eventId ? (rest as ShotEvent) : e)) };
}

function applyRedo(game: Game, entry: HistoryEntry): Game | null {
  if (entry.kind === 'remove') {
    if (!game.events.some((e) => e.id === entry.event.id)) return null;
    return { ...game, events: game.events.filter((e) => e.id !== entry.event.id) };
  }
  if (entry.kind === 'edit') {
    if (!game.events.some((e) => e.id === entry.after.id)) return null;
    return { ...game, events: game.events.map((e) => (e.id === entry.after.id ? entry.after : e)) };
  }
  if (entry.kind === 'add') {
    if (game.events.some((e) => e.id === entry.event.id)) return null;
    return { ...game, events: [...game.events, entry.event] };
  }
  const target = game.events.find((e) => e.id === entry.eventId);
  if (!target || target.type !== 'shot' || target[entry.field]) return null;
  if (entry.field === 'assistedBy' ? !target.made : target.made) return null;
  return {
    ...game,
    events: game.events.map((e) => (e.id === entry.eventId ? { ...target, [entry.field]: entry.playerId } : e)),
  };
}

// ---------- Store ----------

export function createGameStore(opts: StoreOptions = {}): GameStore {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? (() => Date.now());

  return createStore<GameStoreState>()((set, get) => {
    const requireTeam = (playerId: ID): Team => {
      const team = findTeamOfPlayer(get().game, playerId);
      if (!team) throw new Error(`Unknown player: ${playerId}`);
      return team;
    };

    const setGame = (fn: (g: Game) => Game, extra: Partial<GameStoreState> = {}) =>
      set((s) => ({ game: fn(s.game), ...extra }));

    /** Build a base event stamped with team, period, id, timestamp. */
    const assertLive = () => {
      if (isGameEnded(get().game)) throw new Error(GAME_ENDED_MESSAGE);
    };

    const base = (playerId: ID) => {
      assertLive();
      const team = requireTeam(playerId);
      return {
        id: newId(),
        teamId: team.id,
        playerId,
        period: get().game.currentPeriod,
        ts: now(),
      };
    };

    const push = (event: GameEvent): GameEvent => {
      set((s) => ({
        game: { ...s.game, events: [...s.game.events, event] },
        undoStack: [...s.undoStack, { kind: 'add', event }],
        redoStack: [],
      }));
      return event;
    };

    /** Attach an assist/block to the most recent matching shot in the current period. */
    const attach = (
      field: 'assistedBy' | 'blockedBy',
      playerId: ID,
      matches: (e: ShotEvent, teamId: ID) => boolean,
    ): ShotEvent | null => {
      assertLive();
      const team = requireTeam(playerId);
      const { game } = get();
      for (let i = game.events.length - 1; i >= 0; i--) {
        const e = game.events[i]!;
        if (e.type !== 'shot' || e.period !== game.currentPeriod || !matches(e, team.id)) continue;
        const updated: ShotEvent = { ...e, [field]: playerId };
        set((s) => ({
          game: { ...s.game, events: s.game.events.map((x) => (x.id === e.id ? updated : x)) },
          undoStack: [...s.undoStack, { kind: 'attach', eventId: e.id, field, playerId }],
          redoStack: [],
        }));
        return updated;
      }
      return null;
    };

    return {
      game: opts.initialGame ?? createEmptyGame(),
      undoStack: [],
      redoStack: [],
      selectedPlayerId: null,
      viewPeriod: 'game',

      // ----- stat entry -----
      addShot(input) {
        const b = base(input.playerId);

        if (input.assistedBy) {
          if (!input.made) throw new Error('Cannot assist a missed shot');
          if (input.assistedBy === input.playerId) throw new Error('Cannot assist your own shot');
          if (requireTeam(input.assistedBy).id !== b.teamId) throw new Error('Assister must be a teammate');
        }
        if (input.blockedBy) {
          if (input.made) throw new Error('Cannot block a made shot');
          if (requireTeam(input.blockedBy).id === b.teamId) throw new Error('Blocker must be an opponent');
        }
        const event: ShotEvent = {
          ...b,
          type: 'shot',
          points: input.points ?? previewShot(get().game, input.playerId, input.x, input.y).points,
          made: input.made,
          x: clamp01(input.x),
          y: clamp01(input.y),
          ...(input.assistedBy ? { assistedBy: input.assistedBy } : {}),
          ...(input.blockedBy ? { blockedBy: input.blockedBy } : {}),
        };
        return push(event);
      },

      addFreeThrow: (playerId, made) => push({ ...base(playerId), type: 'freeThrow', made }),
      addRebound: (playerId, kind) => push({ ...base(playerId), type: 'rebound', kind }),
      addFoul(playerId, kind) {
        const b = base(playerId); // also validates the player exists
        const line = computeStats(get().game, { playerIds: [playerId] }).get(playerId) ?? emptyLine();
        if (foulBlockedReason(line, kind)) return null;
        return push({ ...b, type: 'foul', kind }) as FoulEvent;
      },
      addSteal: (playerId) => push({ ...base(playerId), type: 'steal' }),
      addTurnover: (playerId) => push({ ...base(playerId), type: 'turnover' }),

      // ----- editing -----
      creditAssist(playerId) {
        return attach('assistedBy', playerId, (e, teamId) =>
          e.made && e.teamId === teamId && e.playerId !== playerId && !e.assistedBy);
      },

      creditBlock(playerId) {
        return attach('blockedBy', playerId, (e, teamId) =>
          !e.made && e.teamId !== teamId && !e.blockedBy);
      },

      undo() {
        const { game, undoStack, redoStack } = get();
        const stack = [...undoStack];
        while (stack.length) {
          const entry = stack.pop()!;
          const next = applyUndo(game, entry); // null = stale (event was deleted/edited since)
          if (next) {
            set({ game: next, undoStack: stack, redoStack: [...redoStack, entry] });
            return;
          }
        }
        // Nothing tracked (e.g. a game restored from disk): fall back to removing the last event.
        const last = game.events[game.events.length - 1];
        if (!last) { set({ undoStack: [] }); return; }
        set({
          game: { ...game, events: game.events.slice(0, -1) },
          undoStack: [],
          redoStack: [...redoStack, { kind: 'add', event: last }],
        });
      },

      redo() {
        const { game, undoStack, redoStack } = get();
        const stack = [...redoStack];
        while (stack.length) {
          const entry = stack.pop()!;
          const next = applyRedo(game, entry);
          if (next) {
            set({ game: next, redoStack: stack, undoStack: [...undoStack, entry] });
            return;
          }
        }
        set({ redoStack: [] });
      },

      deleteEvent(id) {
        const game = get().game;
        const index = game.events.findIndex((e) => e.id === id);
        if (index === -1) return;
        set((st) => ({
          game: { ...st.game, events: st.game.events.filter((e) => e.id !== id) },
          undoStack: [...st.undoStack, { kind: 'remove', event: game.events[index]!, index }],
          redoStack: [],
        }));
      },

      updateEvent(id, patch) {
        const game = get().game;
        const existing = game.events.find((e) => e.id === id);
        if (!existing) return 'That event no longer exists.';

        const allowed = EDITABLE[existing.type] as string[];
        const filtered = Object.fromEntries(
          Object.entries(patch).filter(([k]) => allowed.includes(k)),
        ) as EventPatch;

        let next = { ...existing, ...filtered } as GameEvent;

        // Changing the player moves the event to that player's team.
        if (filtered.playerId) {
          const team = findTeamOfPlayer(game, filtered.playerId);
          if (!team) return 'That player is not on either roster.';
          next = { ...next, teamId: team.id };
        }

        next.period = Math.min(Math.max(1, next.period), game.currentPeriod);

        if (next.type === 'shot') {
          next.x = clamp01(next.x);
          next.y = clamp01(next.y);
          // Keep assist/block consistent with made/missed.
          if (next.made) delete next.blockedBy;
          else delete next.assistedBy;
        }
        // "Clear this field" arrives as undefined; drop the key so it round-trips cleanly.
        for (const k of Object.keys(next) as (keyof GameEvent)[]) {
          if ((next as unknown as Record<string, unknown>)[k] === undefined) delete (next as unknown as Record<string, unknown>)[k];
        }

        if (JSON.stringify(next) === JSON.stringify(existing)) return null; // nothing changed

        // Refuse edits that would make the game impossible (6th foul, opposing "assister", ...).
        const candidate: Game = { ...game, events: game.events.map((e) => (e.id === id ? next : e)) };
        const problems = validateGame(candidate);
        if (problems.length > 0) return problems[0]!;

        set((st) => ({
          game: candidate,
          undoStack: [...st.undoStack, { kind: 'edit', before: existing, after: next }],
          redoStack: [],
        }));
        return null;
      },

      // ----- periods -----
      setPeriod(period) {
        assertLive();
        // Never go below the latest period that already has events, so the
        // line score can't hide recorded data.
        const p = Math.max(1, Math.floor(period), maxEventPeriod(get().game));
        setGame((g) => ({ ...g, currentPeriod: p }));
      },
      nextPeriod() {
        get().setPeriod(get().game.currentPeriod + 1);
      },
      prevPeriod() {
        get().setPeriod(get().game.currentPeriod - 1);
      },

      // ----- roster -----
      addPlayer(teamId, player) {
        const id = newId();
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) =>
            t.id === teamId ? { ...t, players: [...t.players, { ...player, id }] } : t,
          ) as [Team, Team],
        }));
        return id;
      },

      updatePlayer(playerId, patch) {
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) => ({
            ...t,
            players: t.players.map((p) => (p.id === playerId ? { ...p, ...patch } : p)),
          })) as [Team, Team],
        }));
      },

      removePlayer(playerId) {
        const used = get().game.events.some(
          (e) =>
            e.playerId === playerId ||
            (e.type === 'shot' && (e.assistedBy === playerId || e.blockedBy === playerId)),
        );
        if (used) return false;
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) => ({
            ...t,
            players: t.players.filter((p) => p.id !== playerId),
          })) as [Team, Team],
        }));
        if (get().selectedPlayerId === playerId) set({ selectedPlayerId: null });
        return true;
      },

      sortRoster(teamId) {
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) =>
            t.id === teamId
              ? { ...t, players: [...t.players].sort((a, b) => compareJersey(a.number, b.number)) }
              : t,
          ) as [Team, Team],
        }));
      },

      swapSides() {
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) => ({ ...t, attacksRightInPeriod1: !t.attacksRightInPeriod1 })) as [Team, Team],
        }));
      },

      updateTeam(teamId, patch) {
        setGame((g) => ({
          ...g,
          teams: g.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) as [Team, Team],
        }));
      },

      setCourtType(courtType) {
        setGame((g) => ({ ...g, courtType }));
      },

      // ----- lifecycle -----
      startNewGame(newOpts) {
        set((s) => ({
          game: createNextGame(s.game, newOpts, newId(), new Date(now()).toISOString()),
          undoStack: [],
          redoStack: [],
          selectedPlayerId: null,
          viewPeriod: 'game',
        }));
      },

      newGame(game) {
        set({
          game: game ?? createEmptyGame(),
          undoStack: [],
          redoStack: [],
          selectedPlayerId: null,
          viewPeriod: 'game',
        });
      },

      loadGame(game) {
        const errors = validateGame(game);
        if (errors.length === 0) {
          set({ game, undoStack: [], redoStack: [], selectedPlayerId: null, viewPeriod: 'game' });
        }
        return errors;
      },

      // ----- UI -----
      selectPlayer: (playerId) => set({ selectedPlayerId: playerId }),
      setViewPeriod(view) {
        // Only periods that exist can be viewed; anything else falls back to the whole game.
        const ok = view === 'game' || periodsInGame(get().game).includes(view);
        set({ viewPeriod: ok ? view : 'game' });
      },

      endGame() {
        if (isGameEnded(get().game)) return;
        set((st) => ({
          game: { ...st.game, endedAt: new Date(now()).toISOString() },
          selectedPlayerId: null,
          viewPeriod: 'game',
        }));
      },

      reopenGame() {
        if (!isGameEnded(get().game)) return;
        set((st) => {
          const { endedAt: _gone, ...rest } = st.game;
          void _gone;
          return { game: rest as Game };
        });
      },
    };
  });
}

// ---------- Autosave ----------

export interface Autosave {
  /** Save immediately if there are pending changes (call on window close). */
  flush(): void;
  stop(): void;
}

/**
 * Debounced autosave of `game` only (never the redo stack or UI state).
 * `save` is injected so this file has no Electron dependency; in the app it
 * will call `window.api.saveGame(game)` over IPC.
 */
export function attachAutosave(
  store: GameStore,
  save: (game: Game) => void | Promise<void>,
  delayMs = 500,
): Autosave {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  const run = () => {
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    void save(store.getState().game);
  };

  const unsubscribe = store.subscribe((state, prev) => {
    if (state.game === prev.game) return; // ignore UI-only changes
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  });

  return {
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    stop() {
      if (timer) clearTimeout(timer);
      unsubscribe();
    },
  };
}

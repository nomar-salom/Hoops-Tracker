export type ID = string;

export type CourtType = 'nba' | 'ncaa' | 'fiba' | 'nfhs';

export interface Player {
  id: ID;
  number: string; // string: "00" and "0" are different jerseys
  name: string;
}

export interface Team {
  id: ID;
  name: string;
  color: string; // hex
  attacksRightInPeriod1: boolean;
  players: Player[];
}

export interface Game {
  schemaVersion: 1;
  id: ID;
  date: string; // ISO 8601
  location?: string;
  regulationPeriods: 4;
  courtType: CourtType; // decides the 3-point line
  currentPeriod: number; // 1..4 quarters, 5+ = OT1, OT2... (where NEW stats are recorded)
  /** ISO time the game was ended. Absent while the game is live. An ended game accepts no new stats until reopened. */
  endedAt?: string;
  teams: [Team, Team]; // [0] home, [1] away
  events: GameEvent[];
}

export interface BaseEvent {
  id: ID;
  teamId: ID;
  playerId: ID;
  period: number;
  ts: number;
}

export interface ShotEvent extends BaseEvent {
  type: 'shot';
  points: 2 | 3;
  made: boolean;
  x: number; // 0..1 across court length
  y: number; // 0..1 across court width
  assistedBy?: ID; // only valid if made
  blockedBy?: ID; // only valid if missed
}

export interface FreeThrowEvent extends BaseEvent {
  type: 'freeThrow';
  made: boolean;
}

export interface ReboundEvent extends BaseEvent {
  type: 'rebound';
  kind: 'offensive' | 'defensive';
}

/** Personal or technical foul charged to a player. Both count as team fouls and toward the player's 5. */
export interface FoulEvent extends BaseEvent {
  type: 'foul';
  kind: 'personal' | 'technical';
}

export interface SimpleStatEvent extends BaseEvent {
  type: 'steal' | 'turnover';
}

export type GameEvent =
  | ShotEvent
  | FreeThrowEvent
  | ReboundEvent
  | FoulEvent
  | SimpleStatEvent;

export interface StatLine {
  pts: number;
  reb: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  /** Personal fouls. */
  pf: number;
  /** Technical fouls (these ALSO count toward the player's 5 fouls and the team total). */
  tf: number;
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
}

export interface StatFilter {
  periods?: number[]; // omit = entire game
  playerIds?: ID[];
}

export interface LineScore {
  byPeriod: Record<number, [number, number]>;
  total: [number, number];
}

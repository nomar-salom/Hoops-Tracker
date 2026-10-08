import type { Game, GameEvent, Player, Team } from './types';

const player = (id: string, number: string, name: string): Player => ({ id, number, name });

export const home: Team = {
  id: 'home', name: 'Home', color: '#1d4ed8', attacksRightInPeriod1: true,
  players: [player('h1', '1', 'Alex'), player('h2', '23', 'Ben'), player('h3', '00', 'Cal')],
};
export const away: Team = {
  id: 'away', name: 'Away', color: '#dc2626', attacksRightInPeriod1: false,
  players: [player('a1', '5', 'Dan'), player('a2', '10', 'Eli')],
};

export function sampleGame(): Game {
  let n = 0;
  const base = (teamId: string, playerId: string, period: number) =>
    ({ id: `e${++n}`, teamId, playerId, period, ts: n });
  const events: GameEvent[] = [
    { ...base('home', 'h1', 1), type: 'shot', points: 3, made: true, x: 0.8, y: 0.2, assistedBy: 'h2' },
    { ...base('home', 'h2', 1), type: 'shot', points: 2, made: false, x: 0.9, y: 0.5, blockedBy: 'a1' },
    { ...base('away', 'a2', 1), type: 'rebound', kind: 'defensive' },
    { ...base('away', 'a1', 1), type: 'shot', points: 2, made: true, x: 0.15, y: 0.5 },
    { ...base('home', 'h3', 2), type: 'freeThrow', made: true },
    { ...base('home', 'h3', 2), type: 'freeThrow', made: false },
    { ...base('home', 'h1', 2), type: 'rebound', kind: 'offensive' },
    { ...base('away', 'a2', 3), type: 'steal' },
    { ...base('home', 'h2', 3), type: 'turnover' },
    { ...base('away', 'a2', 5), type: 'shot', points: 3, made: true, x: 0.2, y: 0.1 },
    { ...base('home', 'h1', 1), type: 'foul', kind: 'personal' },
    { ...base('away', 'a1', 1), type: 'foul', kind: 'personal' },
    { ...base('home', 'h2', 3), type: 'foul', kind: 'technical' },
  ];
  return {
    schemaVersion: 1, id: 'g1', date: '2026-01-01T00:00:00.000Z',
    regulationPeriods: 4, courtType: 'nba', currentPeriod: 5, teams: [home, away], events,
  };
}

/** Small deterministic PRNG so generated games are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A larger, valid, reproducible game (8 players a side, 5 periods) for tests. */
export function generateGame(seed = 1, eventCount = 300): Game {
  const rnd = mulberry32(seed);
  const jerseys = ['0', '00', '1', '7', '10', '23', '33', '45'];
  const mkTeam = (id: string, prefix: string, color: string, right: boolean): Team => ({
    id, name: id === 'home' ? 'Home Hawks' : 'Away Owls', color, attacksRightInPeriod1: right,
    players: jerseys.map((j, i) => ({ id: `${prefix}${i}`, number: j, name: `${prefix.toUpperCase()} Player ${i}` })),
  });
  const teams: [Team, Team] = [mkTeam('home', 'h', '#1d4ed8', true), mkTeam('away', 'a', '#dc2626', false)];
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)] as T;

  const events: GameEvent[] = [];
  const fouls = new Map<string, { total: number; tech: number }>();
  for (let i = 0; i < eventCount; i++) {
    const period = 1 + Math.min(4, Math.floor((i / eventCount) * 5));
    const ti = rnd() < 0.5 ? 0 : 1;
    const team = teams[ti]!;
    const opp = teams[1 - ti]!;
    const shooter = pick(team.players);
    const base = { id: `ev${i}`, teamId: team.id, playerId: shooter.id, period, ts: 1_700_000_000_000 + i * 1000 };
    const r = rnd();
    if (r < 0.5) {
      const made = rnd() < 0.45;
      const mate = pick(team.players.filter((p) => p.id !== shooter.id));
      events.push({
        ...base, type: 'shot', points: rnd() < 0.35 ? 3 : 2, made,
        x: Math.round(rnd() * 1e4) / 1e4, y: Math.round(rnd() * 1e4) / 1e4,
        ...(made && rnd() < 0.6 ? { assistedBy: mate.id } : {}),
        ...(!made && rnd() < 0.15 ? { blockedBy: pick(opp.players).id } : {}),
      });
    } else if (r < 0.6) events.push({ ...base, type: 'freeThrow', made: rnd() < 0.75 });
    else if (r < 0.74) events.push({ ...base, type: 'rebound', kind: rnd() < 0.3 ? 'offensive' : 'defensive' });
    else if (r < 0.8) events.push({ ...base, type: 'steal' });
    else if (r < 0.86) events.push({ ...base, type: 'turnover' });
    else {
      // Fouls respect the real limits: 5 total, 2 technical. A capped player turns it over instead.
      const f = fouls.get(shooter.id) ?? { total: 0, tech: 0 };
      if (f.total >= 5) events.push({ ...base, type: 'turnover' });
      else {
        const kind = rnd() < 0.12 && f.tech < 2 ? 'technical' : 'personal';
        fouls.set(shooter.id, { total: f.total + 1, tech: f.tech + (kind === 'technical' ? 1 : 0) });
        events.push({ ...base, type: 'foul', kind });
      }
    }
  }
  return {
    schemaVersion: 1, id: 'gen-game', date: '2026-03-14T19:30:00.000Z', location: 'Test Gym',
    regulationPeriods: 4, courtType: 'nba', currentPeriod: 5, teams, events,
  };
}

import ExcelJS from 'exceljs';
import type { CourtType, Game, GameEvent, ID, Player, StatLine, Team } from './types';
import { computeStats, emptyLine, lineScore, periodLabel, teamFoulsByPeriod, teamTotals } from './stats';
import { validateGame } from './validate';

/**
 * One workbook per game.
 *
 *  Imported (source of truth):   Game Info, Roster, Events
 *  Export-only (regenerated):    Box Score, Summary
 *
 * Box Score and Summary are live Excel formulas over the Events sheet, so they
 * recalculate if you edit Events in Excel. Editing them does NOT change the
 * game on import.
 */
export const XLSX_FORMAT = 'hoops-tracker';
export const SHEETS = {
  info: 'Game Info',
  roster: 'Roster',
  events: 'Events',
  box: 'Box Score',
  summary: 'Summary',
} as const;

export interface ImportResult {
  /** Null whenever `errors` is non-empty. */
  game: Game | null;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FONT = 'Arial';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const TEAM_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
const GREY = 'FF808080';

const letter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const label = (p: Player) => `${p.number} ${p.name}`.trim();

function applyFont(ws: ExcelJS.Worksheet) {
  ws.eachRow({ includeEmpty: false }, (row) =>
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.font = { ...cell.font, name: FONT, size: cell.font?.size ?? 10 };
    }),
  );
}

function styleHeader(row: ExcelJS.Row, from = 1, to = row.cellCount) {
  for (let c = from; c <= to; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: c <= 3 ? 'left' : 'center' };
  }
}

// ---------------------------------------------------------------------------
// Events sheet layout (column order is the import contract)
// ---------------------------------------------------------------------------

const EVENT_FIELDS = [
  'id', 'type', 'teamId', 'playerId', 'period', 'ts',
  'points', 'made', 'x', 'y', 'assistedBy', 'blockedBy', 'kind',
] as const;
type EventField = (typeof EVENT_FIELDS)[number];

const evCol = (f: EventField) => letter(EVENT_FIELDS.indexOf(f) + 1);
/** Whole-column reference into Events, so rows added in Excel are counted too. */
const ev = (f: EventField) => `Events!$${evCol(f)}:$${evCol(f)}`;

// Roster columns: A teamId | B team | C playerId | D number | E name
const rosterLookup = (idRef: string, col: 'B' | 'D' | 'E') =>
  `INDEX(Roster!$${col}:$${col},MATCH(${idRef},Roster!$C:$C,0))`;

// ---------------------------------------------------------------------------
// Box score column layout
// ---------------------------------------------------------------------------

type BoxKey =
  | 'pts' | 'reb' | 'oreb' | 'dreb' | 'ast' | 'stl' | 'blk' | 'tov'
  | 'fgm' | 'fga' | 'fgPct' | 'fg2m' | 'fg2a' | 'fg3m' | 'fg3a' | 'fg3Pct'
  | 'ftm' | 'fta' | 'ftPct' | 'pf' | 'tf';

const BOX_COLS: { key: BoxKey; header: string; pct?: boolean }[] = [
  { key: 'pts', header: 'PTS' }, { key: 'reb', header: 'REB' },
  { key: 'oreb', header: 'OREB' }, { key: 'dreb', header: 'DREB' },
  { key: 'ast', header: 'AST' }, { key: 'stl', header: 'STL' },
  { key: 'blk', header: 'BLK' }, { key: 'tov', header: 'TO' },
  { key: 'fgm', header: 'FGM' }, { key: 'fga', header: 'FGA' },
  { key: 'fgPct', header: 'FG%', pct: true },
  { key: 'fg2m', header: '2PM' }, { key: 'fg2a', header: '2PA' },
  { key: 'fg3m', header: '3PM' }, { key: 'fg3a', header: '3PA' },
  { key: 'fg3Pct', header: '3P%', pct: true },
  { key: 'ftm', header: 'FTM' }, { key: 'fta', header: 'FTA' },
  { key: 'ftPct', header: 'FT%', pct: true },
  { key: 'pf', header: 'PF' }, { key: 'tf', header: 'TF' },
];
const BOX_FIRST_STAT_COL = 4; // A = playerId, B = #, C = player, stats start at D
const boxCol = (k: BoxKey) => letter(BOX_FIRST_STAT_COL + BOX_COLS.findIndex((c) => c.key === k));

const pct = (m: number, a: number): number | string => (a > 0 ? m / a : '');

/** Cached values for every box score column, derived from a StatLine. */
function boxValues(l: StatLine): Record<BoxKey, number | string> {
  const fgm = l.fg2m + l.fg3m;
  const fga = l.fg2a + l.fg3a;
  return {
    pts: l.pts, reb: l.reb, oreb: l.oreb, dreb: l.dreb, ast: l.ast, stl: l.stl, blk: l.blk, tov: l.tov,
    fgm, fga, fgPct: pct(fgm, fga),
    fg2m: l.fg2m, fg2a: l.fg2a, fg3m: l.fg3m, fg3a: l.fg3a, fg3Pct: pct(l.fg3m, l.fg3a),
    ftm: l.ftm, fta: l.fta, ftPct: pct(l.ftm, l.fta),
    pf: l.pf, tf: l.tf,
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function exportGameToWorkbook(game: Game): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hoops Tracker';
  wb.created = new Date(game.date);
  wb.calcProperties = { fullCalcOnLoad: true }; // Excel recalculates everything on open

  writeInfo(wb.addWorksheet(SHEETS.info), game);
  writeRoster(wb.addWorksheet(SHEETS.roster), game);
  writeEvents(wb.addWorksheet(SHEETS.events), game);
  const totalRows = writeBoxScore(wb.addWorksheet(SHEETS.box), game);
  writeSummary(wb.addWorksheet(SHEETS.summary), game, totalRows);
  return wb;
}

export async function exportGameToXlsx(game: Game): Promise<Uint8Array> {
  const buf = await exportGameToWorkbook(game).xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

function writeInfo(ws: ExcelJS.Worksheet, game: Game) {
  ws.columns = [{ width: 26 }, { width: 44 }];
  ws.addRow(['key', 'value']);
  styleHeader(ws.getRow(1), 1, 2);

  const rows: [string, string | number | boolean][] = [
    ['format', XLSX_FORMAT],
    ['schemaVersion', game.schemaVersion],
    ['gameId', game.id],
    ['date', game.date],
    ['location', game.location ?? ''],
    ['courtType', game.courtType],
    ['regulationPeriods', game.regulationPeriods],
    ['currentPeriod', game.currentPeriod],
    ['endedAt', game.endedAt ?? ''],
  ];
  (['home', 'away'] as const).forEach((slot, i) => {
    const t = game.teams[i]!;
    rows.push([`${slot}.id`, t.id], [`${slot}.name`, t.name], [`${slot}.color`, t.color],
      [`${slot}.attacksRightInPeriod1`, t.attacksRightInPeriod1]);
  });
  for (const r of rows) ws.addRow(r);

  ws.addRow([]);
  const note = ws.addRow(['NOTE', 'Edit Game Info, Roster and Events only. Box Score and Summary are regenerated on export; changes to them are not imported.']);
  note.getCell(1).font = { bold: true };
  note.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  applyFont(ws);
}

function writeRoster(ws: ExcelJS.Worksheet, game: Game) {
  ws.columns = [{ width: 38 }, { width: 18 }, { width: 38 }, { width: 9 }, { width: 24 }];
  styleHeader(ws.addRow(['teamId', 'team', 'playerId', 'number', 'name']));
  ws.getColumn(4).numFmt = '@'; // jersey "00" must stay text
  for (const t of game.teams) {
    for (const p of t.players) {
      const row = ws.addRow([t.id, t.name, p.id, p.number, p.name]);
      row.getCell(4).value = String(p.number);
      row.getCell(4).numFmt = '@';
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  applyFont(ws);
}

function writeEvents(ws: ExcelJS.Worksheet, game: Game) {
  const displayHeaders = ['Team', 'Player', 'Assisted by', 'Blocked by'];
  ws.columns = [
    { width: 20 }, { width: 11 }, { width: 20 }, { width: 20 }, { width: 8 }, { width: 15 },
    { width: 8 }, { width: 8 }, { width: 9 }, { width: 9 }, { width: 20 }, { width: 20 }, { width: 11 },
    { width: 16 }, { width: 22 }, { width: 22 }, { width: 22 },
  ];
  const header = ws.addRow([...EVENT_FIELDS, ...displayHeaders]);
  styleHeader(header);
  const base = EVENT_FIELDS.length;
  for (let i = 0; i < displayHeaders.length; i++) header.getCell(base + 1 + i).fill = TOTAL_FILL;

  const players = new Map<ID, { team: Team; player: Player }>();
  for (const t of game.teams) for (const p of t.players) players.set(p.id, { team: t, player: p });

  const idx = (f: EventField) => EVENT_FIELDS.indexOf(f) + 1;
  game.events.forEach((e, i) => {
    const r = i + 2;
    const row = ws.getRow(r);
    const set = (f: EventField, v: ExcelJS.CellValue) => { row.getCell(idx(f)).value = v; };

    set('id', e.id); set('type', e.type); set('teamId', e.teamId); set('playerId', e.playerId);
    set('period', e.period); set('ts', e.ts);
    if (e.type === 'shot') {
      set('points', e.points); set('made', e.made); set('x', e.x); set('y', e.y);
      if (e.assistedBy) set('assistedBy', e.assistedBy);
      if (e.blockedBy) set('blockedBy', e.blockedBy);
    } else if (e.type === 'freeThrow') set('made', e.made);
    else if (e.type === 'rebound' || e.type === 'foul') set('kind', e.kind);

    // Human-readable columns: live lookups into Roster (ignored on import).
    const who = players.get(e.playerId);
    const nameOf = (id?: ID) => { const w = id ? players.get(id) : undefined; return w ? label(w.player) : ''; };
    const lookupName = (ref: string) =>
      `${rosterLookup(ref, 'D')}&" "&${rosterLookup(ref, 'E')}`;

    row.getCell(base + 1).value = {
      formula: `IFERROR(${rosterLookup(`$D${r}`, 'B')},"")`, result: who?.team.name ?? '',
    };
    row.getCell(base + 2).value = {
      formula: `IFERROR(${lookupName(`$D${r}`)},"")`, result: who ? label(who.player) : '',
    };
    row.getCell(base + 3).value = {
      formula: `IF($K${r}="","",IFERROR(${lookupName(`$K${r}`)},""))`,
      result: e.type === 'shot' ? nameOf(e.assistedBy) : '',
    };
    row.getCell(base + 4).value = {
      formula: `IF($L${r}="","",IFERROR(${lookupName(`$L${r}`)},""))`,
      result: e.type === 'shot' ? nameOf(e.blockedBy) : '',
    };
  });

  ws.getColumn(idx('ts')).numFmt = '0';
  ws.getColumn(idx('x')).numFmt = '0.0000';
  ws.getColumn(idx('y')).numFmt = '0.0000';
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: base + displayHeaders.length } };
  applyFont(ws);
}

/** rows of the TOTAL line: totalRows['game'] / totalRows['1'] ... -> [homeRow, awayRow] */
type TotalRows = Record<string, [number, number]>;

function writeBoxScore(ws: ExcelJS.Worksheet, game: Game): TotalRows {
  ws.columns = [
    { width: 12 }, { width: 6 }, { width: 24 },
    ...BOX_COLS.map(() => ({ width: 7.5 })),
  ];
  const note = ws.getCell('A1');
  note.value = 'Derived sheet: live formulas over the Events sheet. Edits here are not imported.';
  note.font = { italic: true, color: { argb: GREY } };

  const totalRows: TotalRows = {};
  let r = 3;

  const sections: { key: string; period: number | null }[] = [{ key: 'game', period: null }];
  for (let p = 1; p <= game.currentPeriod; p++) sections.push({ key: String(p), period: p });

  for (const sec of sections) {
    const stats = computeStats(game, sec.period ? { periods: [sec.period] } : {});

    // Section title row. For a period the number lives in column B so formulas can reference it.
    const title = ws.getRow(r);
    if (sec.period === null) {
      title.getCell(1).value = 'FULL GAME';
    } else {
      title.getCell(1).value = 'PERIOD';
      title.getCell(2).value = sec.period;
      title.getCell(3).value = periodLabel(sec.period, game.regulationPeriods);
    }
    for (let c = 1; c <= BOX_FIRST_STAT_COL + BOX_COLS.length - 1; c++) {
      title.getCell(c).font = { bold: true, size: 12 };
      title.getCell(c).border = { bottom: { style: 'medium' } };
    }
    r++;

    const periodCrit = sec.period === null ? '' : `,${ev('period')},$B$${r - 1}`;
    const rowsForSection: [number, number] = [0, 0];

    game.teams.forEach((team, ti) => {
      // Team name row + header row
      const teamRow = ws.getRow(r++);
      teamRow.getCell(3).value = team.name;
      for (let c = 1; c <= BOX_FIRST_STAT_COL + BOX_COLS.length - 1; c++) teamRow.getCell(c).fill = TEAM_FILL;
      teamRow.getCell(3).font = { bold: true };

      const head = ws.getRow(r++);
      ['playerId', '#', 'Player', ...BOX_COLS.map((c) => c.header)].forEach((h, i) => { head.getCell(i + 1).value = h; });
      styleHeader(head, 1, BOX_FIRST_STAT_COL + BOX_COLS.length - 1);

      const first = r;
      for (const player of team.players) {
        const row = ws.getRow(r);
        row.getCell(1).value = player.id;
        row.getCell(1).font = { color: { argb: GREY }, size: 8 };
        row.getCell(2).value = String(player.number);
        row.getCell(2).numFmt = '@';
        row.getCell(3).value = player.name;

        const vals = boxValues(stats.get(player.id) ?? emptyLine());
        const pid = `${ev('playerId')},$A${r}`;
        const cnt = (...crit: string[]) => `COUNTIFS(${[pid, ...crit].join(',')}${periodCrit})`;
        const made = `${ev('made')},TRUE`;
        const isType = (t: string) => `${ev('type')},"${t}"`;
        const c = (k: BoxKey) => `${boxCol(k)}${r}`;

        const formulas: Record<BoxKey, string> = {
          pts: `2*${c('fg2m')}+3*${c('fg3m')}+${c('ftm')}`,
          reb: `${c('oreb')}+${c('dreb')}`,
          oreb: cnt(isType('rebound'), `${ev('kind')},"offensive"`),
          dreb: cnt(isType('rebound'), `${ev('kind')},"defensive"`),
          ast: `COUNTIFS(${ev('assistedBy')},$A${r}${periodCrit})`,
          stl: cnt(isType('steal')),
          blk: `COUNTIFS(${ev('blockedBy')},$A${r}${periodCrit})`,
          tov: cnt(isType('turnover')),
          fgm: `${c('fg2m')}+${c('fg3m')}`,
          fga: `${c('fg2a')}+${c('fg3a')}`,
          fgPct: `IF(${c('fga')}=0,"",${c('fgm')}/${c('fga')})`,
          fg2m: cnt(isType('shot'), `${ev('points')},2`, made),
          fg2a: cnt(isType('shot'), `${ev('points')},2`),
          fg3m: cnt(isType('shot'), `${ev('points')},3`, made),
          fg3a: cnt(isType('shot'), `${ev('points')},3`),
          fg3Pct: `IF(${c('fg3a')}=0,"",${c('fg3m')}/${c('fg3a')})`,
          ftm: cnt(isType('freeThrow'), made),
          fta: cnt(isType('freeThrow')),
          ftPct: `IF(${c('fta')}=0,"",${c('ftm')}/${c('fta')})`,
          pf: cnt(isType('foul'), `${ev('kind')},"personal"`),
          tf: cnt(isType('foul'), `${ev('kind')},"technical"`),
        };
        BOX_COLS.forEach((col, i) => {
          const cell = row.getCell(BOX_FIRST_STAT_COL + i);
          cell.value = { formula: formulas[col.key], result: vals[col.key] };
          if (col.pct) cell.numFmt = '0.0%';
          cell.alignment = { horizontal: 'center' };
        });
        r++;
      }
      const last = r - 1;

      // Team total row: sums of the player rows; percentages recomputed from totals.
      const total = ws.getRow(r);
      total.getCell(3).value = 'TOTAL';
      const tvals = boxValues(teamTotals(game, team, sec.period ? { periods: [sec.period] } : {}));
      const tc = (k: BoxKey) => `${boxCol(k)}${r}`;
      BOX_COLS.forEach((col, i) => {
        const cell = total.getCell(BOX_FIRST_STAT_COL + i);
        let formula: string;
        if (col.key === 'fgPct') formula = `IF(${tc('fga')}=0,"",${tc('fgm')}/${tc('fga')})`;
        else if (col.key === 'fg3Pct') formula = `IF(${tc('fg3a')}=0,"",${tc('fg3m')}/${tc('fg3a')})`;
        else if (col.key === 'ftPct') formula = `IF(${tc('fta')}=0,"",${tc('ftm')}/${tc('fta')})`;
        else formula = last >= first ? `SUM(${boxCol(col.key)}${first}:${boxCol(col.key)}${last})` : '0';
        cell.value = { formula, result: tvals[col.key] };
        if (col.pct) cell.numFmt = '0.0%';
        cell.alignment = { horizontal: 'center' };
      });
      for (let cc = 1; cc <= BOX_FIRST_STAT_COL + BOX_COLS.length - 1; cc++) {
        total.getCell(cc).fill = TOTAL_FILL;
        total.getCell(cc).font = { bold: true };
        total.getCell(cc).border = { top: { style: 'thin' } };
      }
      rowsForSection[ti] = r;
      r += 2; // blank line between teams
    });

    totalRows[sec.key] = rowsForSection;
    r += 1;
  }

  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 0 }];
  applyFont(ws);
  return totalRows;
}

// Summary columns: each pulls from a Box Score TOTAL row so the two sheets can never disagree.
const box = (k: BoxKey, row: number) => `'${SHEETS.box}'!${boxCol(k)}${row}`;
const SUMMARY_COLS: {
  header: string;
  pct?: boolean;
  formula: (row: number) => string;
  result: (l: StatLine) => number | string;
}[] = [
  { header: 'PTS', formula: (r) => box('pts', r), result: (l) => l.pts },
  {
    header: 'FG', formula: (r) => `${box('fgm', r)}&"-"&${box('fga', r)}`,
    result: (l) => `${l.fg2m + l.fg3m}-${l.fg2a + l.fg3a}`,
  },
  { header: 'FG%', pct: true, formula: (r) => box('fgPct', r), result: (l) => pct(l.fg2m + l.fg3m, l.fg2a + l.fg3a) },
  { header: '2PT', formula: (r) => `${box('fg2m', r)}&"-"&${box('fg2a', r)}`, result: (l) => `${l.fg2m}-${l.fg2a}` },
  { header: '3PT', formula: (r) => `${box('fg3m', r)}&"-"&${box('fg3a', r)}`, result: (l) => `${l.fg3m}-${l.fg3a}` },
  { header: '3P%', pct: true, formula: (r) => box('fg3Pct', r), result: (l) => pct(l.fg3m, l.fg3a) },
  { header: 'FT', formula: (r) => `${box('ftm', r)}&"-"&${box('fta', r)}`, result: (l) => `${l.ftm}-${l.fta}` },
  { header: 'FT%', pct: true, formula: (r) => box('ftPct', r), result: (l) => pct(l.ftm, l.fta) },
  { header: 'OREB', formula: (r) => box('oreb', r), result: (l) => l.oreb },
  { header: 'DREB', formula: (r) => box('dreb', r), result: (l) => l.dreb },
  { header: 'REB', formula: (r) => box('reb', r), result: (l) => l.reb },
  { header: 'AST', formula: (r) => box('ast', r), result: (l) => l.ast },
  { header: 'STL', formula: (r) => box('stl', r), result: (l) => l.stl },
  { header: 'BLK', formula: (r) => box('blk', r), result: (l) => l.blk },
  { header: 'TO', formula: (r) => box('tov', r), result: (l) => l.tov },
  { header: 'PF', formula: (r) => box('pf', r), result: (l) => l.pf },
  { header: 'TF', formula: (r) => box('tf', r), result: (l) => l.tf },
  // Team fouls = personal + technical (both count toward the bonus).
  { header: 'FOULS', formula: (r) => `${box('pf', r)}+${box('tf', r)}`, result: (l) => l.pf + l.tf },
];
const SUMMARY_FIRST_COL = 3; // A = period label, B = team, stats from C

function writeSummary(ws: ExcelJS.Worksheet, game: Game, totalRows: TotalRows) {
  ws.columns = [{ width: 14 }, { width: 22 }, ...SUMMARY_COLS.map(() => ({ width: 8 }))];
  let r = 1;
  ws.getCell(`A${r}`).value = 'Summary';
  ws.getCell(`A${r}`).font = { bold: true, size: 14 };
  r += 2;

  // ---- Line score ----
  ws.getCell(`A${r}`).value = 'LINE SCORE';
  ws.getCell(`A${r++}`).font = { bold: true };
  const ls = lineScore(game);
  const periods = Array.from({ length: game.currentPeriod }, (_, i) => i + 1);
  const head = ws.getRow(r++);
  head.getCell(2).value = 'Team';
  periods.forEach((p, i) => { head.getCell(SUMMARY_FIRST_COL + i).value = periodLabel(p, game.regulationPeriods); });
  const finalCol = SUMMARY_FIRST_COL + periods.length;
  head.getCell(finalCol).value = 'FINAL';
  styleHeader(head, 1, finalCol);

  game.teams.forEach((team, ti) => {
    const row = ws.getRow(r);
    row.getCell(2).value = team.name;
    periods.forEach((p, i) => {
      row.getCell(SUMMARY_FIRST_COL + i).value = {
        formula: box('pts', totalRows[String(p)]![ti]!),
        result: ls.byPeriod[p]![ti]!,
      };
    });
    row.getCell(finalCol).value = {
      formula: `SUM(${letter(SUMMARY_FIRST_COL)}${r}:${letter(finalCol - 1)}${r})`,
      result: ls.total[ti]!,
    };
    for (let c = 2; c <= finalCol; c++) row.getCell(c).alignment = { horizontal: c === 2 ? 'left' : 'center' };
    row.getCell(2).font = { bold: true };
    row.getCell(finalCol).font = { bold: true };
    r++;
  });
  r += 1;

  // ---- Team fouls per period (personal + technical; resets each quarter) ----
  ws.getCell(`A${r}`).value = 'TEAM FOULS';
  ws.getCell(`A${r++}`).font = { bold: true };
  const fh = ws.getRow(r++);
  fh.getCell(2).value = 'Team';
  periods.forEach((p, i) => { fh.getCell(SUMMARY_FIRST_COL + i).value = periodLabel(p, game.regulationPeriods); });
  fh.getCell(finalCol).value = 'TOTAL';
  styleHeader(fh, 1, finalCol);
  game.teams.forEach((team, ti) => {
    const row = ws.getRow(r);
    const by = teamFoulsByPeriod(game, team);
    row.getCell(2).value = team.name;
    periods.forEach((p, i) => {
      const br = totalRows[String(p)]![ti]!;
      row.getCell(SUMMARY_FIRST_COL + i).value = { formula: `${box('pf', br)}+${box('tf', br)}`, result: by[p]! };
    });
    row.getCell(finalCol).value = {
      formula: `SUM(${letter(SUMMARY_FIRST_COL)}${r}:${letter(finalCol - 1)}${r})`,
      result: periods.reduce((a, p) => a + by[p]!, 0),
    };
    for (let c = 2; c <= finalCol; c++) row.getCell(c).alignment = { horizontal: c === 2 ? 'left' : 'center' };
    row.getCell(2).font = { bold: true };
    row.getCell(finalCol).font = { bold: true };
    r++;
  });
  r += 1;

  const writeStatHeader = (firstCols: [string, string]) => {
    const h = ws.getRow(r++);
    h.getCell(1).value = firstCols[0];
    h.getCell(2).value = firstCols[1];
    SUMMARY_COLS.forEach((c, i) => { h.getCell(SUMMARY_FIRST_COL + i).value = c.header; });
    styleHeader(h, 1, SUMMARY_FIRST_COL + SUMMARY_COLS.length - 1);
  };
  const writeStatRow = (a: string, team: Team, boxRow: number, line: StatLine) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = a;
    row.getCell(2).value = team.name;
    SUMMARY_COLS.forEach((col, i) => {
      const cell = row.getCell(SUMMARY_FIRST_COL + i);
      cell.value = { formula: col.formula(boxRow), result: col.result(line) };
      if (col.pct) cell.numFmt = '0.0%';
      cell.alignment = { horizontal: 'center' };
    });
  };

  // ---- Team totals ----
  ws.getCell(`A${r}`).value = 'TEAM TOTALS (FULL GAME)';
  ws.getCell(`A${r++}`).font = { bold: true };
  writeStatHeader(['', 'Team']);
  game.teams.forEach((team, ti) => writeStatRow('Game', team, totalRows['game']![ti]!, teamTotals(game, team)));
  r += 1;

  // ---- Per period ----
  ws.getCell(`A${r}`).value = 'BY PERIOD';
  ws.getCell(`A${r++}`).font = { bold: true };
  writeStatHeader(['Period', 'Team']);
  for (const p of periods) {
    game.teams.forEach((team, ti) =>
      writeStatRow(periodLabel(p, game.regulationPeriods), team, totalRows[String(p)]![ti]!,
        teamTotals(game, team, { periods: [p] })));
  }

  applyFont(ws);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Unwrap ExcelJS cell values (formula results, rich text, hyperlinks, dates, errors). */
function raw(v: ExcelJS.CellValue | undefined): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('result' in v) return raw(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return undefined;
    return undefined;
  }
  return v;
}

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

const num = (v: unknown): number => {
  if (typeof v === 'number') return v;
  const s = str(v);
  return s === undefined ? NaN : Number(s);
};

const bool = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : undefined;
  const s = str(v)?.toLowerCase();
  if (s === 'true' || s === 'yes' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === '0') return false;
  return undefined;
};

function headerMap(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const k = str(raw(cell.value))?.toLowerCase();
    if (k && !map.has(k)) map.set(k, col);
  });
  return map;
}

const EVENT_TYPES = ['shot', 'freeThrow', 'rebound', 'foul', 'steal', 'turnover'] as const;

export async function importGameFromXlsx(data: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): ImportResult => ({ game: null, errors, warnings });

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    errors.push('Could not read the file: it is not a valid .xlsx workbook.');
    return fail();
  }

  const info = wb.getWorksheet(SHEETS.info);
  const rosterWs = wb.getWorksheet(SHEETS.roster);
  const eventsWs = wb.getWorksheet(SHEETS.events);
  for (const [ws, name] of [[info, SHEETS.info], [rosterWs, SHEETS.roster], [eventsWs, SHEETS.events]] as const) {
    if (!ws) errors.push(`Missing required sheet "${name}".`);
  }
  if (!info || !rosterWs || !eventsWs) return fail();

  // ----- Game Info -----
  const kv = new Map<string, unknown>();
  info.eachRow((row) => {
    const k = str(raw(row.getCell(1).value));
    if (k) kv.set(k, raw(row.getCell(2).value));
  });

  if (str(kv.get('format')) !== XLSX_FORMAT) {
    errors.push('This is not a Hoops Tracker workbook (Game Info is missing format = "hoops-tracker").');
    return fail();
  }
  if (num(kv.get('schemaVersion')) !== 1) {
    errors.push(`Unsupported schemaVersion "${String(kv.get('schemaVersion'))}" (this app reads version 1).`);
    return fail();
  }

  const gameId = str(kv.get('gameId'));
  if (!gameId) errors.push('Game Info: gameId is missing.');
  let date = str(kv.get('date'));
  if (!date) {
    date = new Date().toISOString();
    warnings.push('Game Info: date is missing; using the current time.');
  }
  const regulationPeriods = num(kv.get('regulationPeriods'));
  if (regulationPeriods !== 4) errors.push(`Game Info: regulationPeriods must be 4 (got "${String(kv.get('regulationPeriods'))}").`);
  const currentPeriod = num(kv.get('currentPeriod'));
  if (!Number.isInteger(currentPeriod) || currentPeriod < 1) errors.push('Game Info: currentPeriod must be a whole number >= 1.');
  const courtType = str(kv.get('courtType')) ?? 'nba';
  const endedAt = str(kv.get('endedAt')); // blank = still live

  const teams: Team[] = [];
  for (const slot of ['home', 'away'] as const) {
    const id = str(kv.get(`${slot}.id`));
    if (!id) { errors.push(`Game Info: ${slot}.id is missing.`); continue; }
    teams.push({
      id,
      name: str(kv.get(`${slot}.name`)) ?? (slot === 'home' ? 'Home' : 'Away'),
      color: str(kv.get(`${slot}.color`)) ?? '#888888',
      attacksRightInPeriod1: bool(kv.get(`${slot}.attacksRightInPeriod1`)) ?? slot === 'home',
      players: [],
    });
  }
  if (errors.length) return fail();

  // ----- Roster -----
  const rh = headerMap(rosterWs);
  for (const need of ['teamid', 'playerid']) {
    if (!rh.has(need)) errors.push(`Roster: missing column "${need}".`);
  }
  if (errors.length) return fail();

  const rget = (row: ExcelJS.Row, key: string) => {
    const c = rh.get(key);
    return c ? raw(row.getCell(c).value) : undefined;
  };
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const playerTeam = new Map<ID, ID>();
  for (let r = 2; r <= rosterWs.rowCount; r++) {
    const row = rosterWs.getRow(r);
    const teamId = str(rget(row, 'teamid'));
    const playerId = str(rget(row, 'playerid'));
    if (!teamId && !playerId) continue;
    if (!playerId) { errors.push(`Roster row ${r}: playerId is missing.`); continue; }
    const team = teamId ? teamById.get(teamId) : undefined;
    if (!team) { errors.push(`Roster row ${r}: unknown teamId "${teamId ?? ''}".`); continue; }
    team.players.push({
      id: playerId,
      number: str(rget(row, 'number')) ?? '',
      name: str(rget(row, 'name')) ?? '',
    });
    playerTeam.set(playerId, team.id);
  }

  // ----- Events -----
  const eh = headerMap(eventsWs);
  for (const need of ['type', 'playerid', 'period']) {
    if (!eh.has(need)) errors.push(`Events: missing column "${need}".`);
  }
  if (errors.length) return fail();

  const eget = (row: ExcelJS.Row, f: EventField) => {
    const c = eh.get(f.toLowerCase());
    return c ? raw(row.getCell(c).value) : undefined;
  };

  const events: GameEvent[] = [];
  let lastTs = 0;
  for (let r = 2; r <= eventsWs.rowCount; r++) {
    const row = eventsWs.getRow(r);
    const type = str(eget(row, 'type'));
    const playerId = str(eget(row, 'playerId'));
    if (!type && !playerId) continue; // blank row
    const where = `Events row ${r}`;

    if (!type || !(EVENT_TYPES as readonly string[]).includes(type)) {
      errors.push(`${where}: unknown type "${type ?? ''}" (expected ${EVENT_TYPES.join(', ')}).`);
      continue;
    }
    if (!playerId) { errors.push(`${where}: playerId is missing.`); continue; }
    const period = num(eget(row, 'period'));
    if (!Number.isInteger(period) || period < 1) { errors.push(`${where}: period must be a whole number >= 1.`); continue; }

    let id = str(eget(row, 'id'));
    if (!id) { id = `imported-row-${r}`; warnings.push(`${where}: no id, generated "${id}".`); }
    let ts = num(eget(row, 'ts'));
    if (!Number.isFinite(ts)) { ts = lastTs; warnings.push(`${where}: no ts, reused the previous timestamp.`); }
    lastTs = ts;
    let teamId = str(eget(row, 'teamId'));
    if (!teamId) teamId = playerTeam.get(playerId); // derive from roster (lets people hand-add rows)
    if (!teamId) { errors.push(`${where}: unknown player "${playerId}".`); continue; }

    const base = { id, teamId, playerId, period, ts };

    switch (type as (typeof EVENT_TYPES)[number]) {
      case 'shot': {
        const points = num(eget(row, 'points'));
        const made = bool(eget(row, 'made'));
        const x = num(eget(row, 'x'));
        const y = num(eget(row, 'y'));
        if (points !== 2 && points !== 3) { errors.push(`${where}: points must be 2 or 3.`); continue; }
        if (made === undefined) { errors.push(`${where}: made must be TRUE or FALSE.`); continue; }
        if (!Number.isFinite(x) || !Number.isFinite(y)) { errors.push(`${where}: x and y must be numbers.`); continue; }
        const assistedBy = str(eget(row, 'assistedBy'));
        const blockedBy = str(eget(row, 'blockedBy'));
        events.push({
          ...base, type: 'shot', points, made, x, y,
          ...(assistedBy ? { assistedBy } : {}),
          ...(blockedBy ? { blockedBy } : {}),
        });
        break;
      }
      case 'freeThrow': {
        const made = bool(eget(row, 'made'));
        if (made === undefined) { errors.push(`${where}: made must be TRUE or FALSE.`); continue; }
        events.push({ ...base, type: 'freeThrow', made });
        break;
      }
      case 'rebound': {
        const kind = str(eget(row, 'kind'))?.toLowerCase();
        if (kind !== 'offensive' && kind !== 'defensive') { errors.push(`${where}: kind must be "offensive" or "defensive".`); continue; }
        events.push({ ...base, type: 'rebound', kind });
        break;
      }
      case 'foul': {
        const kind = str(eget(row, 'kind'))?.toLowerCase();
        if (kind !== 'personal' && kind !== 'technical') { errors.push(`${where}: kind must be "personal" or "technical".`); continue; }
        events.push({ ...base, type: 'foul', kind });
        break;
      }
      case 'steal':
      case 'turnover':
        events.push({ ...base, type: type as 'steal' | 'turnover' });
        break;
    }
  }
  if (errors.length) return fail();

  const game: Game = {
    schemaVersion: 1,
    id: gameId!,
    date,
    ...(str(kv.get('location')) ? { location: str(kv.get('location'))! } : {}),
    regulationPeriods: 4,
    courtType: courtType as CourtType,
    currentPeriod,
    ...(endedAt ? { endedAt } : {}),
    teams: [teams[0]!, teams[1]!],
    events,
  };

  errors.push(...validateGame(game));
  return errors.length ? fail() : { game, errors, warnings };
}

import { describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { exportGameToWorkbook, exportGameToXlsx, importGameFromXlsx, SHEETS } from './xlsx';
import { computeStats, emptyLine, lineScore } from './stats';
import { validateGame } from './validate';
import { generateGame, sampleGame } from './fixtures';
import type { Game } from './types';

const toBuf = async (wb: ExcelJS.Workbook) => new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);

/** Export, let the caller edit the workbook, then import the result. */
async function editAndImport(game: Game, edit: (wb: ExcelJS.Workbook) => void) {
  const wb = exportGameToWorkbook(game);
  edit(wb);
  return importGameFromXlsx(await toBuf(wb));
}

function setInfo(wb: ExcelJS.Workbook, key: string, value: ExcelJS.CellValue) {
  const ws = wb.getWorksheet(SHEETS.info)!;
  ws.eachRow((row) => { if (row.getCell(1).value === key) row.getCell(2).value = value; });
}

describe('round trip', () => {
  test('sample game survives export -> import unchanged', async () => {
    const game = sampleGame();
    const res = await importGameFromXlsx(await exportGameToXlsx(game));
    expect(res.errors).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.game).toEqual(game);
  });

  test('larger generated game (300 events, OT) survives unchanged', async () => {
    const game = generateGame(42, 300);
    expect(validateGame(game)).toEqual([]);
    const res = await importGameFromXlsx(await exportGameToXlsx(game));
    expect(res.errors).toEqual([]);
    expect(res.game).toEqual(game);
  });

  test('jerseys "00" and "0" stay distinct text', async () => {
    const res = await importGameFromXlsx(await exportGameToXlsx(generateGame(1, 20)));
    const nums = res.game!.teams[0].players.map((p) => p.number);
    expect(nums.slice(0, 2)).toEqual(['0', '00']);
  });

  test('empty game round-trips', async () => {
    const g = { ...sampleGame(), events: [], currentPeriod: 1 };
    const res = await importGameFromXlsx(await exportGameToXlsx(g));
    expect(res.errors).toEqual([]);
    expect(res.game).toEqual(g);
  });

  test('optional location is preserved and absent when blank', async () => {
    const g = generateGame(3, 10);
    expect((await importGameFromXlsx(await exportGameToXlsx(g))).game!.location).toBe('Test Gym');
    expect((await importGameFromXlsx(await exportGameToXlsx(sampleGame()))).game).not.toHaveProperty('location');
  });
});

describe('derived sheets', () => {
  test('sheet names and order', () => {
    const wb = exportGameToWorkbook(sampleGame());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Game Info', 'Roster', 'Events', 'Box Score', 'Summary']);
  });

  test('Box Score full-game cached values equal computeStats, and cells are real formulas', async () => {
    const game = generateGame(7, 300);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toBuf(exportGameToWorkbook(game))) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(SHEETS.box)!;
    const stats = computeStats(game);
    const seen = new Set<string>();
    let checked = 0;
    ws.eachRow((row) => {
      const id = row.getCell(1).value;
      if (typeof id !== 'string' || seen.has(id)) return; // first occurrence = FULL GAME section
      const line = stats.get(id) ?? emptyLine();
      if (!game.teams.some((t) => t.players.some((p) => p.id === id))) return;
      seen.add(id);
      const val = (c: number) => {
        const v = row.getCell(c).value as { formula?: string; result?: unknown };
        expect(v.formula, `col ${c} should be a formula`).toBeTruthy();
        // ExcelJS's reader reports a cached 0 as "no result" (the file itself holds <v>0</v>).
        return v.result ?? 0;
      };
      expect(val(4)).toBe(line.pts);
      expect(val(5)).toBe(line.reb);
      expect(val(8)).toBe(line.ast);
      expect(val(12)).toBe(line.fg2m + line.fg3m);
      expect(val(13)).toBe(line.fg2a + line.fg3a);
      expect(val(20)).toBe(line.ftm);
      checked++;
    });
    expect(checked).toBe(16);
  });

  test('Summary line score matches lineScore()', async () => {
    const game = generateGame(9, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toBuf(exportGameToWorkbook(game))) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(SHEETS.summary)!;
    const ls = lineScore(game);
    const finalCol = 3 + game.currentPeriod;
    const cell = (r: number, c: number) => (ws.getRow(r).getCell(c).value as { result: number }).result;
    // header at row 4, teams at rows 5 and 6
    expect(cell(5, finalCol)).toBe(ls.total[0]);
    expect(cell(6, finalCol)).toBe(ls.total[1]);
    expect(cell(5, 3)).toBe(ls.byPeriod[1]![0]);
  });

  test('editing Box Score / Summary does not change what is imported', async () => {
    const game = sampleGame();
    const res = await editAndImport(game, (wb) => {
      wb.getWorksheet(SHEETS.box)!.getCell('D6').value = 999;
      wb.getWorksheet(SHEETS.summary)!.getCell('C5').value = 999;
    });
    expect(res.game).toEqual(game);
  });
});

describe('import leniency (hand-edited files)', () => {
  test('a hand-added row can omit id, teamId and ts', async () => {
    const game = sampleGame();
    const res = await editAndImport(game, (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      const r = ws.getRow(ws.rowCount + 1);
      r.getCell(2).value = 'steal'; // type
      r.getCell(4).value = 'a1'; // playerId
      r.getCell(5).value = 2; // period
    });
    expect(res.errors).toEqual([]);
    expect(res.warnings.length).toBe(2); // id + ts
    const added = res.game!.events.at(-1)!;
    expect(added).toMatchObject({ type: 'steal', playerId: 'a1', teamId: 'away', period: 2 });
  });

  test('text booleans, numeric jerseys and reordered columns are accepted', async () => {
    const game = sampleGame();
    const res = await editAndImport(game, (wb) => {
      const ev = wb.getWorksheet(SHEETS.events)!;
      ev.getRow(2).getCell(8).value = 'TRUE'; // made as text
      const ro = wb.getWorksheet(SHEETS.roster)!;
      ro.getRow(2).getCell(4).value = 7; // jersey typed as a number
    });
    expect(res.errors).toEqual([]);
    expect(res.game!.events[0]).toMatchObject({ made: true });
    expect(res.game!.teams[0].players[0]!.number).toBe('7');
  });

  test('blank rows in Events are skipped', async () => {
    const game = sampleGame();
    const res = await editAndImport(game, (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(ws.rowCount + 3).getCell(1).value = ''; // stray empty cell further down
    });
    expect(res.errors).toEqual([]);
    expect(res.game!.events).toHaveLength(game.events.length);
  });

  test('deleting a row in Events removes that event', async () => {
    const game = sampleGame();
    const res = await editAndImport(game, (wb) => wb.getWorksheet(SHEETS.events)!.spliceRows(2, 1));
    expect(res.game!.events).toHaveLength(game.events.length - 1);
    expect(res.game!.events[0]!.id).toBe(game.events[1]!.id);
  });
});

describe('import errors', () => {
  test('garbage bytes', async () => {
    const res = await importGameFromXlsx(new Uint8Array([1, 2, 3, 4]));
    expect(res.game).toBeNull();
    expect(res.errors[0]).toMatch(/not a valid \.xlsx/);
  });

  test('a workbook from something else', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['hello']);
    const res = await importGameFromXlsx(await toBuf(wb));
    expect(res.game).toBeNull();
    expect(res.errors.join(' ')).toMatch(/Missing required sheet/);
  });

  test('wrong format marker', async () => {
    const res = await editAndImport(sampleGame(), (wb) => setInfo(wb, 'format', 'other-app'));
    expect(res.errors[0]).toMatch(/not a Hoops Tracker workbook/);
  });

  test('unsupported schemaVersion', async () => {
    const res = await editAndImport(sampleGame(), (wb) => setInfo(wb, 'schemaVersion', 2));
    expect(res.errors[0]).toMatch(/Unsupported schemaVersion/);
  });

  test('missing Events sheet', async () => {
    const res = await editAndImport(sampleGame(), (wb) => wb.removeWorksheet(wb.getWorksheet(SHEETS.events)!.id));
    expect(res.errors).toEqual(['Missing required sheet "Events".']);
  });

  test('unknown event type is reported with its row number', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      wb.getWorksheet(SHEETS.events)!.getRow(4).getCell(2).value = 'dunk';
    });
    expect(res.game).toBeNull();
    expect(res.errors).toEqual(['Events row 4: unknown type "dunk" (expected shot, freeThrow, rebound, foul, steal, turnover).']);
  });

  test('unknown player is reported', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(2).getCell(4).value = 'ghost';
    });
    expect(res.game).toBeNull();
    expect(res.errors.join('\n')).toMatch(/ghost/);
  });

  test('coordinates outside 0..1 are reported', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      wb.getWorksheet(SHEETS.events)!.getRow(3).getCell(9).value = 1.5; // row 3 is a shot
    });
    expect(res.errors.join('\n')).toMatch(/coordinates out of range/);
  });

  test('shot with 4 points and non-boolean made', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(2).getCell(7).value = 4;
      ws.getRow(3).getCell(8).value = 'maybe';
    });
    expect(res.errors.join('\n')).toMatch(/Events row 2: points must be 2 or 3/);
    expect(res.errors.join('\n')).toMatch(/Events row 3: made must be TRUE or FALSE/);
  });

  test('assist on a missed shot is caught by the validator', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(3).getCell(11).value = 'h1'; // row 3 = missed shot by h2
    });
    expect(res.errors.join('\n')).toMatch(/assist on a missed shot/);
  });

  test('duplicate event ids are rejected', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(3).getCell(1).value = ws.getRow(2).getCell(1).value;
    });
    expect(res.errors.join('\n')).toMatch(/Duplicate event id/);
  });

  test('unknown roster team', async () => {
    const res = await editAndImport(sampleGame(), (wb) => {
      wb.getWorksheet(SHEETS.roster)!.getRow(2).getCell(1).value = 'nope';
    });
    expect(res.errors.join('\n')).toMatch(/Roster row 2: unknown teamId/);
  });

  test('unknown court type alone', async () => {
    const res = await editAndImport(sampleGame(), (wb) => setInfo(wb, 'courtType', 'moon'));
    expect(res.errors.join('\n')).toMatch(/Unknown courtType/);
  });
});

describe('fouls in the workbook', () => {
  test('fouls round-trip (kind column) and the player/team counts are preserved', async () => {
    const game = generateGame(11, 300);
    const fouls = game.events.filter((e) => e.type === 'foul');
    expect(fouls.length).toBeGreaterThan(10);
    expect(fouls.some((e) => e.type === 'foul' && e.kind === 'technical')).toBe(true);
    const res = await importGameFromXlsx(await exportGameToXlsx(game));
    expect(res.errors).toEqual([]);
    expect(res.game).toEqual(game);
  });

  test('bad foul kind and an over-limit player are rejected on import', async () => {
    const bad = await editAndImport(sampleGame(), (wb) => {
      const ws = wb.getWorksheet(SHEETS.events)!;
      ws.getRow(ws.rowCount).getCell(13).value = 'flagrant'; // last row is a foul; kind column = 13
    });
    expect(bad.errors.join(' ')).toMatch(/kind must be "personal" or "technical"/);

    const six = { ...sampleGame(), events: [] as Game['events'] };
    for (let i = 0; i < 6; i++) six.events.push({ id: `f${i}`, teamId: 'home', playerId: 'h1', period: 1, ts: i, type: 'foul', kind: 'personal' });
    const res = await importGameFromXlsx(await exportGameToXlsx(six));
    expect(res.errors.join(' ')).toMatch(/6 fouls/);
  });

  test('Box Score PF/TF and Summary team fouls carry cached values equal to the stats', async () => {
    const game = generateGame(5, 300);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toBuf(exportGameToWorkbook(game))) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet(SHEETS.box)!;
    const stats = computeStats(game);
    let checked = 0;
    const seen = new Set<string>();
    ws.eachRow((row) => {
      const id = row.getCell(1).value;
      if (typeof id !== 'string' || seen.has(id) || !stats.has(id)) return;
      seen.add(id);
      const cell = (c: number) => ((row.getCell(c).value as { result?: number }).result ?? 0);
      expect(cell(23)).toBe(stats.get(id)!.pf); // PF is the 20th stat column -> sheet column 23
      expect(cell(24)).toBe(stats.get(id)!.tf);
      checked++;
    });
    expect(checked).toBeGreaterThan(10);
  });
});

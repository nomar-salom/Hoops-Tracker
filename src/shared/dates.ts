import type { Game } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date in the USER'S time zone, "YYYY-MM-DD". (Slicing the ISO string gives the UTC date, which is tomorrow for an evening game in the Americas.) */
export function localDateStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO instant -> the "YYYY-MM-DDTHH:mm" local-time string an <input type="datetime-local"> expects. */
export function toDateTimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${localDateStamp(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value (local time, no zone) -> ISO instant, or null if it isn't a valid date. */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'team';

/** "2026-10-01_Hawks_vs_Owls.xlsx" (local date). */
export function gameFileName(game: Pick<Game, 'date' | 'teams'>, ext = 'xlsx'): string {
  return `${localDateStamp(game.date)}_${safe(game.teams[0].name)}_vs_${safe(game.teams[1].name)}.${ext}`;
}

/** Same, plus the moment it was archived so repeated backups of one game never overwrite each other. */
export function archiveFileName(game: Pick<Game, 'date' | 'teams'>, savedAtIso: string): string {
  const stamp = savedAtIso.replace(/[:.]/g, '-').replace(/Z$/, '');
  return gameFileName(game).replace(/\.xlsx$/, `_saved-${stamp}.xlsx`);
}

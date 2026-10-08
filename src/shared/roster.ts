import type { Team } from './types';

export interface ParsedPlayer {
  number: string;
  name: string;
}

/**
 * Parse pasted roster text, one player per line. Accepted shapes:
 *   "23 Ben Smith"   "#23 Ben"   "23, Ben"   "23<TAB>Ben"   "23 - Ben"
 *   "Ben Smith 23"   "Ben #23"   "00 Eli"    "7" (number only)   "Ben" (name only)
 * Jersey numbers stay strings, so "00" and "0" remain different players.
 */
export function parseRosterText(text: string): ParsedPlayer[] {
  const out: ParsedPlayer[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let m = /^#?\s*(\d{1,3})(?:\s*[,\t\-–:.]\s*|\s+|$)(.*)$/.exec(line);
    if (m) {
      out.push({ number: m[1]!, name: m[2]!.trim() });
      continue;
    }
    m = /^(.*?)[\s,]+#?(\d{1,3})$/.exec(line);
    if (m) {
      out.push({ number: m[2]!, name: m[1]!.trim() });
      continue;
    }
    out.push({ number: '', name: line });
  }
  return out;
}

/** Numeric jerseys first in numeric order ("0" before "00"), then non-numeric, then blank. */
export function compareJersey(a: string, b: string): number {
  const rank = (s: string) => (s === '' ? 2 : /^\d+$/.test(s) ? 0 : 1);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const d = Number(a) - Number(b);
    return d !== 0 ? d : a.length - b.length;
  }
  return a.localeCompare(b);
}

/** Human-readable problems with a roster. Warnings only; none of these block play. */
export function rosterIssues(team: Team): string[] {
  const issues: string[] = [];
  const byNumber = new Map<string, string[]>();
  for (const p of team.players) {
    if (p.number === '') issues.push(`${p.name || 'A player'} has no jersey number.`);
    else byNumber.set(p.number, [...(byNumber.get(p.number) ?? []), p.name || 'unnamed']);
    if (p.name.trim() === '' && p.number !== '') issues.push(`#${p.number} has no name.`);
  }
  for (const [num, names] of byNumber) {
    if (names.length > 1) issues.push(`${names.length} players wear #${num} (${names.join(', ')}).`);
  }
  return issues;
}

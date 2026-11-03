import { get } from '../db.ts';
import { localParts, validTimeZone } from '../campaign/time.ts';

/**
 * Times written in mail ("Thursday 12 November at 3:00 PM PKT") as real
 * instants: the zone written after the time gives the offset, and the instant
 * is stored in UTC next to the wall time and the original words. A time with
 * no zone stays as written (the sender's zone is not guessed). The owner sees
 * instants in their own zone: the campaign's active-hours zone.
 */

export interface WrittenTime {
  /** The wall time as written, "YYYY-MM-DDTHH:MM" (the form `dates` uses). */
  local: string;
  /** The UTC instant (ISO), or null when no zone was written. */
  at: string | null;
  /** The zone as written ("PKT", "GMT+5", "ET"), or null. */
  zone: string | null;
  /** The words in the email, date through zone. */
  text: string;
}

/**
 * Zone abbreviations with one everyday meaning, as minutes east of UTC. Ambiguous ones (IST, AST, BST-as-Bangladesh)
 * are left out: an unknown zone keeps the time as written. Generic names follow daylight saving through IANA.
 */
const ZONES: Record<string, number | string> = {
  utc: 0, gmt: 0, z: 0, wet: 0, west: 60, bst: 60, cet: 60, cest: 120, eet: 120, eest: 180, msk: 180, gst: 240, pkt: 300,
  sgt: 480, hkt: 480, jst: 540, kst: 540, aest: 600, aedt: 660, nzst: 720, nzdt: 780,
  est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420,
  et: 'America/New_York', ct: 'America/Chicago', mt: 'America/Denver', pt: 'America/Los_Angeles',
  eastern: 'America/New_York', central: 'America/Chicago', mountain: 'America/Denver', pacific: 'America/Los_Angeles',
  uk: 'Europe/London', london: 'Europe/London', pakistan: 'Asia/Karachi', karachi: 'Asia/Karachi', lahore: 'Asia/Karachi', dubai: 'Asia/Dubai', berlin: 'Europe/Berlin',
};

const ZONE_AFTER =
  /^\s*\(?\s*(?:(utc|gmt)\s*(?:([+-])\s*(\d{1,2})(?::?(\d{2}))?)?|([+-])(\d{2}):?(\d{2})|(eastern|central|mountain|pacific|uk|london|pakistan|karachi|lahore|dubai|berlin)\s+time|([a-z]{1,4}))(?![a-z])\)?/i;

/** The zone written right after a time (`rest` is the text that follows it): its words and how to find the offset. */
export function zoneAfter(rest: string): { zone: string; length: number; offsetAt: (wallMs: number) => number } | null {
  const m = ZONE_AFTER.exec(rest.slice(0, 40));
  if (!m) return null;
  const zone = m[0].replace(/^\s*\(?\s*|\s*\)?$/g, '');
  const fixed = (min: number) => ({ zone, length: m[0].length, offsetAt: () => min });
  if (m[1]) return fixed(m[3] ? (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4] ?? 0)) : 0);
  if (m[5]) return fixed((m[5] === '-' ? -1 : 1) * (Number(m[6]) * 60 + Number(m[7])));
  const z = ZONES[(m[8] ?? m[9]).toLowerCase()];
  if (z === undefined) return null;
  if (typeof z === 'number') return fixed(z);
  return { zone, length: m[0].length, offsetAt: (wallMs) => ianaOffset(wallMs, z) };
}

/** Minutes east of UTC for an IANA zone around a wall time (read as if UTC), DST included. */
function ianaOffset(wallMs: number, tz: string): number {
  const off = (ms: number) => {
    const p = localParts(ms, tz);
    return (Date.parse(`${p.date}T00:00:00Z`) + p.minutes * 60_000 - (ms - (ms % 60_000))) / 60_000;
  };
  // The offset at the guessed instant, then again at the corrected one (the two differ only across a DST change).
  const first = off(wallMs);
  return off(wallMs - first * 60_000);
}

/** "2026-11-12T15:00" written in a zone → the UTC instant (ISO). */
export function toInstant(local: string, offsetAt: (wallMs: number) => number): string | null {
  const wall = Date.parse(`${local}:00Z`);
  if (Number.isNaN(wall)) return null;
  return new Date(wall - offsetAt(wall) * 60_000).toISOString();
}

/** The owner's time zone: the campaign of this application, else the latest campaign, else this machine's. */
export function ownerTimeZone(applicationId?: string | null): string {
  const rows = [
    applicationId ? get<{ config: string }>('SELECT c.config FROM applications a JOIN campaigns c ON c.id = a.campaign_id WHERE a.id = ?', applicationId) : undefined,
    get<{ config: string }>("SELECT config FROM campaigns ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1"),
  ];
  for (const r of rows) {
    try {
      const tz = (JSON.parse(r?.config ?? '{}') as { activeHours?: { tz?: string } }).activeHours?.tz;
      if (tz && validTimeZone(tz)) return tz;
    } catch {
      /* a broken config: try the next */
    }
  }
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return local && validTimeZone(local) ? local : 'UTC';
}

/**
 * How the owner sees an interview time: in their zone when the email gave one ("Thu 12 Nov, 15:00 Asia/Karachi"),
 * otherwise as written, saying the zone was not stated. Dates without a time are shown as they are.
 */
export function showTime(local: string, written: WrittenTime | null | undefined, tz: string): string {
  if (written?.at) {
    const shown = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(written.at));
    return `${shown.replace(/ at /, ', ')} ${tz}${written.zone ? ` (written as ${written.zone})` : ''}`;
  }
  return local.includes('T') ? `${local.replace('T', ' ')} (time zone not stated)` : local;
}

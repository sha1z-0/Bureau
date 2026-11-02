/**
 * Time-zone arithmetic for active hours, local days and employer business
 * hours, on Intl alone (no tz database dependency).
 */

export interface Window {
  tz: string;
  /** "HH:MM" */
  start: string;
  /** "HH:MM"; earlier than start means the window runs past midnight. */
  end: string;
}

export interface LocalParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  seconds: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz: string): boolean {
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(ms: number, tz: string): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
    seconds: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

export const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h % 24) * 60 + (m % 60);
};

export function inWindow(ms: number, w: Window): boolean {
  const { minutes } = localParts(ms, w.tz);
  const s = hhmm(w.start);
  const e = hhmm(w.end);
  if (s === e) return true; // a 24-hour window
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** The next moment (≥ ms) the window is open. Returns ms itself when it already is. */
export function nextWindowStart(ms: number, w: Window): number {
  if (inWindow(ms, w)) return ms;
  const { minutes, seconds } = localParts(ms, w.tz);
  const delta = (hhmm(w.start) - minutes + 1440) % 1440;
  let cand = ms + delta * 60_000 - seconds * 1000;
  // DST shifts can land the guess an hour off; walk forward until it is open.
  for (let i = 0; i < 4 * 50 && !inWindow(cand, w); i++) cand += 15 * 60_000;
  return cand;
}

/** When the current window closes (or ms itself when closed). */
export function windowEnd(ms: number, w: Window): number {
  if (!inWindow(ms, w)) return ms;
  const { minutes, seconds } = localParts(ms, w.tz);
  const delta = (hhmm(w.end) - minutes + 1440) % 1440 || 1440;
  return ms + delta * 60_000 - seconds * 1000;
}

/** Epoch ms of local midnight for the day containing ms. */
export function startOfLocalDay(ms: number, tz: string): number {
  const { minutes, seconds } = localParts(ms, tz);
  const guess = ms - minutes * 60_000 - seconds * 1000 - (ms % 1000);
  // On a DST day midnight may be ±1h off the guess; correct to the date boundary.
  const day = localParts(ms, tz).date;
  if (localParts(guess, tz).date !== day) return guess + 3_600_000;
  if (localParts(guess - 1, tz).date === day) return guess - 3_600_000;
  return guess;
}

/** Whole local calendar days from a to b (b later). */
export function localDaysBetween(aMs: number, bMs: number, tz: string): number {
  const a = Date.parse(`${localParts(aMs, tz).date}T00:00:00Z`);
  const b = Date.parse(`${localParts(bMs, tz).date}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** The time-of-day `at` ("HH:MM") on the local day containing ms. */
export function localTimeOnDay(ms: number, tz: string, at: string): number {
  return startOfLocalDay(ms, tz) + hhmm(at) * 60_000;
}

/** ISO week key, e.g. 2026-W45, for the local date. */
export function isoWeek(ms: number, tz: string): string {
  const d = new Date(`${localParts(ms, tz).date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ── Employer business hours ──────────────────────────────────────────────────

/** Rough location → time zone, for the common cases job posts name. Null when unknown or remote-anywhere. */
const TZ_HINTS: [RegExp, string][] = [
  [/\b(san francisco|bay area|sf|seattle|los angeles|la|portland|san diego|san jose|palo alto|mountain view|pacific|pst|pdt|california|ca|wa|oregon|vancouver)\b/i, 'America/Los_Angeles'],
  [/\b(denver|boulder|salt lake|phoenix|arizona|colorado|mountain time)\b/i, 'America/Denver'],
  [/\b(chicago|austin|dallas|houston|minneapolis|texas|tx|central time|cst|cdt)\b/i, 'America/Chicago'],
  [/\b(new york|nyc|ny|boston|washington|dc|atlanta|miami|philadelphia|pittsburgh|eastern|est|edt|florida)\b/i, 'America/New_York'],
  [/\b(toronto|montreal|ottawa)\b/i, 'America/Toronto'],
  [/\b(london|uk|united kingdom|england|scotland|manchester|edinburgh|bristol)\b/i, 'Europe/London'],
  [/\b(dublin|ireland)\b/i, 'Europe/Dublin'],
  [/\b(berlin|munich|hamburg|germany|frankfurt)\b/i, 'Europe/Berlin'],
  [/\b(paris|france|lyon)\b/i, 'Europe/Paris'],
  [/\b(amsterdam|netherlands|rotterdam)\b/i, 'Europe/Amsterdam'],
  [/\b(madrid|barcelona|spain)\b/i, 'Europe/Madrid'],
  [/\b(lisbon|portugal)\b/i, 'Europe/Lisbon'],
  [/\b(stockholm|sweden)\b/i, 'Europe/Stockholm'],
  [/\b(warsaw|poland|krakow)\b/i, 'Europe/Warsaw'],
  [/\b(zurich|switzerland|geneva)\b/i, 'Europe/Zurich'],
  [/\b(dubai|uae|abu dhabi)\b/i, 'Asia/Dubai'],
  [/\b(riyadh|saudi)\b/i, 'Asia/Riyadh'],
  [/\b(lahore|karachi|islamabad|rawalpindi|pakistan)\b/i, 'Asia/Karachi'],
  [/\b(bangalore|bengaluru|mumbai|delhi|hyderabad|pune|chennai|india|gurgaon|noida)\b/i, 'Asia/Kolkata'],
  [/\b(singapore)\b/i, 'Asia/Singapore'],
  [/\b(tokyo|japan)\b/i, 'Asia/Tokyo'],
  [/\b(sydney|melbourne|australia)\b/i, 'Australia/Sydney'],
];

export function employerTimeZone(location: string | null | undefined): string | null {
  if (!location) return null;
  for (const [re, tz] of TZ_HINTS) if (re.test(location)) return tz;
  return null;
}

/** Weekday 09:00–18:00 in the employer's zone. Null when the zone is unknown. */
export function inEmployerHours(ms: number, tz: string | null): boolean | null {
  if (!tz) return null;
  const p = localParts(ms, tz);
  return p.weekday >= 1 && p.weekday <= 5 && p.minutes >= 9 * 60 && p.minutes < 18 * 60;
}

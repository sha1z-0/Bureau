import type { RawJob } from '../contracts/job.ts';
import type { Category } from '../sources/types.ts';

/**
 * Normalisation that runs on every posting, whatever the source: salary
 * parsing and annualisation, work mode (remote / hybrid / onsite), visa
 * mentions, seniority and relative posting dates. Results land in the RawJob's
 * own fields (salary, remote, postedAt) and as namespaced tags the matcher can
 * read: `mode:remote|hybrid|onsite`, `visa:sponsors|no-sponsorship`,
 * `level:intern|junior|mid|senior|lead`.
 */

/**
 * The v1 classifier files any "…Engineer" title under `software`. Civil,
 * mechanical, process and similar engineering roles aren't reachable for a
 * software candidate, so the scout drops them unless the title also names
 * software work.
 */
const NON_SOFTWARE_ENG =
  /\b(civil|mechanical|electrical|structural|chemical|process|manufacturing|industrial|quality|validation|planning|cost|hvac|construction|geotechnical|environmental|mining|petroleum|biomedical|field service|maintenance|facilities|project controls|commissioning|piping|estimating|surveying|wastewater|transportation|traffic|nuclear|packaging|plant|production|hardware|asic|fpga|analog|rf|pcb|optical|photonics|manufacturing|mep|design manager|sales engineer|solutions? engineer|pre-?sales)\b/i;
const SOFTWARE_HINT =
  /\b(software|firmware|embedded|data|cloud|platform|devops|security|cyber|machine learning|ml|ai|web|backend|back-end|frontend|front-end|full.?stack|application|automation|sre|site reliability|network|game|mobile|ios|android|developer|programmer)\b/i;

export function relevantTitle(title: string, category: Category): boolean {
  if (category !== 'software') return true;
  return !(NON_SOFTWARE_ENG.test(title) && !SOFTWARE_HINT.test(title));
}

export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';
export interface ParsedSalary {
  min: number;
  max: number;
  currency: string;
  period: SalaryPeriod;
}

const PERIOD_FACTOR: Record<SalaryPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

const CURRENCIES: [RegExp, string][] = [
  [/\bPKR\b|\bRs\.?(?=\s?\d)|rupees/i, 'PKR'],
  [/\bINR\b|₹|\blakh|\blpa\b/i, 'INR'],
  [/\bAED\b|dirham/i, 'AED'],
  [/\bSAR\b|riyal/i, 'SAR'],
  [/\bQAR\b/i, 'QAR'],
  [/\bCAD\b|C\$|CA\$/i, 'CAD'],
  [/\bAUD\b|A\$|AU\$/i, 'AUD'],
  [/\bSGD\b|S\$/i, 'SGD'],
  [/\bCHF\b/i, 'CHF'],
  [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'],
  [/\$|\bUSD\b/i, 'USD'],
];

function detectPeriod(text: string): SalaryPeriod | null {
  if (/(per|an|\/|a)\s*(hour|hr)\b|hourly/i.test(text)) return 'hour';
  if (/(per|a|\/)\s*day\b|daily rate/i.test(text)) return 'day';
  if (/(per|a|\/)\s*week\b|weekly/i.test(text)) return 'week';
  if (/(per|a|\/)\s*(month|mo)\b|monthly|\bp\.?m\.?\b/i.test(text)) return 'month';
  if (/(per|a|\/)\s*(year|yr|annum)\b|annual|yearly|\bp\.?a\.?\b|\bLPA\b/i.test(text)) return 'year';
  return null;
}

/**
 * Pull a salary range out of free text ("$120k – $150k", "PKR 150,000 - 200,000 per month",
 * "€55.000–€70.000", "12-18 LPA"). Returns null unless a plausible amount is found.
 */
export function parseSalaryText(text: string | null | undefined): ParsedSalary | null {
  if (!text) return null;
  const t = text.replace(/ /g, ' ');
  const currency = CURRENCIES.find(([re]) => re.test(t))?.[1] ?? null;
  const lakhs = /lakh|lpa/i.test(t);
  const nums = [...t.matchAll(/(\d{1,3}(?:[,.\s]\d{3})+|\d+(?:\.\d+)?)\s*(k|m|lakhs?|lpa)?\b/gi)]
    .map((m) => {
      let raw = m[1];
      // "55.000" (European thousands) vs "55.5" (decimal)
      if (/^\d{1,3}([.,\s]\d{3})+$/.test(raw)) raw = raw.replace(/[.,\s]/g, '');
      let n = Number(raw);
      const unit = (m[2] ?? '').toLowerCase();
      if (unit === 'k') n *= 1_000;
      else if (unit === 'm') n *= 1_000_000;
      else if (unit.startsWith('lakh') || unit === 'lpa' || (lakhs && n < 1000)) n *= 100_000;
      return n;
    })
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length || !currency) return null;
  let period = detectPeriod(t);
  const plausible = nums.filter((n) => n >= 7); // drops "5 years", "401k" survives as 401000 only with k… filtered next
  if (!plausible.length) return null;
  let min = Math.min(...plausible.slice(0, 2));
  let max = Math.max(...plausible.slice(0, 2));
  // Guess the period from magnitude when the text doesn't say.
  if (!period) period = max < 300 ? 'hour' : max < 20_000 && !['PKR', 'INR'].includes(currency) ? 'month' : 'year';
  if (period === 'hour' && max > 1000) period = 'year';
  if (min < max / 10) min = max; // "1 position, $90,000" style noise
  if (max <= 0) return null;
  return { min, max, currency, period };
}

export function annualise(amount: number | null | undefined, period: SalaryPeriod | null | undefined): number | null {
  if (!amount || !Number.isFinite(amount)) return null;
  return Math.round(amount * PERIOD_FACTOR[period ?? 'year']);
}

/** Relative "posted" text → ISO date. Handles Workday ("Posted 3 Days Ago", "Posted 30+ Days Ago"), "37 mins ago", "yesterday". */
export function relativePosted(text: string | null | undefined, now = Date.now()): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const day = 86_400_000;
  if (/today|just now|few (seconds|minutes)/.test(t)) return new Date(now).toISOString();
  if (/yesterday/.test(t)) return new Date(now - day).toISOString();
  const m = t.match(/(\d+)\+?\s*(second|sec|minute|min|hour|hr|day|week|month|year)s?/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms =
    unit.startsWith('sec') ? 1000 : unit.startsWith('min') ? 60_000 : unit.startsWith('h') ? 3_600_000 : unit === 'day' ? day : unit === 'week' ? 7 * day : unit === 'month' ? 30 * day : 365 * day;
  return new Date(now - n * ms).toISOString();
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

export function workMode(job: Pick<RawJob, 'remote' | 'location' | 'title' | 'tags' | 'descriptionText'>): WorkMode | null {
  const tagged = (job.tags ?? []).find((t) => /^mode:/.test(t))?.slice(5).toLowerCase();
  if (tagged && /remote|hybrid|onsite|on-site|in.?office/.test(tagged)) return tagged.startsWith('remote') ? 'remote' : tagged.startsWith('hybrid') ? 'hybrid' : 'onsite';
  const head = `${job.title} ${job.location}`;
  if (/hybrid/i.test(head)) return 'hybrid';
  if (job.remote || /remote|anywhere|work from home|wfh/i.test(head)) return 'remote';
  const body = (job.descriptionText ?? '').slice(0, 4000);
  if (/\bhybrid\b/i.test(body)) return 'hybrid';
  if (/\b(on-?site|in-?office|in the office \d|office-based)\b/i.test(body)) return 'onsite';
  if (/\b(fully remote|100% remote|remote-first|work from anywhere)\b/i.test(body)) return 'remote';
  return job.location ? 'onsite' : null;
}

export function visaMention(text: string): 'sponsors' | 'no-sponsorship' | null {
  const t = text.slice(0, 20_000);
  if (/(not|no|unable to|cannot|can't|won't|will not|without)\s+(\w+\s+){0,4}(visa\s+)?sponsor|sponsorship (is )?not (available|provided|offered)|must (be|have) (authori[sz]ed|eligible) to work .{0,40}without (visa )?sponsorship|no visa support/i.test(t)) {
    return 'no-sponsorship';
  }
  if (/visa sponsorship (is )?(available|provided|offered)|we (can |will |do )?sponsor (work )?visas?|relocation and visa|visa support|sponsorship available|h-?1b (transfer|sponsorship) (available|supported)/i.test(t)) {
    return 'sponsors';
  }
  return null;
}

export type Level = 'intern' | 'junior' | 'mid' | 'senior' | 'lead';

export function seniority(title: string): Level {
  const t = title.toLowerCase();
  if (/\b(intern|internship|werkstudent|working student|co-?op|apprentice|trainee)\b/.test(t)) return 'intern';
  if (/\b(head of|director|vp|vice president|principal|staff|distinguished|chief|lead|manager)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|iii|iv|expert)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|graduate|entry|new grad|associate|i)\b/.test(t) && !/\bii\b/.test(t)) return 'junior';
  return 'mid';
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };

/** RSS feeds send titles still HTML-encoded ("Support &#038; Success"). Plain text only; nothing is rendered. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Apply every normaliser to one posting. Pure: returns a new object. */
export function normalizeJob(job: RawJob, now = Date.now()): RawJob {
  const out: RawJob = { ...job, tags: [...(job.tags ?? [])] };
  out.title = decodeEntities(out.title).replace(/\s+/g, ' ').trim();
  out.company = decodeEntities(out.company).replace(/\s+/g, ' ').trim() || 'Unknown';
  out.location = (out.location ?? '').replace(/\s+/g, ' ').trim();

  // Dates: ISO already, or a relative phrase some boards give.
  if (out.postedAt && Number.isNaN(Date.parse(out.postedAt))) out.postedAt = relativePosted(out.postedAt, now);
  if (out.postedAt && Date.parse(out.postedAt) > now + 86_400_000) out.postedAt = new Date(now).toISOString();

  // Salary: structured fields win; otherwise mine the text (tags often carry "salary: …" strings).
  if (!out.salaryMin && !out.salaryMax) {
    const salaryTag = (out.tags ?? []).find((t) => /\d/.test(t) && /[$€£]|pkr|aed|usd|eur|gbp|salary|k\b/i.test(t));
    const head = (out.descriptionText ?? '').match(/(salary|compensation|pay|base)[^\n]{0,120}/i)?.[0];
    const parsed = parseSalaryText(salaryTag) ?? parseSalaryText(head);
    if (parsed) {
      out.salaryMin = annualise(parsed.min, parsed.period);
      out.salaryMax = annualise(parsed.max, parsed.period);
      out.salaryCurrency = parsed.currency;
    }
  }
  if (out.salaryMin && out.salaryMax && out.salaryMin > out.salaryMax) [out.salaryMin, out.salaryMax] = [out.salaryMax, out.salaryMin];

  const mode = workMode(out);
  if (mode === 'remote') out.remote = true;
  // A board that says hybrid or on-site in its own work-mode field means it, whatever its remote flag says.
  if (mode !== 'remote' && (out.tags ?? []).some((t) => /^mode:(hybrid|onsite|on-site|in.?office)/i.test(t))) out.remote = false;
  const visa = visaMention(`${out.title}\n${out.descriptionText ?? ''}`);
  const tags = (out.tags ?? []).filter((t) => !/^(mode|visa|level):/.test(t) && t.trim());
  out.tags = [mode ? `mode:${mode}` : '', visa ? `visa:${visa}` : '', `level:${seniority(out.title)}`, ...tags].filter(Boolean);
  return out;
}

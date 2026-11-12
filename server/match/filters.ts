import { all } from '../db.ts';
import type { CampaignConfig } from '../contracts/campaign.ts';
import type { Legitimacy } from '../contracts/job.ts';
import { activityFor, byCompany, recentSubmissions, type CompanyActivity } from './companies.ts';
import type { MatchJob } from './jobs.ts';
import type { MatchProfile } from './profile.ts';
import { parseSalaryText, annualise as annualiseFor } from '../scout/normalize.ts';
import { looksLikeSeekerPost } from '../sources/util.ts';

/**
 * Hard filters: free, code-only, and run before any token is spent. A filter
 * only rejects when it is sure (an explicit statement in the posting, a stated
 * salary, a known application); anything ambiguous goes on to the assessment,
 * where it shows up in the logistics dimension instead.
 */

export type FilterCode =
  | 'dismissed'
  | 'already_applied'
  | 'category'
  | 'stale'
  | 'legitimacy'
  | 'excluded_company'
  | 'excluded_keyword'
  | 'remote_only'
  | 'location'
  | 'remote_region'
  | 'visa'
  | 'salary'
  | 'language'
  | 'cooldown'
  | 'weak_match';

export interface FilterVerdict {
  pass: boolean;
  code?: FilterCode;
  reason?: string;
}

export interface FilterContext {
  cfg: Pick<CampaignConfig, 'locations' | 'remoteOnly' | 'categories' | 'companyCooldownDays' | 'maxAgeDays'>;
  profile: MatchProfile;
  now: string;
  /** Lowest legitimacy that still passes (default: suspect passes, ghost and scam don't). */
  legitimacyFloor: Legitimacy;
  /** Recent submissions by company key (built once per run). */
  submissions: Map<string, CompanyActivity[]>;
  /** Job ids that already have a sent application. */
  appliedJobs: Set<string>;
}

export function buildFilterContext(cfg: FilterContext['cfg'], profile: MatchProfile, now: string, legitimacyFloor: Legitimacy = 'suspect'): FilterContext {
  const applied = new Set(all<{ job_id: string }>("SELECT DISTINCT job_id FROM applications WHERE status IN ('sent', 'submitted')").map((r) => r.job_id));
  for (const r of all<{ job_id: string }>("SELECT job_id FROM pipeline WHERE state = 'submitted'")) applied.add(r.job_id);
  return { cfg, profile, now, legitimacyFloor, submissions: byCompany(recentSubmissions(cfg.companyCooldownDays, now)), appliedJobs: applied };
}

const lc = (s: string) => s.toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (s: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(lc(s).trim())}($|[^a-z0-9])`, 'i');

// ── Regions ──────────────────────────────────────────────────────────────────

/** Country-level regions a remote posting can be restricted to. Broad blocs (EMEA, APAC, LATAM) are too fuzzy to filter on. */
const REGIONS: Record<string, string[]> = {
  'United States': ['united states', 'usa', 'u.s.a', 'u.s.', 'nyc', 'san francisco', 'bay area', 'seattle', 'austin', 'boston', 'chicago', 'los angeles', 'denver', 'atlanta', 'miami'],
  'United Kingdom': ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'london', 'manchester', 'edinburgh', 'cambridge, uk', 'bristol'],
  Canada: ['canada', 'toronto', 'vancouver', 'montreal', 'montréal', 'ottawa', 'calgary', 'waterloo'],
  'European Union': ['european union', 'eu', 'europe', 'eea'],
  Germany: ['germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'frankfurt', 'cologne', 'köln', 'stuttgart'],
  France: ['france', 'paris', 'lyon', 'marseille', 'toulouse'],
  Netherlands: ['netherlands', 'holland', 'amsterdam', 'rotterdam', 'utrecht', 'the hague', 'eindhoven'],
  Spain: ['spain', 'madrid', 'barcelona', 'valencia'],
  Portugal: ['portugal', 'lisbon', 'porto'],
  Poland: ['poland', 'warsaw', 'krakow', 'kraków', 'wroclaw', 'wrocław'],
  Ireland: ['ireland', 'dublin', 'cork'],
  India: ['india', 'pune', 'bangalore', 'bengaluru', 'hyderabad', 'mumbai', 'delhi', 'new delhi', 'chennai', 'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad'],
  Australia: ['australia'],
  Brazil: ['brazil'],
  Mexico: ['mexico'],
  Pakistan: ['pakistan'],
  'United Arab Emirates': ['united arab emirates', 'uae', 'dubai', 'abu dhabi'],
  'Saudi Arabia': ['saudi arabia', 'ksa', 'riyadh'],
  Singapore: ['singapore'],
  // Seen in live remote postings that are open to one country only.
  'South Africa': ['south africa', 'johannesburg', 'cape town'],
  Ukraine: ['ukraine', 'kyiv', 'kiev', 'lviv'],
  Argentina: ['argentina', 'buenos aires'],
  Ecuador: ['ecuador', 'pichincha', 'quito'],
  Colombia: ['colombia', 'bogota', 'bogotá', 'medellin', 'medellín'],
  Chile: ['chile', 'santiago'],
  Peru: ['peru', 'lima'],
  Uruguay: ['uruguay', 'montevideo'],
  'Costa Rica': ['costa rica'],
  Philippines: ['philippines', 'manila'],
  Indonesia: ['indonesia', 'jakarta'],
  Vietnam: ['vietnam', 'viet nam', 'ho chi minh', 'hanoi'],
  Malaysia: ['malaysia', 'kuala lumpur'],
  Thailand: ['thailand', 'bangkok'],
  Japan: ['japan', 'tokyo'],
  'South Korea': ['south korea', 'korea', 'seoul'],
  China: ['china', 'shanghai', 'beijing', 'shenzhen'],
  'New Zealand': ['new zealand'],
  Nigeria: ['nigeria', 'lagos'],
  Kenya: ['kenya', 'nairobi'],
  Egypt: ['egypt', 'cairo'],
  Morocco: ['morocco'],
  Turkey: ['turkey', 'türkiye', 'istanbul'],
  Israel: ['israel', 'tel aviv'],
  Italy: ['italy', 'italia', 'milan', 'rome'],
  Sweden: ['sweden', 'stockholm'],
  Norway: ['norway', 'oslo'],
  Denmark: ['denmark', 'copenhagen'],
  Finland: ['finland', 'helsinki'],
  Switzerland: ['switzerland', 'schweiz', 'zurich', 'zürich', 'bern', 'geneva'],
  Austria: ['austria', 'vienna'],
  Belgium: ['belgium', 'brussels'],
  Romania: ['romania', 'bucharest'],
  Czechia: ['czechia', 'czech republic', 'prague'],
  Greece: ['greece', 'athens'],
  Serbia: ['serbia', 'belgrade'],
  Estonia: ['estonia', 'tallinn'],
  Bulgaria: ['bulgaria', 'sofia'],
  Hungary: ['hungary', 'budapest'],
  Croatia: ['croatia', 'zagreb'],
  Slovakia: ['slovakia', 'bratislava'],
  Slovenia: ['slovenia', 'ljubljana'],
  Lithuania: ['lithuania', 'vilnius'],
  Latvia: ['latvia', 'riga'],
  Cyprus: ['cyprus', 'limassol', 'nicosia'],
  Malta: ['malta'],
  Luxembourg: ['luxembourg'],
  Bangladesh: ['bangladesh', 'dhaka'],
  'Sri Lanka': ['sri lanka', 'colombo'],
};
const EU_MEMBERS = ['germany', 'france', 'netherlands', 'spain', 'portugal', 'poland', 'ireland', 'italy', 'belgium', 'austria', 'sweden', 'denmark', 'finland', 'czech', 'romania', 'greece', 'hungary', 'croatia', 'estonia', 'latvia', 'lithuania', 'slovakia', 'slovenia', 'bulgaria', 'luxembourg', 'malta', 'cyprus'];
const US_STATES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|, (ca|ny|tx|wa|ma|il|co|fl|ga|nc|va|or|pa|nj|az|mn|ut))\b/i;
const ANYWHERE = /\b(anywhere|worldwide|world-wide|global(ly)?|any (location|country|timezone)|fully distributed|work from anywhere)\b/i;
const REMOTE_WORD = /\b(remote|anywhere|worldwide|distributed|wfh|work from home)\b/i;

function regionsIn(text: string): string[] {
  const t = ` ${lc(text)} `;
  const found = new Set<string>();
  // "US" only in capitals, so "join us" and "contact us" are not the United States.
  if (/(^|[^A-Za-z])US([^A-Za-z]|$)/.test(text)) found.add('United States');
  for (const [region, aliases] of Object.entries(REGIONS)) {
    if (aliases.some((a) => wordRe(a).test(t))) found.add(region);
  }
  if (US_STATES.test(text)) found.add('United States');
  return [...found];
}

/** True when `place` (a campaign location or the candidate's location) lies inside `region`. */
export function inRegion(place: string, region: string): boolean {
  const p = lc(place);
  if (regionsIn(p).includes(region)) return true;
  if (region === 'European Union') return EU_MEMBERS.some((c) => p.includes(c)) || regionsIn(p).some((r) => ['Germany', 'France', 'Netherlands', 'Spain', 'Portugal', 'Poland', 'Ireland'].includes(r));
  return false;
}

const RESTRICTION_PATTERNS = [
  /\b(?:must|need to|required to|should)\s+(?:be\s+)?(?:located|based|residing|reside|living|live)\s+(?:in|within)\s+(?:the\s+)?([a-z .,]{2,40}?)(?=[.;,)\n]|\s+(?:and|or|to|with|time)\b)/gi,
  /\b(?:only\s+(?:open|available)\s+to\s+(?:candidates|applicants|residents)\s+(?:in|from|of)\s+(?:the\s+)?)([a-z .]{2,30}?)(?=[.;,)\n]|$)/gi,
  /\b([a-z .]{2,25}?)[\s-]+(?:only|residents only|based candidates only)\b/gi,
];

/** Where a remote posting says the candidate must be, or null when it doesn't say. */
export function remoteRestriction(job: Pick<MatchJob, 'location' | 'descriptionText'>): string[] | null {
  const loc = job.location.trim();
  if (loc && !ANYWHERE.test(loc)) {
    const regions = regionsIn(loc);
    if (regions.length) return regions;
  }
  const head = job.descriptionText.slice(0, 4000);
  if (ANYWHERE.test(loc)) return null;
  const regions = new Set<string>();
  for (const re of RESTRICTION_PATTERNS) {
    re.lastIndex = 0;
    for (const m of head.matchAll(re)) for (const r of regionsIn(m[1])) regions.add(r);
  }
  return regions.size ? [...regions] : null;
}

// ── Salary ───────────────────────────────────────────────────────────────────

/**
 * Annualise a stated pay figure: under 200 is hourly (2,080 hours), under 10,000
 * monthly, otherwise yearly. Ambiguous figures resolve to the higher reading, so
 * the floor only rejects pay that is low under every plausible reading.
 */
export function annualise(n: number): number {
  if (n < 200) return n * 2080;
  if (n < 10_000) return n * 12;
  return n;
}

// ── Visa ─────────────────────────────────────────────────────────────────────

const NO_SPONSOR = [
  /\b(?:no|not|unable to|cannot|can't|won't|will not|do not|does not|don't|doesn't|are not able to|is not able to)\s+(?:currently\s+)?(?:provide|offer|support|consider)?\s*(?:visa\s+|work\s+visa\s+|immigration\s+|h-?1b\s+)?sponsor(?:ship)?/i,
  /\bwithout\s+(?:the\s+need\s+for\s+|requiring\s+)?(?:current\s+or\s+future\s+)?(?:visa\s+|employment\s+|work\s+)?sponsorship\b/i,
  /\bsponsorship\s+(?:is\s+)?not\s+(?:available|offered|provided|possible)\b/i,
];

// ── The filter ───────────────────────────────────────────────────────────────

export function hardFilter(job: MatchJob, ctx: FilterContext): FilterVerdict {
  const { cfg, profile } = ctx;
  const prefs = profile.preferences;
  const text = `${job.title}\n${job.descriptionText}`;
  const reject = (code: FilterCode, reason: string): FilterVerdict => ({ pass: false, code, reason });

  if (job.status === 'dismissed') return reject('dismissed', 'dismissed by you');
  if (ctx.appliedJobs.has(job.id)) return reject('already_applied', 'already applied to this job');
  if (cfg.categories.length && !cfg.categories.includes(job.category)) return reject('category', `${job.category} is not one of this campaign's categories`);

  if (job.postedAt && cfg.maxAgeDays) {
    const age = (Date.parse(ctx.now) - Date.parse(job.postedAt)) / 86_400_000;
    if (Number.isFinite(age) && age > cfg.maxAgeDays) return reject('stale', `posted ${Math.floor(age)} days ago (campaign limit ${cfg.maxAgeDays})`);
  }

  const order: Legitimacy[] = ['ok', 'suspect', 'ghost', 'scam'];
  if (job.legitimacy && order.indexOf(job.legitimacy) > order.indexOf(ctx.legitimacyFloor)) {
    return reject('legitimacy', job.legitimacy === 'ghost' ? 'flagged as a ghost listing by the scout' : `flagged as ${job.legitimacy} by the scout`);
  }

  const companyKey = lc(job.company);
  const excludedCompany = prefs.excludeCompanies.find((c) => c.trim() && companyKey.includes(lc(c.trim())));
  if (excludedCompany) return reject('excluded_company', `you excluded ${excludedCompany}`);
  const excludedKeyword = prefs.excludeKeywords.find((k) => k.trim() && wordRe(k).test(text));
  if (excludedKeyword) return reject('excluded_keyword', `mentions "${excludedKeyword}", which you excluded`);

  // Location and remote policy.
  const jobRemote = job.remote || REMOTE_WORD.test(job.location);
  const locs = cfg.locations.map((l) => l.trim()).filter(Boolean);
  const placeLocs = locs.filter((l) => !REMOTE_WORD.test(l));
  if (cfg.remoteOnly && !jobRemote) return reject('remote_only', 'not a remote role, and this campaign is remote-only');
  if (jobRemote) {
    const restricted = remoteRestriction(job);
    if (restricted) {
      const places = [...placeLocs, profile.location].filter(Boolean);
      const ok = restricted.some((region) => places.some((p) => inRegion(p, region)));
      if (!ok) return reject('remote_region', `remote, but only for candidates in ${restricted.join(' / ')}`);
    }
  } else if (locs.length && job.location.trim()) {
    if (!placeLocs.length) return reject('location', `on-site in ${job.location}; this campaign only wants remote roles`);
    const jl = lc(job.location);
    const jobRegions = regionsIn(job.location);
    const near = placeLocs.some((l) => jl.includes(lc(l)) || regionsIn(l).some((r) => jobRegions.includes(r)));
    if (!near && !prefs.openToRelocation) return reject('location', `on-site in ${job.location}, outside ${placeLocs.join(', ')}`);
  }

  if (prefs.needsSponsorship && NO_SPONSOR.some((re) => re.test(job.descriptionText))) return reject('visa', 'the posting says it does not sponsor visas');

  if (looksLikeSeekerPost(job.descriptionText)) return reject('legitimacy', "a job seeker's own post, not a job");
  // A link or a run-on sentence where the title should be: the listing was mis-read, and a letter would quote it.
  if (/https?:\/\/|www\./i.test(job.title) || job.title.length > 120) return reject('legitimacy', 'the listing has no readable job title');

  const language = missingLanguage(job, profile);
  if (language) return reject('language', language);

  if (prefs.minSalary > 0) {
    // Structured pay first; some boards only put it in the title ("… - $15,000/year USD").
    const titled = !job.salaryMax && !job.salaryMin ? parseSalaryText(job.title) : null;
    const top = job.salaryMax || job.salaryMin ? annualise(Number(job.salaryMax || job.salaryMin)) : titled ? annualiseFor(titled.max ?? titled.min, titled.period) : null;
    const cur = ((job.salaryMax || job.salaryMin ? job.salaryCurrency : titled?.currency) ?? '').trim().toUpperCase();
    if (top && cur && cur === prefs.currency.trim().toUpperCase() && top < prefs.minSalary) {
      return reject('salary', `pays up to ${Math.round(top).toLocaleString('en-US')} ${cur} a year, below your floor of ${prefs.minSalary.toLocaleString('en-US')}`);
    }
  }

  if (cfg.companyCooldownDays > 0) {
    const recent = activityFor(ctx.submissions, { companyId: job.companyId, company: job.company, jobId: job.id });
    if (recent.length) {
      return reject('cooldown', `applied to ${recent[0].company} on ${recent[0].at.slice(0, 10)} (cooldown ${cfg.companyCooldownDays} days)`);
    }
  }

  return { pass: true };
}

/** Languages a posting can require that the profile must list to apply. */
const LANGS: { name: string; words: string; stop: RegExp }[] = [
  { name: 'German', words: 'german|deutsch', stop: /\b(und|der|die|das|wir|sie|mit|für|bei|ist|eine?n?|unser(e|en)?|sowie|kenntnisse|erfahrung)\b/gi },
  { name: 'French', words: 'french|français|francais', stop: /\b(et|les|des|nous|vous|avec|pour|une|dans|est|sur|notre|votre)\b/gi },
  { name: 'Dutch', words: 'dutch|nederlands', stop: /\b(en|het|een|wij|jij|met|voor|zijn|naar|onze|bij|ervaring)\b/gi },
];

const SCRIPTS: [string, RegExp, RegExp][] = [
  ['Cyrillic script', /\p{Script=Cyrillic}/gu, /russian|ukrainian|bulgarian|serbian|macedonian|kazakh|belarusian/i],
  ['Chinese', /\p{Script=Han}/gu, /chinese|mandarin|cantonese|japanese/i],
  ['Japanese', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu, /japanese/i],
  ['Korean', /\p{Script=Hangul}/gu, /korean/i],
];

const LEVEL = String.raw`fluent|fluency|native|excellent|very good|strong|business[- ]level|professional|proficien\w*|sehr gute?n?|fließende?s?|verhandlungssichere?s?`;
const MUST = String.raw`required|a must|mandatory|essential|erforderlich|vorausgesetzt|c1|c2`;

/**
 * A posting written in a language the candidate doesn't list, or one that asks for fluency in it, rules the job out:
 * "Sehr gute Deutschkenntnisse" is a hard requirement, not a stretch.
 */
export function missingLanguage(job: Pick<MatchJob, 'title' | 'descriptionText'>, profile: Pick<MatchProfile, 'languages'>): string | null {
  const spoken = profile.languages.join(' ').toLowerCase();
  const text = `${job.title}\n${job.descriptionText}`.slice(0, 12_000);
  const words = text.split(/\s+/).length;
  // Mostly another script: Cyrillic (Ukrainian, Russian…), or Chinese, Japanese and Korean.
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  for (const [name, re, langs] of SCRIPTS) {
    if (langs.test(spoken) || letters < 200) continue;
    if ((text.match(re)?.length ?? 0) / letters > 0.3) return `the posting is written in ${name}, which is not among your languages`;
  }
  for (const l of LANGS) {
    if (new RegExp(String.raw`\b(${l.words})\b`, 'i').test(spoken)) continue;
    const asks = new RegExp(String.raw`\b(${LEVEL})\s+(\w+\s+){0,3}(${l.words})|\b(${l.words})(\s*(-|kenntnisse|language|skills))*\s*(\w+\s+){0,3}(is |are )?(${MUST})\b`, 'i');
    if (asks.test(text)) return `asks for ${l.name}, which is not among your languages`;
    if (words > 80 && (text.match(l.stop)?.length ?? 0) / words > 0.06) return `the posting is written in ${l.name}`;
  }
  return null;
}

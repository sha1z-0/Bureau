/**
 * Domain helpers for linking mail to applications and matching verification
 * codes to the site that asked for them.
 */

const MULTI_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.in', 'com.pk', 'org.pk', 'com.br',
  'co.jp', 'co.za', 'com.sg', 'com.mx', 'com.tr', 'com.cn', 'com.hk', 'co.kr', 'com.my', 'com.ar', 'co.id', 'com.ng', 'com.eg', 'com.sa',
]);

/** "mail.us.example.co.uk" → "example.co.uk". */
export function baseDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  // Documentation domains (RFC 2606 example.*) act as a public suffix, so the
  // fictional companies in fixtures (acme.example.com) stay distinct.
  return MULTI_TLDS.has(last2) || parts[parts.length - 2] === 'example' ? parts.slice(-3).join('.') : last2;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Base domains each ATS sends mail from or hosts boards on. */
export const ATS_DOMAINS: Record<string, string[]> = {
  greenhouse: ['greenhouse.io', 'greenhouse-mail.io'],
  lever: ['lever.co'],
  ashby: ['ashbyhq.com'],
  smartrecruiters: ['smartrecruiters.com'],
  workday: ['myworkday.com', 'myworkdayjobs.com', 'workday.com', 'myworkdaysite.com'],
  workable: ['workable.com', 'workablemail.com'],
  recruitee: ['recruitee.com'],
  personio: ['personio.de', 'personio.com'],
  teamtailor: ['teamtailor.com', 'teamtailor-mail.com'],
  bamboohr: ['bamboohr.com'],
  breezy: ['breezy.hr'],
  jazzhr: ['jazzhr.com', 'applytojob.com'],
  rippling: ['rippling.com', 'rippling-ats.com'],
  pinpoint: ['pinpointhq.com'],
  comeet: ['comeet.com', 'comeet.co'],
  icims: ['icims.com'],
  taleo: ['taleo.net'],
  successfactors: ['successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu'],
};

export function atsFamilyOf(host: string | null | undefined): string | null {
  if (!host) return null;
  const b = baseDomain(host);
  for (const [fam, list] of Object.entries(ATS_DOMAINS)) if (list.includes(b)) return fam;
  return null;
}

/** Job boards and aggregators: their domain says nothing about the employer. */
const BOARD_DOMAINS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'wellfound.com', 'angel.co', 'remoteok.com', 'remoteok.io', 'weworkremotely.com',
  'ycombinator.com', 'workatastartup.com', 'otta.com', 'welcometothejungle.com', 'himalayas.app', 'remotive.com', 'jobicy.com',
  'arbeitnow.com', 'rozee.pk', 'mustakbil.com', 'bayt.com', 'naukri.com', 'monster.com', 'ziprecruiter.com', 'dice.com', 'hn.algolia.com',
  'news.ycombinator.com', 'github.com', 'reddit.com', 'x.com', 'twitter.com',
]);

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'icloud.com', 'me.com',
  'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'zoho.com', 'yandex.com', 'mail.com', 'fastmail.com',
]);

export function isFreeMail(domain: string): boolean {
  return FREE_MAIL.has(baseDomain(domain));
}

/** True when a host can stand for the employer itself (not an ATS, board or free-mail host). */
export function isEmployerHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const b = baseDomain(host);
  return !atsFamilyOf(host) && !BOARD_DOMAINS.has(b) && !FREE_MAIL.has(b);
}

/** Hosts whose links are meeting schedulers. */
const SCHEDULER_HOSTS = [
  'calendly.com', 'cal.com', 'savvycal.com', 'goodtime.io', 'zcal.co', 'tidycal.com', 'youcanbook.me', 'chilipiper.com', 'doodle.com',
  'meetings.hubspot.com', 'calendar.app.google', 'reclaim.ai', 'acuityscheduling.com', 'appointlet.com', 'koalendar.com', 'x.ai', 'paradox.ai',
  'gem.com', 'prelude.co', 'modernloop.io', 'rippling.com/scheduling',
];

export function isSchedulingLink(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  const hp = `${host}${u.pathname}`.toLowerCase();
  if (SCHEDULER_HOSTS.some((s) => (s.includes('/') ? hp.startsWith(s) || hp.includes(`.${s}`) : host === s || host.endsWith(`.${s}`)))) return true;
  if (host === 'calendar.google.com' && /\/(appointments|schedules)/.test(u.pathname)) return true;
  if (/outlook\.(office|office365|live)\.com$/.test(host) && /\/bookings?\//i.test(u.pathname)) return true;
  if (/\/(schedule|scheduling|book-a-time|self-schedule)\b/i.test(u.pathname) && atsFamilyOf(host)) return true;
  return false;
}

/** Online-assessment platforms. */
const ASSESSMENT_HOSTS = [
  'hackerrank.com', 'codility.com', 'codesignal.com', 'testgorilla.com', 'coderbyte.com', 'hackerearth.com', 'karat.com', 'qualified.io',
  'devskiller.com', 'coderpad.io', 'codinggame.com', 'codingame.com', 'leetcode.com', 'imocha.io', 'mettl.com', 'criteriacorp.com', 'hirevue.com',
  'shl.com', 'pymetrics.ai', 'vervoe.com', 'canditech.io', 'alooba.com', 'adaface.com',
];

export function isAssessmentLink(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return ASSESSMENT_HOSTS.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Words in a company name that say nothing about which company it is. */
const NAME_NOISE = new Set([
  'inc', 'llc', 'ltd', 'limited', 'gmbh', 'ag', 'sa', 'bv', 'plc', 'co', 'corp', 'corporation', 'company', 'group', 'holdings', 'the', 'pvt',
  'private', 'technologies', 'technology', 'tech', 'labs', 'lab', 'software', 'systems', 'solutions', 'studio', 'studios', 'games', 'io', 'ai',
  'hq', 'global', 'international', 'careers', 'jobs', 'recruiting', 'talent', 'team', 'hiring', 'hr', 'people',
]);
const COMMON_WORDS = new Set(['health', 'security', 'pay', 'data', 'cloud', 'digital', 'analytics', 'robotics', 'logistics', 'media', 'capital', 'bank', 'energy', 'design', 'apps', 'mobile', 'network', 'services', 'partners']);

/** Distinctive lower-case tokens for a company name: the full phrase plus its first distinctive word. */
export function companyTokens(name: string): string[] {
  const clean = name.toLowerCase().replace(/[^a-z0-9\s&-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ').filter((w) => w && !NAME_NOISE.has(w));
  const out = new Set<string>([clean]);
  if (words.length) out.add(words.join(' '));
  const first = words[0];
  if (first && first.length >= 4 && !COMMON_WORDS.has(first)) out.add(first);
  return [...out].filter((t) => t.length >= 3);
}

export function containsToken(haystack: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(haystack);
}

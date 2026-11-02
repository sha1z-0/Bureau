import type { Category, RawJob } from '../sources/types.ts';
import type { Profile } from './profileStore.ts';

/**
 * The cheap gate that runs before any token is spent: decide whether a posting is
 * a tech role at all, which discipline it belongs to, and how promising it looks
 * against the profile. Only the best of these go on to Claude.
 */

const RULES: [Category, RegExp][] = [
  ['security', /\b(security|cyber|infosec|appsec|pen ?test|penetration|red team|blue team|purple team|soc analyst|soc engineer|threat|vulnerabilit|incident response|dfir|forensic|malware|detection engineer|iam engineer|identity engineer|grc|devsecops|cloud security|offensive|exploit|reverse engineer)/i],
  ['game', /\b(game|gameplay|unity|unreal|ue5|godot|graphics programmer|engine programmer|technical artist|rendering engineer|level scripter|multiplayer engineer)/i],
  ['mobile', /\b(ios|android|mobile|swift|kotlin|react native|flutter|xamarin)\b/i],
  ['data_ai', /\b(machine learning|ml engineer|mlops|ai engineer|applied scientist|research engineer|data scientist|data engineer|llm|nlp|computer vision|deep learning|analytics engineer)/i],
  ['devops_cloud', /\b(devops|sre|site reliability|platform engineer|infrastructure engineer|cloud engineer|kubernetes|systems engineer|build engineer|release engineer|network engineer)/i],
  ['web', /\b(front.?end|back.?end|full.?stack|web developer|web engineer|react|vue|angular|svelte|next\.?js|node|django|rails|laravel|php|typescript|javascript|ui engineer|api engineer)/i],
  ['software', /\b(software|developer|programmer|engineer|swe|sde|coder|architect|tech lead|cto)\b/i],
];

const NOT_TECH = /\b(sales|account executive|account manager|recruiter|talent|marketing|customer success|support specialist|legal|counsel|paralegal|accountant|finance manager|hr |people partner|office manager|executive assistant|copywriter|social media|bdr|sdr|business development|nurse|driver|warehouse)\b/i;

export function categorize(job: Pick<RawJob, 'title' | 'tags' | 'descriptionText'>): Category | null {
  const title = job.title;
  if (NOT_TECH.test(title) && !/engineer|developer|security analyst/i.test(title)) return null;
  for (const [cat, re] of RULES) if (re.test(title)) return cat;
  // Title alone was vague ("Member of Technical Staff"); look at tags and the first paragraph.
  const context = `${(job.tags ?? []).join(' ')} ${(job.descriptionText ?? '').slice(0, 600)}`;
  if (!/technical staff|engineer|developer|programmer/i.test(title + context)) return null;
  for (const [cat, re] of RULES.slice(0, -1)) if (re.test(context)) return cat;
  return /technical staff|engineer|developer|programmer/i.test(title) ? 'software' : null;
}

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head of|director|vp|architect)\b/i;
const JUNIOR = /\b(junior|jr\.?|graduate|entry|intern|apprentice|associate)\b/i;

export function prefilterScore(job: RawJob, category: Category, profile: Profile | null): number {
  if (!profile) return 40;
  const text = `${job.title} ${(job.tags ?? []).join(' ')} ${job.descriptionText ?? ''}`.toLowerCase();
  const title = job.title.toLowerCase();
  let score = 0;

  // Discipline (25): is this in one of the lanes the candidate hunts in?
  const wanted = profile.preferences.categories.length ? profile.preferences.categories : profile.categories;
  if (wanted.includes(category)) score += 25;
  else if (category === 'software') score += 12;

  // Role title (20): overlap with target roles.
  const roleWords = profile.preferences.targetRoles.flatMap((r) => r.toLowerCase().split(/\W+/)).filter((w) => w.length > 2 && !['and', 'the'].includes(w));
  const hits = new Set(roleWords.filter((w) => title.includes(w)));
  score += Math.min(20, hits.size * 7);

  // Skills (35): proportion of the core stack named in the posting.
  const skills = [...new Set([...profile.coreStack, ...profile.skills].map((s) => s.toLowerCase()))].slice(0, 40);
  if (skills.length) {
    const found = skills.filter((s) => (s.length <= 3 ? new RegExp(`\\b${escapeRe(s)}\\b`).test(text) : text.includes(s)));
    score += Math.round(Math.min(1, found.length / Math.min(8, skills.length)) * 35);
  }

  // Logistics (10): remote / location preference.
  const prefs = profile.preferences;
  if (prefs.remoteOnly ? job.remote : true) score += 6;
  if (prefs.locations.some((l) => `${job.location}`.toLowerCase().includes(l.toLowerCase())) || job.remote) score += 4;

  // Freshness (10).
  if (job.postedAt) {
    const days = (Date.now() - new Date(job.postedAt).getTime()) / 86_400_000;
    score += days <= 3 ? 10 : days <= 10 ? 7 : days <= 21 ? 4 : 1;
  } else score += 4;

  // Seniority mismatch is a soft penalty, not a filter.
  const level = profile.seniority;
  if ((level === 'junior' || level === 'entry') && SENIOR.test(title)) score -= 15;
  if ((level === 'senior' || level === 'lead') && JUNIOR.test(title)) score -= 10;

  if (prefs.excludeCompanies.some((c) => job.company.toLowerCase().includes(c.toLowerCase()))) return 0;
  if (prefs.excludeKeywords.some((k) => text.includes(k.toLowerCase()))) score -= 30;

  return Math.max(0, Math.min(100, score));
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Layered identity: canonical URL first, then a normalised company+title+place hash. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(utm_|ref|source|gh_src|lever-|src)/i.test(p)) u.searchParams.delete(p);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function normalizeForFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\b(inc|llc|ltd|gmbh|corp|co|the|remote|hybrid|onsite)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

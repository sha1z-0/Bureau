import type { AtsFamily } from '../contracts/job.ts';

/**
 * ATS auto-detection. Given any careers URL, apply link or careers-page HTML,
 * work out which applicant-tracking system runs it, the company's board token,
 * and (for a job URL) the job id. Pure functions: no network, no database.
 *
 * Token formats (what `companies.ats_token` stores):
 *   greenhouse / lever / ashby / workable / recruitee / teamtailor / bamboohr /
 *   breezy / jazzhr / rippling / pinpoint / smartrecruiters   → the board slug
 *   personio        → "<slug>" (.de) or "<slug>.com" (.com tenants)
 *   workday         → "<tenant>:<wdN>:<site>" (myworkdayjobs.com) or "<tenant>:<wdN>:<site>:site" (myworkdaysite.com)
 *   greenhouse / lever EU tenants → "<slug>" with `region: 'eu'` on the hit, stored as "eu:<slug>"
 *   comeet          → "<company>/<uid>"
 *   icims           → "<subdomain>" (careers-acme.icims.com → "careers-acme")
 *   taleo           → "<tenant>/<section>"
 *   successfactors  → "<company>@<host>"
 */

export interface AtsHit {
  ats: AtsFamily;
  /** Board token, or null when the URL proves the ATS but not the board (e.g. ?gh_jid= on a custom domain). */
  token: string | null;
  /** The posting's id on that ATS, when the URL points at a single job. */
  jobId: string | null;
  /** Human-facing board URL for the registry, when the token is known. */
  boardUrl: string | null;
  /** For ats = 'other': which platform it is (oracle, jobvite, eightfold…). Otherwise equals `ats`. */
  platform: string;
}

/** Hosts that are job boards or ATSs themselves, never an employer's own domain. */
export const ATS_HOST_RE =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|workable\.com|recruitee\.com|personio\.(de|com)|teamtailor\.com|bamboohr\.com|breezy\.hr|applytojob\.com|jazz\.co|jazzhr\.com|rippling\.com|pinpointhq\.com|comeet\.com|comeet\.co|icims\.com|taleo\.net|successfactors\.(com|eu)|jobs\.sap\.com|oraclecloud\.com|jobvite\.com|eightfold\.ai|ultipro\.com|paylocity\.com|dayforcehcm\.com|adp\.com)$/i;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RESERVED = new Set(['embed', 'v1', 'api', 'jobs', 'job', 'apply', 'careers', 'en', 'search', 'login', 'signup', 'www', '']);

function seg(path: string): string[] {
  return path.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

function hit(ats: AtsFamily, token: string | null, jobId: string | null, boardUrl: string | null, platform: string = ats): AtsHit {
  return { ats, token: token || null, jobId: jobId || null, boardUrl: token ? boardUrl : null, platform };
}

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim().replace(/^\/\//, 'https://'));
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/** Detect the ATS behind one URL. Returns null for anything that isn't recognisably an ATS. */
export function detectAts(rawUrl: string): AtsHit | null {
  const u = parse(rawUrl);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const parts = seg(u.pathname);
  const q = u.searchParams;
  const first = (parts[0] ?? '').toLowerCase();

  // ── Greenhouse ────────────────────────────────────────────────────────
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const eu = /\.eu\.greenhouse\.io$/.test(host);
    const tok = (t: string | null) => (t ? (eu ? `eu:${t.toLowerCase()}` : t.toLowerCase()) : null);
    const board = (t: string | null) => (t ? `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${t.toLowerCase()}` : null);
    if (host.startsWith('boards-api.')) {
      // /v1/boards/{token}/jobs[/{id}]
      const i = parts.indexOf('boards');
      const t = i >= 0 ? parts[i + 1] : null;
      const id = i >= 0 && parts[i + 2] === 'jobs' ? parts[i + 3] ?? null : null;
      return hit('greenhouse', tok(t), id, board(t));
    }
    if (first === 'embed') {
      const t = q.get('for');
      const id = q.get('token') ?? q.get('gh_jid');
      return hit('greenhouse', tok(t), id, board(t));
    }
    const t = parts[0] && !RESERVED.has(first) ? parts[0] : q.get('for');
    const id = parts[1] === 'jobs' ? (parts[2]?.match(/^\d+/)?.[0] ?? null) : q.get('gh_jid');
    if (!t && !id) return null;
    return hit('greenhouse', tok(t), id, board(t));
  }

  // ── Lever ─────────────────────────────────────────────────────────────
  if (/(^|\.)lever\.co$/.test(host)) {
    const eu = /\.eu\.lever\.co$/.test(host);
    let t: string | null = null;
    let id: string | null = null;
    if (host.startsWith('api.')) {
      const i = parts.indexOf('postings');
      t = i >= 0 ? parts[i + 1] ?? null : null;
      id = i >= 0 ? parts[i + 2] ?? null : null;
    } else if (host.startsWith('jobs.')) {
      t = parts[0] ?? null;
      id = parts[1] && new RegExp(`^${UUID}$`, 'i').test(parts[1]) ? parts[1] : null;
    } else return null;
    if (!t || RESERVED.has(t.toLowerCase())) return null;
    const token = eu ? `eu:${t.toLowerCase()}` : t.toLowerCase();
    return hit('lever', token, id, `https://jobs.${eu ? 'eu.' : ''}lever.co/${t.toLowerCase()}`);
  }

  // ── Ashby ─────────────────────────────────────────────────────────────
  if (/(^|\.)ashbyhq\.com$/.test(host)) {
    let t: string | null = null;
    let id: string | null = null;
    if (host.startsWith('api.')) {
      const i = parts.indexOf('job-board');
      t = i >= 0 ? parts[i + 1] ?? null : null;
    } else if (host === 'jobs.ashbyhq.com') {
      t = parts[0] ?? null;
      id = parts[1] && new RegExp(`^${UUID}$`, 'i').test(parts[1]) ? parts[1] : null;
    } else return null;
    if (!t || RESERVED.has(t.toLowerCase())) return null;
    return hit('ashby', t.toLowerCase(), id, `https://jobs.ashbyhq.com/${encodeURIComponent(t.toLowerCase())}`);
  }

  // ── Workday ───────────────────────────────────────────────────────────
  const wdJobs = host.match(/^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/);
  const wdSite = host.match(/^(wd\d+)\.myworkdaysite\.com$/);
  if (wdJobs || wdSite) {
    let p = parts;
    let tenant: string;
    let wd: string;
    let site: string | undefined;
    if (p[0] === 'wday' && p[1] === 'cxs') {
      tenant = p[2];
      site = p[3];
      wd = wdJobs ? wdJobs[2] : wdSite![1];
      p = p.slice(4);
    } else if (wdJobs) {
      tenant = wdJobs[1];
      wd = wdJobs[2];
      p = p.filter((s, i) => !(i === 0 && /^[a-z]{2}(-[a-z]{2,3})?$/i.test(s)));
      site = p[0];
      p = p.slice(1);
    } else {
      wd = wdSite![1];
      p = p.filter((s, i) => !(i === 0 && /^[a-z]{2}(-[a-z]{2,3})?$/i.test(s)));
      if (p[0] !== 'recruiting') return null;
      tenant = p[1];
      site = p[2];
      p = p.slice(3);
    }
    if (!tenant || !site || /^(job|details|login)$/i.test(site)) return hit('workday', null, null, null);
    const jobPath = p[0] === 'job' || p[0] === 'details' ? `/${p.join('/')}` : null;
    const token = wdJobs ? `${tenant.toLowerCase()}:${wd}:${site}` : `${tenant.toLowerCase()}:${wd}:${site}:site`;
    return hit('workday', token, jobPath, workdayBoardUrl(token));
  }

  // ── SmartRecruiters ───────────────────────────────────────────────────
  if (/(^|\.)smartrecruiters\.com$/.test(host)) {
    let t: string | null = null;
    let id: string | null = null;
    if (host === 'api.smartrecruiters.com') {
      const i = parts.indexOf('companies');
      t = i >= 0 ? parts[i + 1] ?? null : null;
      id = i >= 0 && parts[i + 2] === 'postings' ? parts[i + 3] ?? null : null;
    } else if (/^(jobs|careers)\.smartrecruiters\.com$/.test(host)) {
      t = parts[0] ?? null;
      id = parts[1]?.match(/^\d{6,}/)?.[0] ?? null;
    } else return null;
    if (!t || RESERVED.has(t.toLowerCase())) return null;
    // Company identifiers are case-sensitive (Ubisoft2), so keep the case.
    return hit('smartrecruiters', t, id, `https://careers.smartrecruiters.com/${t}`);
  }

  // ── Workable ──────────────────────────────────────────────────────────
  if (/(^|\.)workable\.com$/.test(host)) {
    let t: string | null = null;
    let id: string | null = null;
    if (host === 'apply.workable.com') {
      if (parts[0] === 'api') {
        const i = parts.indexOf('accounts');
        t = i >= 0 ? parts[i + 1] ?? null : null;
      } else if (parts[0] === 'j') {
        id = parts[1] ?? null; // shortlink without the account
      } else {
        t = parts[0] ?? null;
        id = parts[1] === 'j' ? parts[2] ?? null : null;
      }
    } else if (!/^(www|jobs|help|resources)\.workable\.com$/.test(host) && host.endsWith('.workable.com')) {
      t = host.split('.')[0];
      id = parts[0] === 'jobs' ? parts[1] ?? null : null;
    } else return null;
    if (t && RESERVED.has(t.toLowerCase())) t = null;
    if (!t && !id) return null;
    return hit('workable', t?.toLowerCase() ?? null, id, t ? `https://apply.workable.com/${t.toLowerCase()}` : null);
  }

  // ── Recruitee ─────────────────────────────────────────────────────────
  const rec = host.match(/^([a-z0-9-]+)\.recruitee\.com$/);
  if (rec && rec[1] !== 'www' && rec[1] !== 'api') {
    const id = parts[0] === 'o' ? parts[1] ?? null : null;
    return hit('recruitee', rec[1], id, `https://${rec[1]}.recruitee.com`);
  }

  // ── Personio ──────────────────────────────────────────────────────────
  const per = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(de|com)$/);
  if (per) {
    const token = per[2] === 'com' ? `${per[1]}.com` : per[1];
    const id = parts[0] === 'job' ? parts[1]?.match(/^\d+/)?.[0] ?? null : null;
    return hit('personio', token, id, `https://${per[1]}.jobs.personio.${per[2]}`);
  }

  // ── Teamtailor ────────────────────────────────────────────────────────
  const tt = host.match(/^([a-z0-9-]+)\.teamtailor\.com$/);
  if (tt && !['www', 'app', 'api', 'support'].includes(tt[1])) {
    const id = parts[0] === 'jobs' ? parts[1]?.match(/^\d+/)?.[0] ?? null : null;
    return hit('teamtailor', tt[1], id, `https://${tt[1]}.teamtailor.com/jobs`);
  }

  // ── BambooHR ──────────────────────────────────────────────────────────
  const bam = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/);
  if (bam && !['www', 'api', 'help'].includes(bam[1])) {
    const id = (parts[0] === 'careers' && parts[1]?.match(/^\d+$/)?.[0]) || (parts[0] === 'jobs' ? q.get('id') : null);
    return hit('bamboohr', bam[1], id || null, `https://${bam[1]}.bamboohr.com/careers`);
  }

  // ── Breezy ────────────────────────────────────────────────────────────
  const bz = host.match(/^([a-z0-9-]+)\.breezy\.hr$/);
  if (bz && !['www', 'app', 'api'].includes(bz[1])) {
    const id = parts[0] === 'p' ? parts[1]?.split('-')[0] ?? null : null;
    return hit('breezy', bz[1], id, `https://${bz[1]}.breezy.hr`);
  }

  // ── JazzHR ────────────────────────────────────────────────────────────
  const jz = host.match(/^([a-z0-9-]+)\.applytojob\.com$/);
  if (jz && !['www', 'app'].includes(jz[1])) {
    const id = parts[0] === 'apply' && parts[1] && parts[1] !== 'jobs' ? parts[1] : null;
    return hit('jazzhr', jz[1], id, `https://${jz[1]}.applytojob.com/apply`);
  }
  if (/^app\.jazz\.co$/.test(host) && parts[0] === 'feeds') {
    const t = parts[parts.length - 1];
    return hit('jazzhr', t, null, `https://${t}.applytojob.com/apply`);
  }

  // ── Rippling ──────────────────────────────────────────────────────────
  if (host === 'ats.rippling.com' || (host === 'api.rippling.com' && parts.includes('board'))) {
    let p = parts;
    if (host === 'api.rippling.com') p = p.slice(p.indexOf('board') + 1);
    if (p[0] && /^[a-z]{2}-[A-Z]{2}$/.test(p[0])) p = p.slice(1);
    const t = p[0];
    if (!t || RESERVED.has(t.toLowerCase())) return null;
    const id = p[1] === 'jobs' && p[2] && new RegExp(`^${UUID}$`, 'i').test(p[2]) ? p[2] : null;
    return hit('rippling', t.toLowerCase(), id, `https://ats.rippling.com/${t.toLowerCase()}/jobs`);
  }

  // ── Pinpoint ──────────────────────────────────────────────────────────
  const pp = host.match(/^([a-z0-9-]+)\.pinpointhq\.com$/);
  if (pp && !['www', 'app', 'api'].includes(pp[1])) {
    const i = parts.indexOf('postings');
    const id = i >= 0 ? parts[i + 1]?.replace(/\.json$/, '') ?? null : null;
    return hit('pinpoint', pp[1], id && id !== '' ? id : null, `https://${pp[1]}.pinpointhq.com`);
  }

  // ── Comeet ────────────────────────────────────────────────────────────
  if (/(^|\.)comeet\.(com|co)$/.test(host) && parts[0] === 'jobs' && parts[1] && parts[2]) {
    const token = `${parts[1].toLowerCase()}/${parts[2]}`;
    return hit('comeet', token, parts[4] ?? null, `https://www.comeet.com/jobs/${token}`);
  }

  // ── iCIMS ─────────────────────────────────────────────────────────────
  const ic = host.match(/^([a-z0-9-]+)\.icims\.com$/);
  if (ic && !['www', 'api'].includes(ic[1])) {
    const id = parts[0] === 'jobs' && /^\d+$/.test(parts[1] ?? '') ? parts[1] : null;
    return hit('icims', ic[1], id, `https://${ic[1]}.icims.com/jobs/search`);
  }
  if (q.get('icims') === '1' || q.get('ats') === 'icims') {
    const id = parts[0] === 'jobs' && /^\d+$/.test(parts[1] ?? '') ? parts[1] : null;
    return hit('icims', null, id, null);
  }

  // ── Taleo ─────────────────────────────────────────────────────────────
  const tal = host.match(/^([a-z0-9-]+)\.taleo\.net$/);
  if (tal) {
    const section = parts[0] === 'careersection' ? parts[1] : null;
    const token = section ? `${tal[1]}/${section}` : tal[1];
    return hit('taleo', token, q.get('job'), section ? `https://${host}/careersection/${section}/jobsearch.ftl` : null);
  }

  // ── SuccessFactors ────────────────────────────────────────────────────
  if (/(^|\.)successfactors\.(com|eu)$/.test(host) || /(^|\.)jobs\.sap\.com$/.test(host) || q.get('ats') === 'successfactors') {
    const company = q.get('company');
    const token = company ? `${company}@${host}` : null;
    const id = q.get('career_job_req_id') ?? parts.find((s) => /^\d{6,}$/.test(s)) ?? null;
    return hit('successfactors', token, id, token ? `https://${host}/career?company=${encodeURIComponent(company!)}` : null);
  }

  // ── Others we recognise but don't poll ────────────────────────────────
  if (/\.oraclecloud\.com$/.test(host) && /CandidateExperience/i.test(u.pathname)) {
    const i = parts.indexOf('sites');
    const site = i >= 0 ? parts[i + 1] : null;
    const jobId = parts.includes('job') ? parts[parts.indexOf('job') + 1] ?? null : null;
    return hit('other', site ? `${host}/${site}` : null, jobId, site ? `https://${host}/hcmUI/CandidateExperience/en/sites/${site}` : null, 'oracle');
  }
  if (/(^|\.)jobvite\.com$/.test(host)) {
    const t = host.startsWith('jobs.') ? parts[0] : host.split('.')[0];
    const id = parts[1] === 'job' ? parts[2] ?? null : null;
    return hit('other', t ?? null, id, t ? `https://jobs.jobvite.com/${t}` : null, 'jobvite');
  }
  const ef = host.match(/^([a-z0-9-]+)\.eightfold\.ai$/);
  if (ef) return hit('other', ef[1], parts[0] === 'careers' && parts[1] === 'job' ? parts[2] ?? null : null, `https://${host}/careers`, 'eightfold');

  // ── Custom domains carrying an ATS job-id parameter ───────────────────
  if (q.get('gh_jid')) return hit('greenhouse', null, q.get('gh_jid'), null);
  if (q.get('ashby_jid')) return hit('ashby', null, q.get('ashby_jid'), null);
  if (q.get('lever-origin') || q.get('lever-source')) return null;
  return null;
}

export function workdayParts(token: string): { tenant: string; wd: string; site: string; host: string; apiBase: string; boardUrl: string } | null {
  const [tenant, wd, site, kind] = token.split(':');
  if (!tenant || !wd || !site) return null;
  if (kind === 'site') {
    const host = `${wd}.myworkdaysite.com`;
    return { tenant, wd, site, host, apiBase: `https://${host}/wday/cxs/${tenant}/${site}`, boardUrl: `https://${host}/recruiting/${tenant}/${site}` };
  }
  const host = `${tenant}.${wd}.myworkdayjobs.com`;
  return { tenant, wd, site, host, apiBase: `https://${host}/wday/cxs/${tenant}/${site}`, boardUrl: `https://${host}/${site}` };
}

function workdayBoardUrl(token: string): string | null {
  return workdayParts(token)?.boardUrl ?? null;
}

/** The public board URL for a stored (ats, token) pair. */
export function boardUrlFor(ats: AtsFamily, token: string): string | null {
  const t = token;
  const eu = t.startsWith('eu:');
  const slug = eu ? t.slice(3) : t;
  switch (ats) {
    case 'greenhouse':
      return `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${slug}`;
    case 'lever':
      return `https://jobs.${eu ? 'eu.' : ''}lever.co/${slug}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${slug}`;
    case 'workday':
      return workdayBoardUrl(t);
    case 'smartrecruiters':
      return `https://careers.smartrecruiters.com/${t}`;
    case 'workable':
      return `https://apply.workable.com/${t}`;
    case 'recruitee':
      return `https://${t}.recruitee.com`;
    case 'personio':
      return t.endsWith('.com') ? `https://${t.slice(0, -4)}.jobs.personio.com` : `https://${t}.jobs.personio.de`;
    case 'teamtailor':
      return `https://${t}.teamtailor.com/jobs`;
    case 'bamboohr':
      return `https://${t}.bamboohr.com/careers`;
    case 'breezy':
      return `https://${t}.breezy.hr`;
    case 'jazzhr':
      return `https://${t}.applytojob.com/apply`;
    case 'rippling':
      return `https://ats.rippling.com/${t}/jobs`;
    case 'pinpoint':
      return `https://${t}.pinpointhq.com`;
    case 'comeet':
      return `https://www.comeet.com/jobs/${t}`;
    case 'icims':
      return `https://${t}.icims.com/jobs/search`;
    default:
      return null;
  }
}

const TRACKING = /^(utm_|ref$|referrer|source$|src$|gh_src|lever-|trk|campaign|mc_|fbclid|gclid|_hs|hs_|iis|iisn|ccuid|jobpipeline|codes$|nl$|fr$|ats$|icims$|in_iframe)/i;

/**
 * One stable URL per posting, used as the dedupe key and as the apply target.
 * ATS URLs are rewritten to their shortest working form; everything else just
 * loses tracking parameters, the fragment and the trailing slash.
 */
export function canonicalApplyUrl(raw: string): string {
  const u = parse(raw);
  if (!u) return raw.trim();
  const h = detectAts(raw);
  if (h?.token && h.jobId) {
    const eu = h.token.startsWith('eu:');
    const slug = eu ? h.token.slice(3) : h.token;
    switch (h.ats) {
      case 'greenhouse':
        return `https://job-boards.${eu ? 'eu.' : ''}greenhouse.io/${slug}/jobs/${h.jobId}`;
      case 'lever':
        return `https://jobs.${eu ? 'eu.' : ''}lever.co/${slug}/${h.jobId.toLowerCase()}`;
      case 'ashby':
        return `https://jobs.ashbyhq.com/${slug}/${h.jobId.toLowerCase()}`;
      case 'workday': {
        const wp = workdayParts(h.token);
        if (wp) return `${wp.boardUrl}${h.jobId}`;
        break;
      }
      case 'smartrecruiters':
        return `https://jobs.smartrecruiters.com/${h.token}/${h.jobId}`;
      case 'workable':
        return `https://apply.workable.com/${h.token}/j/${h.jobId.toUpperCase()}`;
      case 'personio':
        return `${boardUrlFor('personio', h.token)}/job/${h.jobId}`;
      case 'rippling':
        return `https://ats.rippling.com/${h.token}/jobs/${h.jobId.toLowerCase()}`;
      case 'bamboohr':
        return `https://${h.token}.bamboohr.com/careers/${h.jobId}`;
      default:
        break;
    }
  }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  // Ashby/Lever/Recruitee/Teamtailor "apply" sub-pages are the same posting.
  if (h) u.pathname = u.pathname.replace(/\/(apply|application|c\/new)\/?$/i, '');
  if (u.hostname.startsWith('www.') && !h) u.hostname = u.hostname.slice(4);
  const s = u.toString().replace(/\/(\?|$)/, '$1');
  return s.replace(/\?$/, '');
}

/** Is this URL on a known ATS (i.e. the employer's own application system)? */
export function isAtsUrl(raw: string): boolean {
  return !!detectAts(raw);
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>()\\]+|\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|workable\.com|recruitee\.com|teamtailor\.com|bamboohr\.com|breezy\.hr|applytojob\.com|rippling\.com|pinpointhq\.com)[^\s"'<>()\\]*/gi;

/**
 * DOM fingerprints: find every ATS reference in a careers page (embedded
 * boards, iframes, script widgets, plain links). Most specific first: hits with
 * a job id, then hits with a board token.
 */
export function detectAtsInHtml(html: string, baseUrl?: string): AtsHit[] {
  const found = new Map<string, AtsHit>();
  const add = (h: AtsHit | null) => {
    if (!h || (!h.token && !h.jobId)) return;
    const key = `${h.ats}|${h.token ?? ''}|${h.jobId ?? ''}`;
    if (!found.has(key)) found.set(key, h);
  };
  const text = html.replace(/&amp;/g, '&').replace(/\\\//g, '/');
  for (const m of text.matchAll(URL_IN_TEXT)) add(detectAts(m[0].startsWith('//') ? `https:${m[0]}` : m[0]));
  // Script-configured embeds that never spell out a full URL.
  for (const m of text.matchAll(/Grnhse\.Settings\.boardToken\s*=\s*["']([\w-]+)["']/g)) add(detectAts(`https://boards.greenhouse.io/${m[1]}`));
  for (const m of text.matchAll(/greenhouse\.io\/embed\/job_board\/js\?for=([\w-]+)/g)) add(detectAts(`https://boards.greenhouse.io/${m[1]}`));
  for (const m of text.matchAll(/data-domain=["']([a-z0-9-]+)\.bamboohr\.com/gi)) add(detectAts(`https://${m[1]}.bamboohr.com/careers`));
  for (const m of text.matchAll(/whr_embed\(\s*\d+\s*,\s*\{[^}]*?["']?(?:account|subdomain)["']?\s*:\s*["']([\w-]+)["']/g)) add(detectAts(`https://apply.workable.com/${m[1]}`));
  for (const m of text.matchAll(/ashby_embed[^>]*?(?:jobs\.ashbyhq\.com\/)([\w.-]+)/g)) add(detectAts(`https://jobs.ashbyhq.com/${m[1]}`));
  // A custom-domain page whose own URL carries a job id parameter.
  if (baseUrl) add(detectAts(baseUrl));
  return [...found.values()].sort((a, b) => Number(!!b.jobId) - Number(!!a.jobId) || Number(!!b.token) - Number(!!a.token));
}

/** Every ATS URL mentioned in a block of HTML or text, as written (entity-decoded), most specific first. */
export function findAtsUrls(html: string): string[] {
  const text = html.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/\\\//g, '/');
  const urls = new Set<string>();
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const u = (m[0].startsWith('//') ? `https:${m[0]}` : m[0]).replace(/[.,;:!?]+$/, '');
    if (detectAts(u)) urls.add(u);
  }
  return [...urls].sort((a, b) => Number(!!detectAts(b)?.jobId) - Number(!!detectAts(a)?.jobId));
}

/** The employer's own domain from a careers URL, if it isn't an ATS or job-board host. */
export function employerDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|careers|jobs|career|boards|apply|join)\./, '');
  if (ATS_HOST_RE.test(u.hostname) || /(linkedin|indeed|glassdoor|ziprecruiter|google|bayt|naukri|naukrigulf|rozee|mustakbil|ycombinator|workatastartup|github|news\.ycombinator|reddit|remoteok|remotive|himalayas|jobicy|weworkremotely|arbeitnow|themuse|workingnomads|4dayweek|python\.org|simplify|wellfound|angel)\./.test(`${host}.`)) {
    return null;
  }
  return host;
}

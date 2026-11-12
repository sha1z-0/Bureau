import { request } from '../sources/http.ts';

/**
 * Is a posting still open? Asked right before Bureau pays to write an application, because boards close roles
 * between a scout and the apply (a JS job page then just says "Page not found").
 *
 * The ATS families with public posting APIs are asked directly; any other page counts as closed only on 404 or 410.
 * Errors and anything unclear answer 'unknown', so a flaky network never stops an application.
 */
export type Liveness = 'open' | 'closed' | 'blocked' | 'unreachable' | 'unknown';

/** A bot wall (Cloudflare and the like) in front of the page: Bureau never solves those, so the form is out of reach. */
const BOT_WALL = /challenge-platform|cf-chl|just a moment\.\.\.|attention required|verify you are human|captcha-delivery|px-captcha/i;

const GREENHOUSE = /^https?:\/\/(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i;
const LEVER = /^https?:\/\/jobs\.(?:eu\.)?lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i;
const ASHBY = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i;
/** host, tenant (first host label), site, then "/job/…" (an optional "/en-US" locale is skipped). */
const WORKDAY = /^https?:\/\/(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)(\/job\/[^?#]+)/i;

export async function postingOpen(url: string): Promise<Liveness> {
  try {
    let m = url.match(GREENHOUSE);
    if (m) return verdict((await request(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(m[1])}/jobs/${m[2]}`, { timeoutMs: 10_000 })).status);
    m = url.match(LEVER);
    if (m) return verdict((await request(`https://api.lever.co/v0/postings/${encodeURIComponent(m[1])}/${m[2]}`, { timeoutMs: 10_000 })).status);
    // Workday job pages are a JavaScript app (200 even when the job is gone); its CXS job API answers 404 instead.
    m = url.match(WORKDAY);
    if (m) {
      // An internal or referral portal ("Employee_Referral_Portal") is for staff to sign in to, not for applicants.
      if (/referral|internal|employee/i.test(m[3])) return 'unreachable';
      const api = `https://${m[1]}/wday/cxs/${m[2]}/${m[3]}${m[4]}`;
      return verdict((await request(api, { timeoutMs: 10_000, accept: 'application/json' })).status);
    }
    m = url.match(ASHBY);
    if (m) {
      const res = await request(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(m[1])}`, { timeoutMs: 15_000 });
      if (!res.ok) return 'unknown';
      const jobs = res.json<{ jobs?: { id: string }[] }>().jobs ?? [];
      if (!jobs.some((j) => j.id.toLowerCase() === m![2].toLowerCase())) return 'closed';
      // Companies that embed Ashby on their own careers site switch the hosted page off: listed, but a 404 to visitors.
      const page = await request(url, { timeoutMs: 10_000, accept: 'text/html' });
      return page.status === 404 ? 'unreachable' : 'open';
    }
    const page = await request(url, { timeoutMs: 10_000, accept: 'text/html' });
    if ((page.status === 403 || page.status === 503 || page.status === 429) && BOT_WALL.test(page.text().slice(0, 20_000))) return 'blocked';
    return verdict(page.status);
  } catch {
    return 'unknown';
  }
}

function verdict(status: number): Liveness {
  if (status === 404 || status === 410) return 'closed';
  return status >= 200 && status < 300 ? 'open' : 'unknown';
}

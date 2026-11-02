import type { Page } from 'playwright-core';
import type { AtsFamily } from '../contracts/job.ts';
import { detectAts as detectFromUrl, detectAtsInHtml } from '../scout/detect.ts';
import { isFixtureOrigin } from './browser.ts';

/**
 * Which ATS runs this form: URL first (A01's detector), then DOM fingerprints.
 * Local fixture replicas carry the real host as their first path segment
 * (`http://127.0.0.1:PORT/boards.greenhouse.io/...`); in replay mode that path is
 * read as the URL.
 */

const FINGERPRINTS: [AtsFamily, RegExp[]][] = [
  ['workday', [/data-automation-id="(?:jobPostingHeader|applyManually|adventureButton|pageFooterNextButton|legalNameSection|createAccountLink|signInLink|utilityButtonSignIn|applyFlowPage|progressBar)/i, /myworkdayjobs\.com|myworkdaysite\.com|wd\d\.myworkday/i]],
  ['greenhouse', [/id="application_form"|id="grnhse_app"|id="grnhse_iframe"|grnhse|boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io\/embed|__remixContext[^<]{0,400}jobPost/i]],
  ['lever', [/jobs\.lever\.co|class="[^"]*\bapplication-page\b|lever-job|name="urls\[LinkedIn\]"|lever\.co\/[\w-]+\/[0-9a-f-]{36}/i]],
  ['ashby', [/ashbyhq|ashby-application|_systemfield_|ashby_embed/i]],
  ['smartrecruiters', [/smartrecruiters|<spl-|<oc-|oneclick-ui/i]],
  ['workable', [/apply\.workable\.com|data-ui="(?:application-form|apply-button)"|workable(?:cdn)?\.com|whr_embed/i]],
  ['recruitee', [/recruitee|candidate\[openQuestionAnswers\]/i]],
  ['personio', [/personio|recruiting_channel_id/i]],
  ['teamtailor', [/teamtailor|candidate\[pitch\]/i]],
  ['bamboohr', [/bamboohr|BambooHR/]],
  ['breezy', [/breezy\.hr|breezy-|ng-app="breezy/i]],
  ['jazzhr', [/applytojob\.com|jazzhr|resumator/i]],
  ['icims', [/icims/i]],
  ['taleo', [/taleo/i]],
  ['successfactors', [/successfactors|sapsf|career\d*\.sap\b/i]],
  ['rippling', [/ats\.rippling\.com/i]],
  ['pinpoint', [/pinpointhq/i]],
  ['comeet', [/comeet/i]],
];

/** The URL a detector should read: the real host behind a local fixture replica. */
export function effectiveUrl(url: string): string {
  try {
    const u = new URL(url);
    if (isFixtureOrigin(url) || /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/([a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i);
      if (m) return `https://${m[1]}${m[2] ?? '/'}${u.search}`;
    }
  } catch {
    /* not a URL */
  }
  return url;
}

export function detectAts(url: string, html?: string): AtsFamily | null {
  const real = effectiveUrl(url);
  const hit = detectFromUrl(real);
  if (hit && hit.ats !== 'other') return hit.ats;
  if (html) {
    const scores = new Map<AtsFamily, number>();
    for (const [ats, res] of FINGERPRINTS) {
      let n = 0;
      for (const re of res) {
        const m = html.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
        n += m ? Math.min(m.length, 5) : 0;
      }
      if (n) scores.set(ats, n);
    }
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
    const fromHtml = detectAtsInHtml(html, real)[0];
    if (fromHtml && fromHtml.ats !== 'other') return fromHtml.ats;
  }
  return hit?.ats ?? null;
}

/** Detect on a live page: its URL, its HTML and every child frame's URL (embeds). */
export async function detectOnPage(page: Page, hint?: string | null): Promise<AtsFamily | null> {
  const fromUrl = detectAts(page.url());
  if (fromUrl && fromUrl !== 'other') return fromUrl;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const a = detectAts(f.url());
    if (a && a !== 'other') return a;
  }
  const html = await page.content().catch(() => '');
  const a = detectAts(page.url(), html);
  if (a && a !== 'other') return a;
  return (hint as AtsFamily | null) ?? a;
}

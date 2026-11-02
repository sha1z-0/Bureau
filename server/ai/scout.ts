import { z } from 'zod/v4';
import { safeFetch } from '../security/safeFetch.ts';
import { htmlToText } from '../security/sanitize.ts';
import type { RawJob } from '../sources/types.ts';
import { profileForPrompt, type Profile } from '../services/profileStore.ts';
import { research, structured } from './claude.ts';
import { CAPTURE, emailInText, fence, SCOUT } from './prompts.ts';

export const FoundJobs = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      remote: z.boolean(),
      url: z.string(),
      foundOn: z.string(),
      summary: z.string(),
      applyEmail: z.string(),
      postedAt: z.string(),
    }),
  ),
});

/**
 * Deep scan: Claude searches the open web — career pages, niche boards and the
 * social posts that never reach an aggregator — then the findings are parsed
 * into jobs. Only URLs that appeared in actual search results are kept.
 */
export async function deepScan(profile: Profile, focus: string, days: number, log: (m: string) => void): Promise<RawJob[]> {
  const prefs = profile.preferences;
  const prompt = `${profileForPrompt(profile)}

---
Find up to 20 strong-fit open roles for this candidate posted in the last ${days} days.
Focus: ${focus || `${(prefs.targetRoles.length ? prefs.targetRoles : profile.targetRoles).join(', ')}`}
Location preference: ${prefs.locations.join(', ')}${prefs.remoteOnly ? ' (remote only)' : ''}.
Cover at least: direct company career pages/ATS boards, one niche board for the candidate's discipline, and social hiring posts (LinkedIn posts, X, Reddit, Hacker News).
Finish with a clear list of every role you found and verified.`;

  log('Deep scan: Claude is searching the web…');
  const found = await research({ task: 'scan', system: [{ type: 'text', text: SCOUT }], prompt, maxSearches: 12 });
  log(`Deep scan: ${found.sources.length} pages consulted, parsing findings…`);

  const parsed = await structured({
    task: 'capture',
    system: [{ type: 'text', text: 'Convert a scout report into structured job records. Copy URLs exactly as written; do not invent any. Use empty strings for unknown fields; postedAt as ISO date or empty.' }],
    content: `<scout_report>\n${fence(found.text)}\n</scout_report>`,
    schema: FoundJobs,
  });

  const seen = new Set(found.sources.map((s) => s.url.replace(/\/$/, '')));
  const seenHosts = new Set(found.sources.map((s) => safeHost(s.url)));
  return parsed.jobs
    .filter((j) => /^https?:\/\//.test(j.url))
    .filter((j) => seen.has(j.url.replace(/\/$/, '')) || seenHosts.has(safeHost(j.url)))
    .map<RawJob>((j) => ({
      source: 'deepscan',
      externalId: j.url,
      title: j.title,
      company: j.company || 'Unknown',
      location: j.location,
      remote: j.remote,
      url: j.url,
      descriptionText: `${j.summary}\n\nFound via: ${j.foundOn}`,
      descriptionHtml: '',
      postedAt: j.postedAt ? new Date(j.postedAt).toString() !== 'Invalid Date' ? new Date(j.postedAt).toISOString() : null : null,
      applyEmail: emailInText(j.applyEmail, found.text),
      tags: [j.foundOn].filter(Boolean),
    }));
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const CapturedJob = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  applyUrl: z.string(),
  applyEmail: z.string(),
  salaryText: z.string(),
  descriptionMarkdown: z.string(),
});

/** Capture: paste a post from your feed (LinkedIn, X, Discord…) or a URL, and it becomes a job. */
export async function captureJob(input: { url?: string; text?: string }): Promise<RawJob> {
  let pageText = input.text ?? '';
  let pageUrl = input.url ?? '';
  if (input.url && !input.text) {
    const res = await safeFetch(input.url, { maxBytes: 3 * 1024 * 1024, accept: 'text/html,application/xhtml+xml' });
    pageUrl = res.url;
    pageText = htmlToText(res.text()).slice(0, 60_000);
  }
  if (pageText.trim().length < 40) throw new Error('Not enough text to find a job in — paste the full post.');
  const job = await structured({
    task: 'capture',
    system: [{ type: 'text', text: CAPTURE }],
    content: `<job_posting source="${pageUrl ? 'web page' : 'pasted text'}">\n${fence(pageText)}\n</job_posting>`,
    schema: CapturedJob,
  });
  const url = /^https?:\/\//.test(job.applyUrl) ? job.applyUrl : pageUrl;
  return {
    source: 'capture',
    externalId: url || `${job.company}:${job.title}:${Date.now()}`,
    title: job.title || 'Untitled role',
    company: job.company || 'Unknown',
    location: job.location,
    remote: job.remote,
    url: url || '',
    descriptionText: job.descriptionMarkdown,
    descriptionHtml: '',
    postedAt: new Date().toISOString(),
    applyEmail: emailInText(job.applyEmail, pageText),
    tags: job.salaryText ? [job.salaryText] : [],
  };
}

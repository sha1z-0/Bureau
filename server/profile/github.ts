import type { GithubSummary } from '../contracts/profile.ts';
import { extractFacts, type FactSourceDoc } from '../ai/profile.ts';
import { getSetting, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { getSecret } from '../security/vault.ts';
import type { AiClient } from './ai.ts';
import { reconcileFacts, type IncomingFact } from './facts.ts';
import type { Fetcher } from './fetch.ts';
import { bump } from './state.ts';
import { clip, sha } from './text.ts';
import type { PartReport } from './types.ts';

/**
 * GitHub sync through the public REST API (an optional token from the vault
 * raises the rate limit). Only the candidate's own repositories count, and a
 * fork only when they made meaningful commits to it. Notable repos become
 * project facts with links; their READMEs are mined for near-verbatim claims
 * (task `profile_sync`), cached by README hash so an unchanged repo costs
 * nothing on the next daily sync.
 */

export const GITHUB_TOKEN_SECRET = 'github_token';
const API = 'https://api.github.com';
const README_CACHE = 'profile.github.readmeFacts';
const SUMMARY_KEY = 'profile.github';
const MAX_NOTABLE = 12;
const MAX_FORKS_CHECKED = 5;
const MEANINGFUL_FORK_COMMITS = 3;

interface ApiRepo {
  name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived?: boolean;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string | null;
  size: number;
  owner?: { login: string };
}

export type GithubRepo = GithubSummary['repos'][number] & { recentCommits: number | null; archived: boolean };
export type GithubSummaryFull = Omit<GithubSummary, 'repos'> & { repos: GithubRepo[]; profileUrl: string };

interface ReadmeCache {
  [repoUrl: string]: { hash: string; facts: { kind: IncomingFact['kind']; text: string }[] };
}

export function storedGithub(): GithubSummaryFull | null {
  return getSetting<GithubSummaryFull | null>(SUMMARY_KEY, null);
}

function headers(token: string | null): Record<string, string> {
  return { 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function api<T>(fetcher: Fetcher, path: string, token: string | null, accept = 'application/vnd.github+json'): Promise<T | null> {
  const res = await fetcher(`${API}${path}`, { accept, headers: headers(token), maxBytes: 3 * 1024 * 1024, timeoutMs: 20_000 });
  if (res.status === 404 || res.status === 409) return null; // 409: empty repository
  if (res.status === 401) throw new AppError(401, 'GITHUB_AUTH', 'GitHub rejected the token in the vault. Replace or remove it.');
  if (res.status === 403 || res.status === 429) throw new AppError(429, 'GITHUB_RATE', 'GitHub rate limit reached. Add a token in Settings or try again in an hour.');
  if (!res.ok) throw new AppError(502, 'GITHUB_ERROR', `GitHub answered ${res.status} for ${path}`);
  return accept.includes('raw') ? (res.text() as T) : res.json<T>();
}

/** README markdown → the prose in it (no code, badges, images or HTML). */
export function readmeText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/[*_`]{1,3}/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

function notability(r: ApiRepo, nowMs: number): number {
  const ageDays = r.pushed_at ? (nowMs - Date.parse(r.pushed_at)) / 86_400_000 : 9999;
  return r.stargazers_count * 3 + (r.description ? 3 : 0) + (r.topics?.length ? 1 : 0) + (ageDays < 90 ? 5 : ageDays < 365 ? 3 : ageDays < 730 ? 1 : 0) - (r.archived ? 2 : 0);
}

export interface GithubSyncOptions {
  login: string;
  fetcher: Fetcher;
  ai: AiClient;
  now?: Date;
  token?: string | null;
}

/** Fetch, pick notable repos, extract facts, reconcile. */
export async function syncGithub(opts: GithubSyncOptions): Promise<PartReport> {
  const { login, fetcher, ai } = opts;
  const nowMs = (opts.now ?? new Date()).getTime();
  const token = opts.token === undefined ? getSecret(GITHUB_TOKEN_SECRET) : opts.token;
  const enc = encodeURIComponent(login);

  const list = await api<ApiRepo[]>(fetcher, `/users/${enc}/repos?per_page=100&type=owner&sort=pushed`, token);
  if (!list) throw new AppError(404, 'GITHUB_USER', `GitHub has no user called ${login}.`);
  const own = list.filter((r) => !r.owner || r.owner.login.toLowerCase() === login.toLowerCase()).filter((r) => r.size > 0);

  // Forks only count when the candidate made meaningful commits to them.
  const forks = own.filter((r) => r.fork).sort((a, b) => notability(b, nowMs) - notability(a, nowMs)).slice(0, MAX_FORKS_CHECKED);
  const meaningfulForks = new Set<string>();
  for (const f of forks) {
    const commits = await api<unknown[]>(fetcher, `/repos/${enc}/${encodeURIComponent(f.name)}/commits?author=${enc}&per_page=10`, token);
    if ((commits?.length ?? 0) >= MEANINGFUL_FORK_COMMITS) meaningfulForks.add(f.name);
  }
  const eligible = own.filter((r) => !r.fork || meaningfulForks.has(r.name));
  const notable = eligible
    .filter((r) => r.description || r.stargazers_count > 0 || (r.pushed_at && nowMs - Date.parse(r.pushed_at) < 2 * 365 * 86_400_000))
    .sort((a, b) => notability(b, nowMs) - notability(a, nowMs) || a.name.localeCompare(b.name))
    .slice(0, MAX_NOTABLE);

  const since = new Date(nowMs - 90 * 86_400_000).toISOString().slice(0, 10);
  const repos: GithubRepo[] = [];
  const readmes: FactSourceDoc[] = [];
  const failedReadmes = new Set<string>();
  const languageCount = new Map<string, number>();
  for (const r of notable) {
    const base = `/repos/${enc}/${encodeURIComponent(r.name)}`;
    let languages: string[] = r.language ? [r.language] : [];
    let recentCommits: number | null = null;
    try {
      const langs = await api<Record<string, number>>(fetcher, `${base}/languages`, token);
      if (langs && Object.keys(langs).length) languages = Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l]) => l);
      const commits = await api<unknown[]>(fetcher, `${base}/commits?author=${enc}&since=${since}T00:00:00Z&per_page=100`, token);
      recentCommits = commits?.length ?? 0;
      const md = await api<string>(fetcher, `${base}/readme`, token, 'application/vnd.github.raw+json');
      if (md) readmes.push({ ref: r.html_url, label: `GitHub README of ${login}/${r.name}`, text: clip(readmeText(md), 4000) });
    } catch (err) {
      if ((err as AppError).code === 'GITHUB_RATE' || (err as AppError).code === 'GITHUB_AUTH') throw err;
      failedReadmes.add(r.html_url);
    }
    for (const l of languages.slice(0, 4)) languageCount.set(l, (languageCount.get(l) ?? 0) + 1);
    repos.push({
      name: r.name,
      url: r.html_url,
      description: r.description ?? '',
      languages,
      topics: r.topics ?? [],
      stars: r.stargazers_count,
      fork: r.fork,
      pushedAt: r.pushed_at,
      recentCommits,
      archived: !!r.archived,
    });
  }

  // README claims: only changed READMEs go to Claude.
  const cache = getSetting<ReadmeCache>(README_CACHE, {});
  const nextCache: ReadmeCache = {};
  const changed = readmes.filter((d) => cache[d.ref]?.hash !== sha(d.text));
  for (const d of readmes) if (!changed.includes(d)) nextCache[d.ref] = cache[d.ref];
  for (const url of failedReadmes) if (cache[url]) nextCache[url] = cache[url];
  let aiError: string | null = null;
  let rejected = 0;
  if (changed.length) {
    try {
      const out = await extractFacts(changed, ai);
      rejected = out.rejected.length;
      for (const d of changed) nextCache[d.ref] = { hash: sha(d.text), facts: out.facts.filter((f) => f.sourceRef === d.ref).map(({ kind, text }) => ({ kind, text })) };
    } catch (err) {
      aiError = (err as Error).message;
      for (const d of changed) if (cache[d.ref]) nextCache[d.ref] = cache[d.ref]; // keep yesterday's claims rather than lose them
    }
  }

  const profileUrl = `https://github.com/${login}`;
  const incoming: IncomingFact[] = [{ kind: 'link', text: `GitHub: ${profileUrl}`, sourceRef: profileUrl }];
  for (const r of repos) incoming.push({ kind: 'project', text: r.description ? `${r.name}: ${r.description}` : r.name, sourceRef: r.url, context: r.url });
  for (const [lang] of [...languageCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    incoming.push({ kind: 'skill', text: lang, sourceRef: `${profileUrl}?tab=repositories&language=${encodeURIComponent(lang.toLowerCase())}` });
  }
  for (const [url, entry] of Object.entries(nextCache)) for (const f of entry.facts) incoming.push({ kind: f.kind, text: f.text, sourceRef: url, context: url });

  const result = reconcileFacts('github', incoming);
  setSetting(README_CACHE, nextCache);
  const summary: GithubSummaryFull = { login, profileUrl, syncedAt: new Date(nowMs).toISOString(), repos };
  setSetting(SUMMARY_KEY, summary);
  bump();
  const notes = [`${repos.length} notable repo(s) of ${eligible.length}`];
  if (changed.length) notes.push(`${changed.length} README(s) read`);
  if (rejected) notes.push(`${rejected} unverifiable claim(s) dropped`);
  if (aiError) notes.push(`README claims kept from the last sync: ${aiError}`);
  return { status: aiError ? 'partial' : 'ok', ...result, message: notes.join('; ') };
}

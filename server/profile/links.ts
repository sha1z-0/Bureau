import { z } from 'zod/v4';
import { LinksSchema, type Links } from '../contracts/profile.ts';
import { getSetting, setSetting } from '../db.ts';
import type { Profile } from '../services/profileStore.ts';
import { bump } from './state.ts';

/**
 * The candidate's links. Whatever the owner sets explicitly wins; any field
 * left empty is filled from the links on the CV.
 */

const KEY = 'profile.links';

const SOCIAL_HOSTS = /(^|\.)(x\.com|twitter\.com|mastodon\.[a-z]+|bsky\.app|dev\.to|medium\.com|behance\.net|dribbble\.com|kaggle\.com|stackoverflow\.com|hashnode\.(dev|com)|youtube\.com|leetcode\.com|hackerrank\.com|codepen\.io|huggingface\.co|gitlab\.com|substack\.com)$/i;

function host(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Best guess at github / linkedin / portfolio / socials from the CV's links. */
export function linksFromProfile(p: Profile | null): Links {
  const out: Links = { github: '', portfolio: '', linkedin: '', socials: [] };
  let portfolioLabelled = false;
  for (const l of p?.links ?? []) {
    if (/^mailto:|^tel:/i.test(l.url.trim())) continue;
    const url = normalizeUrl(l.url);
    const h = host(url);
    if (!h) continue;
    if (/(^|\.)github\.com$/.test(h)) {
      if (!out.github && /^\/[^/]+\/?$/.test(new URL(url).pathname)) out.github = url;
    } else if (/(^|\.)linkedin\.com$/.test(h)) {
      out.linkedin ||= url;
    } else if (SOCIAL_HOSTS.test(h)) {
      out.socials.push({ label: l.label || h, url });
    } else {
      const labelled = /portfolio|website|site|personal|home/i.test(l.label);
      if (!out.portfolio || (labelled && !portfolioLabelled)) {
        out.portfolio = url;
        portfolioLabelled = labelled;
      }
    }
  }
  return out;
}

export function storedLinks(): Partial<Links> {
  return getSetting<Partial<Links>>(KEY, {});
}

export function getLinks(p: Profile | null): Links {
  const derived = linksFromProfile(p);
  const set = storedLinks();
  return {
    github: set.github || derived.github,
    portfolio: set.portfolio || derived.portfolio,
    linkedin: set.linkedin || derived.linkedin,
    socials: set.socials?.length ? set.socials : derived.socials,
  };
}

const UrlField = z.string().trim().max(500).refine((u) => !u || /^https?:\/\/[^\s]+$/i.test(normalizeUrl(u)), 'must be a web address');

export const LinksInput = z.object({
  github: UrlField.optional(),
  portfolio: UrlField.optional(),
  linkedin: UrlField.optional(),
  socials: z.array(z.object({ label: z.string().trim().max(60), url: UrlField })).max(20).optional(),
});

export function setLinks(input: z.input<typeof LinksInput>): Partial<Links> {
  const parsed = LinksInput.parse(input);
  const next: Partial<Links> = { ...storedLinks() };
  for (const k of ['github', 'portfolio', 'linkedin'] as const) if (parsed[k] !== undefined) next[k] = parsed[k] ? normalizeUrl(parsed[k]) : '';
  if (parsed.socials) next.socials = parsed.socials.filter((s) => s.url).map((s) => ({ label: s.label, url: normalizeUrl(s.url) }));
  LinksSchema.partial().parse(next);
  setSetting(KEY, next);
  bump();
  return next;
}

/** "https://github.com/octocat", "github.com/octocat/", "octocat" → "octocat". */
export function githubLogin(link: string): string | null {
  const t = link.trim();
  if (!t) return null;
  let login = t;
  if (/github\.com/i.test(t)) {
    try {
      login = new URL(normalizeUrl(t)).pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      return null;
    }
  }
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login) ? login : null;
}

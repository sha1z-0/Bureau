import { z } from 'zod/v4';
import { safeFetch } from '../security/safeFetch.ts';
import { htmlToText } from '../security/sanitize.ts';
import {
  DEFAULT_PREFERENCES,
  ExtractedProfileSchema,
  loadProfile,
  saveProfile,
  type Profile,
} from '../services/profileStore.ts';
import { structured, type UserContent } from './claude.ts';
import { fence, PROFILE_EXTRACTOR, UNTRUSTED_NOTE } from './prompts.ts';

/** Read a CV (PDF natively, or extracted text) into the structured profile. */
export async function extractProfile(input: { pdf?: Buffer; text?: string; notes?: string }): Promise<Profile> {
  const content: Exclude<UserContent, string> = [];
  if (input.pdf) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.toString('base64') },
      title: 'Candidate CV',
    });
  }
  if (input.text) content.push({ type: 'text', text: `<cv>\n${input.text}\n</cv>` });
  content.push({
    type: 'text',
    text: `Extract the structured profile from this CV.${input.notes ? `\n\nThe candidate adds:\n${input.notes}` : ''}`,
  });

  const extracted = await structured({
    task: 'profile',
    system: [{ type: 'text', text: PROFILE_EXTRACTOR }],
    content,
    schema: ExtractedProfileSchema,
    maxTokens: 32000,
  });

  const previous = loadProfile();
  const profile: Profile = {
    ...extracted,
    portfolioNotes: previous?.portfolioNotes ?? '',
    preferences: previous?.preferences ?? {
      ...DEFAULT_PREFERENCES,
      targetRoles: extracted.targetRoles,
      categories: extracted.categories,
      locations: extracted.location ? ['Remote', extracted.location] : ['Remote'],
      signature: [extracted.name, extracted.email, ...extracted.links.slice(0, 2).map((l) => l.url)].filter(Boolean).join('\n'),
    },
  };
  saveProfile(profile);
  return profile;
}

export const PortfolioDigest = z.object({
  notes: z.string(),
  newLinks: z.array(z.object({ label: z.string(), url: z.string() })),
  newSkills: z.array(z.string()),
});

/** Read portfolio / GitHub / personal-site pages and fold real evidence into the profile. */
export async function digestPortfolio(urls: string[]): Promise<Profile> {
  const profile = loadProfile();
  if (!profile) throw new Error('Upload a CV first so Bureau knows who you are.');
  const pages: string[] = [];
  for (const url of urls.slice(0, 6)) {
    try {
      const res = await safeFetch(url, { maxBytes: 2 * 1024 * 1024, accept: 'text/html,application/xhtml+xml' });
      pages.push(`<web_page url="${encodeURI(url)}">
${fence(htmlToText(res.text()).slice(0, 25_000))}
</web_page>`);
    } catch (err) {
      pages.push(`<web_page url="${encodeURI(url)}">(could not be fetched)</web_page>`);
    }
  }
  const digest = await structured({
    task: 'profile',
    system: [
      {
        type: 'text',
        text: `You read a candidate's own portfolio, GitHub and personal-site pages and summarise the concrete evidence they contain: projects (what, stack, scale, outcomes), open-source work, writing, talks, awards. Facts only, as they appear on the pages. ${UNTRUSTED_NOTE}`,
      },
    ],
    content: `Candidate: ${profile.name} — ${profile.headline}\nKnown skills: ${profile.coreStack.join(', ')}\n\n${pages.join('\n\n')}\n\nWrite concise Markdown notes of the evidence (notes), any useful profile links not already known (newLinks), and skills evidenced on the pages that are missing from the known list (newSkills).`,
    schema: PortfolioDigest,
  });
  const known = new Set(profile.links.map((l) => l.url));
  const updated: Profile = {
    ...profile,
    portfolioNotes: digest.notes,
    links: [...profile.links, ...digest.newLinks.filter((l) => !known.has(l.url))],
    skills: [...new Set([...profile.skills, ...digest.newSkills])],
  };
  saveProfile(updated);
  return updated;
}

import { getJson } from '../security/safeFetch.ts';
import { cleanHtml } from '../security/sanitize.ts';
import type { Connector, RawJob } from './types.ts';
import { firstEmail, htmlToText, isRemote, pool, toIso } from './util.ts';

/**
 * Community hiring threads — the "social" layer. Posts here are written by the
 * people doing the hiring, often with a direct email, which makes them the best
 * targets for a personal message rather than an ATS form.
 */

interface AlgoliaHit {
  objectID: string;
  title?: string;
  created_at?: string;
  comment_text?: string;
  author?: string;
  parent_id?: number;
  story_id?: number;
}

export const hackernews: Connector = {
  id: 'hackernews',
  label: 'HN · Who is hiring',
  kind: 'community',
  homepage: 'https://news.ycombinator.com',
  description: "The monthly 'Ask HN: Who is hiring?' thread, read through the official Algolia HN API.",
  defaultEnabled: true,
  async run(ctx) {
    const stories = await getJson<{ hits: AlgoliaHit[] }>(
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=10',
    );
    const thread = stories.hits.find((h) => /who is hiring/i.test(h.title ?? ''));
    if (!thread) {
      ctx.log('HN: no current "Who is hiring?" thread found');
      return [];
    }
    const storyId = Number(thread.objectID);
    const pages = await pool([0, 1, 2], 2, (page) =>
      getJson<{ hits: AlgoliaHit[] }>(
        `https://hn.algolia.com/api/v1/search?tags=comment,story_${storyId}&hitsPerPage=500&page=${page}`,
      ),
    );
    const comments = pages.flatMap((p) => p?.hits ?? []).filter((c) => c.parent_id === storyId && c.comment_text);
    ctx.log(`HN: ${comments.length} top-level posts in "${thread.title}"`);
    return comments.map<RawJob>((c) => {
      const html = cleanHtml(c.comment_text!);
      const text = htmlToText(html);
      const header = text.split('\n')[0];
      const parts = header.split('|').map((p) => p.trim()).filter(Boolean);
      const company = parts[0]?.replace(/\(.*?\)/g, '').trim().slice(0, 80) || c.author || 'HN poster';
      const roleish = parts.find((p, i) => i > 0 && /engineer|developer|designer|lead|scientist|security|sre|devops|architect|programmer|analyst|manager/i.test(p));
      const locationish = parts.find((p, i) => i > 0 && p !== roleish && /remote|onsite|on-site|hybrid|,|\b[A-Z]{2}\b/.test(p));
      return {
        source: 'hackernews',
        externalId: c.objectID,
        title: (roleish ?? parts[1] ?? 'Multiple roles').slice(0, 140),
        company,
        location: locationish ?? '',
        remote: isRemote(header),
        url: `https://news.ycombinator.com/item?id=${c.objectID}`,
        descriptionHtml: html,
        descriptionText: text,
        postedAt: toIso(c.created_at),
        tags: ['hn-hiring'],
        applyEmail: firstEmail(text),
      };
    });
  },
};

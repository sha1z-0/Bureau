import { z } from 'zod/v4';

/** Public business information about a company. Every claim carries the URL it came from. */

const Sourced = z.object({ text: z.string(), sourceUrl: z.string() });

export const ResearchBriefSchema = z.object({
  company: z.string(),
  domain: z.string().nullable(),
  whatTheyBuild: z.string(),
  products: z.array(Sourced),
  /** News and launches from the last six months. */
  recent: z.array(Sourced.extend({ date: z.string().nullable() })),
  techSignals: z.array(Sourced),
  values: z.array(Sourced),
  stage: z.string(),
  teamSize: z.string(),
  /** Only when publicly named in the posting or on the company's own pages. */
  hiringContact: z.object({ name: z.string(), role: z.string(), sourceUrl: z.string() }).nullable(),
  fetchedAt: z.string(),
});
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;

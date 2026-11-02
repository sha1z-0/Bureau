import { z } from 'zod/v4';
import { CATEGORIES } from '../sources/types.ts';

/**
 * Jobs as they cross module boundaries. Lead-owned: request changes in
 * docs/build/requests/AXX.md rather than editing here.
 */

export const ATS_FAMILIES = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workday',
  'workable',
  'recruitee',
  'personio',
  'teamtailor',
  'bamboohr',
  'breezy',
  'jazzhr',
  'rippling',
  'pinpoint',
  'comeet',
  'icims',
  'taleo',
  'successfactors',
  'other',
] as const;
export const AtsFamily = z.enum(ATS_FAMILIES);
export type AtsFamily = z.infer<typeof AtsFamily>;

/** ok = looks real; suspect = weak signals; ghost = stale or endlessly reposted; scam = asks for money, personal-email only, crypto bait. */
export const Legitimacy = z.enum(['ok', 'suspect', 'ghost', 'scam']);
export type Legitimacy = z.infer<typeof Legitimacy>;

/** What every connector returns. The first block is the v1 shape; the rest is new in v2 and optional. */
export const RawJobSchema = z.object({
  source: z.string(),
  externalId: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  url: z.string(),
  descriptionHtml: z.string().optional(),
  descriptionText: z.string().optional(),
  postedAt: z.string().nullish(),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  salaryCurrency: z.string().nullish(),
  tags: z.array(z.string()).optional(),
  applyEmail: z.string().nullish(),
  // v2
  ats: AtsFamily.nullish(),
  /** The employer's own application URL when the connector knows it. */
  applyUrl: z.string().nullish(),
  companyDomain: z.string().nullish(),
});
export type RawJob = z.infer<typeof RawJobSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  source: z.string(),
  externalId: z.string().nullable(),
  url: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  remote: z.boolean(),
  category: z.enum(CATEGORIES),
  descriptionText: z.string(),
  salaryMin: z.number().nullable(),
  salaryMax: z.number().nullable(),
  salaryCurrency: z.string().nullable(),
  tags: z.array(z.string()),
  postedAt: z.string().nullable(),
  foundAt: z.string(),
  prefilterScore: z.number(),
  aiScore: z.number().nullable(),
  aiGrade: z.string().nullable(),
  applyEmail: z.string().nullable(),
  // v2
  applyUrlCanonical: z.string().nullable(),
  ats: AtsFamily.nullable(),
  companyId: z.string().nullable(),
  legitimacy: Legitimacy.nullable(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

/** Columns selected by `JOB_COLUMNS`, mapped to `JobRecord`. */
export const JOB_COLUMNS = `id, fingerprint, source, external_id, url, title, company, location, remote, category, description_text,
  salary_min, salary_max, salary_currency, tags, posted_at, found_at, prefilter_score, ai_score, ai_grade, apply_email,
  apply_url_canonical, ats, company_id, legitimacy`;

export function rowToJob(r: Record<string, unknown>): JobRecord {
  return {
    id: String(r.id),
    fingerprint: String(r.fingerprint),
    source: String(r.source),
    externalId: (r.external_id as string | null) ?? null,
    url: String(r.url),
    title: String(r.title),
    company: String(r.company),
    location: String(r.location ?? ''),
    remote: !!r.remote,
    category: r.category as JobRecord['category'],
    descriptionText: String(r.description_text ?? ''),
    salaryMin: (r.salary_min as number | null) ?? null,
    salaryMax: (r.salary_max as number | null) ?? null,
    salaryCurrency: (r.salary_currency as string | null) ?? null,
    tags: JSON.parse(String(r.tags ?? '[]')) as string[],
    postedAt: (r.posted_at as string | null) ?? null,
    foundAt: String(r.found_at),
    prefilterScore: Number(r.prefilter_score ?? 0),
    aiScore: (r.ai_score as number | null) ?? null,
    aiGrade: (r.ai_grade as string | null) ?? null,
    applyEmail: (r.apply_email as string | null) ?? null,
    applyUrlCanonical: (r.apply_url_canonical as string | null) ?? null,
    ats: (r.ats as AtsFamily | null) ?? null,
    companyId: (r.company_id as string | null) ?? null,
    legitimacy: (r.legitimacy as Legitimacy | null) ?? null,
  };
}

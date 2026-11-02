import { z } from 'zod/v4';
import { get, now, run } from '../db.ts';
import { CATEGORIES } from '../sources/types.ts';

export const ExperienceSchema = z.object({
  role: z.string(),
  company: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(z.string()),
});

export const ProjectSchema = z.object({
  name: z.string(),
  link: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
});

export const EducationSchema = z.object({
  school: z.string(),
  degree: z.string(),
  start: z.string(),
  end: z.string(),
  details: z.string(),
});

/** The part of the profile Claude extracts from a CV. */
export const ExtractedProfileSchema = z.object({
  name: z.string(),
  headline: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  summary: z.string(),
  yearsExperience: z.number(),
  seniority: z.enum(['entry', 'junior', 'mid', 'senior', 'lead']),
  categories: z.array(z.enum(CATEGORIES)),
  targetRoles: z.array(z.string()),
  coreStack: z.array(z.string()),
  skills: z.array(z.string()),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  certifications: z.array(z.string()),
  languages: z.array(z.string()),
  achievements: z.array(z.string()),
  voice: z.string(),
  cvMarkdown: z.string(),
});

export const PreferencesSchema = z.object({
  targetRoles: z.array(z.string().max(120)).max(30),
  categories: z.array(z.enum(CATEGORIES)).max(7),
  locations: z.array(z.string().max(120)).max(30),
  remoteOnly: z.boolean(),
  openToRelocation: z.boolean(),
  needsSponsorship: z.boolean(),
  minSalary: z.number().min(0).max(10_000_000),
  currency: z.string().max(8),
  excludeCompanies: z.array(z.string().max(120)).max(200),
  excludeKeywords: z.array(z.string().max(120)).max(200),
  tone: z.string().max(400),
  signature: z.string().max(1200),
  // Answers application forms ask for again and again. Filled once, reused by the hunt.
  workAuthorization: z.string().max(300).default(''),
  noticePeriod: z.string().max(120).default(''),
  salaryExpectation: z.string().max(120).default(''),
  extraAnswers: z.string().max(4000).default(''),
});

export const ProfileSchema = ExtractedProfileSchema.extend({
  portfolioNotes: z.string(),
  preferences: PreferencesSchema,
});

export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  targetRoles: [],
  categories: [],
  locations: ['Remote'],
  remoteOnly: false,
  openToRelocation: false,
  needsSponsorship: false,
  minSalary: 0,
  currency: 'USD',
  excludeCompanies: [],
  excludeKeywords: [],
  tone: 'Warm, direct and specific. Confident without hype. No clichés.',
  signature: '',
  workAuthorization: '',
  noticePeriod: '',
  salaryExpectation: '',
  extraAnswers: '',
};

export function loadProfile(): Profile | null {
  const row = get<{ data: string }>('SELECT data FROM profile WHERE id = 1');
  if (!row) return null;
  const parsed = ProfileSchema.safeParse(JSON.parse(row.data));
  return parsed.success ? parsed.data : null;
}

export function saveProfile(profile: Profile) {
  run(
    `INSERT INTO profile (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    JSON.stringify(profile),
    now(),
  );
}

/** Compact, stable rendering of the profile for prompts (kept byte-identical between calls so it caches). */
export function profileForPrompt(p: Profile): string {
  const lines = [
    `# Candidate: ${p.name}`,
    `Headline: ${p.headline}`,
    `Location: ${p.location} | Seniority: ${p.seniority} | Years: ${p.yearsExperience}`,
    `Links: ${p.links.map((l) => `${l.label} ${l.url}`).join(' · ')}`,
    `Core stack: ${p.coreStack.join(', ')}`,
    `Other skills: ${p.skills.join(', ')}`,
    `Certifications: ${p.certifications.join(', ') || 'none'}`,
    `Languages: ${p.languages.join(', ') || 'n/a'}`,
    '',
    '## Preferences',
    `Target roles: ${p.preferences.targetRoles.join(', ') || p.targetRoles.join(', ')}`,
    `Disciplines: ${(p.preferences.categories.length ? p.preferences.categories : p.categories).join(', ')}`,
    `Locations: ${p.preferences.locations.join(', ')} | Remote only: ${p.preferences.remoteOnly} | Relocation: ${p.preferences.openToRelocation} | Needs visa sponsorship: ${p.preferences.needsSponsorship}`,
    `Salary floor: ${p.preferences.minSalary ? `${p.preferences.minSalary} ${p.preferences.currency}` : 'not set'}`,
    '',
    '## Summary',
    p.summary,
    '',
    '## Full CV (source of truth)',
    p.cvMarkdown,
  ];
  if (p.portfolioNotes) lines.push('', '## Portfolio notes', p.portfolioNotes);
  return lines.join('\n');
}

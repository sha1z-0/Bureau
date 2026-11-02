import type { MasterProfile } from '../contracts/profile.ts';
import { loadMasterProfile } from '../profile/index.ts';
import { DEFAULT_PREFERENCES, loadProfile, type Preferences, type Profile } from '../services/profileStore.ts';

/**
 * The slice of the candidate the matcher needs, built from either the v2
 * master profile (A03) or the v1 profile. Rendering is deterministic: the same
 * profile always yields the same bytes, so the prompt cache keeps hitting.
 */

export interface MatchProfile {
  name: string;
  headline: string;
  location: string;
  seniority: Profile['seniority'];
  yearsExperience: number;
  coreStack: string[];
  skills: string[];
  certifications: string[];
  languages: string[];
  targetRoles: string[];
  categories: Profile['categories'];
  summary: string;
  cvMarkdown: string;
  portfolioNotes: string;
  projects: { name: string; description: string }[];
  preferences: Preferences;
  /** Skills with status `learning`: they count as partial ("currently learning"), never as met. */
  learning: string[];
  /** Active non-CV facts (GitHub, portfolio, manual) as `kind: text`. */
  facts: string[];
  /** Public repositories, most notable first. */
  repos: { name: string; description: string; languages: string[] }[];
}

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

function isMaster(p: Profile | MasterProfile): p is MasterProfile {
  return Array.isArray((p as MasterProfile).facts) && Array.isArray((p as MasterProfile).learning);
}

export function toMatchProfile(p: Profile | MasterProfile): MatchProfile {
  const base: MatchProfile = {
    name: p.name,
    headline: p.headline,
    location: p.location,
    seniority: p.seniority,
    yearsExperience: Number.isFinite(p.yearsExperience) ? p.yearsExperience : 0,
    coreStack: uniq(p.coreStack),
    skills: uniq(p.skills),
    certifications: uniq(p.certifications),
    languages: uniq(p.languages),
    targetRoles: uniq(p.preferences?.targetRoles?.length ? p.preferences.targetRoles : p.targetRoles),
    categories: p.preferences?.categories?.length ? p.preferences.categories : p.categories,
    summary: p.summary,
    cvMarkdown: p.cvMarkdown,
    portfolioNotes: p.portfolioNotes ?? '',
    projects: p.projects.map((x) => ({ name: x.name, description: x.description })),
    preferences: { ...DEFAULT_PREFERENCES, ...(p.preferences ?? {}) },
    learning: [],
    facts: [],
    repos: [],
  };
  if (!isMaster(p)) return base;
  base.learning = uniq(p.learning.filter((l) => l.status === 'learning').map((l) => l.skill)).sort((a, b) => a.localeCompare(b));
  base.facts = uniq(
    p.facts
      .filter((f) => f.active && f.source !== 'cv' && ['skill', 'project', 'certification', 'achievement', 'experience'].includes(f.kind))
      .map((f) => `${f.kind} (${f.source}): ${f.text.replace(/\s+/g, ' ').slice(0, 220)}`),
  )
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 40);
  base.repos = (p.github?.repos ?? [])
    .filter((r) => !r.fork)
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((r) => ({ name: r.name, description: r.description.slice(0, 200), languages: [...r.languages].slice(0, 5) }));
  return base;
}

/**
 * The master profile when A03's store is available, otherwise the v1 profile.
 * Returns null when the candidate has not uploaded a CV yet.
 */
export function loadMatchProfile(): MatchProfile | null {
  try {
    const master = loadMasterProfile();
    if (master) return toMatchProfile(master);
  } catch {
    // A03 not landed yet (NotImplemented) or its store is empty: use the v1 profile.
  }
  const v1 = loadProfile();
  return v1 ? toMatchProfile(v1) : null;
}

/** The candidate as the matcher's system prompt shows it. Stable bytes for a stable profile. */
export function renderProfile(p: MatchProfile): string {
  const prefs = p.preferences;
  const lines = [
    `# Candidate: ${p.name}`,
    `Headline: ${p.headline}`,
    `Location: ${p.location} | Seniority: ${p.seniority} | Years of professional experience: ${p.yearsExperience}`,
    `Core stack: ${p.coreStack.join(', ') || 'none listed'}`,
    `Other skills: ${p.skills.join(', ') || 'none listed'}`,
    `Certifications: ${p.certifications.join(', ') || 'none'}`,
    `Languages: ${p.languages.join(', ') || 'n/a'}`,
    '',
    '## Currently learning (count as partial with proof "currently learning", never as met)',
    p.learning.length ? p.learning.join(', ') : 'nothing listed',
    '',
    '## Logistics',
    `Target roles: ${p.targetRoles.join(', ') || 'not set'}`,
    `Disciplines: ${p.categories.join(', ') || 'not set'}`,
    `Locations: ${prefs.locations.join(', ') || 'not set'} | Remote only: ${prefs.remoteOnly} | Open to relocation: ${prefs.openToRelocation}`,
    `Needs visa sponsorship: ${prefs.needsSponsorship} | Work authorisation: ${prefs.workAuthorization || 'not stated'}`,
    `Salary floor: ${prefs.minSalary ? `${prefs.minSalary} ${prefs.currency} per year` : 'not set'}`,
    '',
    '## Summary',
    p.summary,
    '',
    '## Full CV (source of truth)',
    p.cvMarkdown,
  ];
  if (p.repos.length) {
    lines.push('', '## Public GitHub repositories');
    for (const r of p.repos) lines.push(`- ${r.name} [${r.languages.join(', ')}]: ${r.description}`);
  }
  if (p.facts.length) {
    lines.push('', '## Verified facts from other sources');
    for (const f of p.facts) lines.push(`- ${f}`);
  }
  if (p.portfolioNotes) lines.push('', '## Portfolio notes', p.portfolioNotes);
  return lines.join('\n');
}

/** Text the similarity pre-rank embeds for the candidate: core stack, target roles, top projects. */
export function profileEmbeddingText(p: MatchProfile, extraRoles: string[] = []): string {
  const roles = uniq([...extraRoles, ...p.targetRoles]);
  const projects = p.projects.slice(0, 4).map((x) => `${x.name}: ${x.description}`);
  return [
    p.headline,
    `Roles: ${roles.join(', ')}`,
    `Stack: ${[...p.coreStack, ...p.skills.slice(0, 12)].join(', ')}`,
    ...projects,
  ]
    .filter(Boolean)
    .join('\n');
}

/** For callers that already hold a v1 profile: prefer the master profile (it carries the learning list), else adapt the one given. */
export function matchProfileFrom(v1: Profile): MatchProfile {
  try {
    const master = loadMasterProfile();
    if (master) return toMatchProfile(master);
  } catch {
    // A03 not landed yet.
  }
  return toMatchProfile(v1);
}

import { get } from '../db.ts';
import type { Profile } from '../services/profileStore.ts';
import { reconcileFacts, type IncomingFact, type ReconcileResult } from './facts.ts';

/**
 * CV → facts. The CV is extracted once by Claude (task `profile`, whose rules
 * already demand a faithful transcription); here every bullet, skill, project,
 * degree and certificate of that extraction becomes one fact, copied as-is.
 * Deterministic, so re-syncing the same CV changes nothing and a new CV is a
 * clean diff: new lines added, vanished lines deactivated.
 */

function span(start: string, end: string) {
  return [start, end].filter(Boolean).join(' – ');
}

const HAS_NUMBER = /\d/;

export function factsFromProfile(p: Profile, cvRef: string): IncomingFact[] {
  const out: IncomingFact[] = [];
  const ref = (where: string) => `${cvRef}${where ? ` › ${where}` : ''}`;

  for (const s of [...p.coreStack, ...p.skills]) out.push({ kind: 'skill', text: s, sourceRef: ref('skills') });

  for (const e of p.experience) {
    const where = [e.role, e.company].filter(Boolean).join(' @ ');
    const ctx = `${e.role}@${e.company}`.toLowerCase();
    const loc = e.location ? `, ${e.location}` : '';
    const dates = span(e.start, e.end);
    out.push({ kind: 'experience', text: `${e.role} at ${e.company}${loc}${dates ? ` (${dates})` : ''}`, sourceRef: ref(where), context: ctx });
    for (const b of e.bullets) out.push({ kind: HAS_NUMBER.test(b) ? 'metric' : 'experience', text: b, sourceRef: ref(where), context: ctx });
  }

  for (const pr of p.projects) {
    const ctx = `project:${pr.name}`.toLowerCase();
    const where = `projects › ${pr.name}`;
    out.push({ kind: 'project', text: pr.description ? `${pr.name}: ${pr.description}` : pr.name, sourceRef: pr.link || ref(where), context: ctx });
    for (const h of pr.highlights) out.push({ kind: HAS_NUMBER.test(h) ? 'metric' : 'project', text: h, sourceRef: pr.link || ref(where), context: ctx });
    if (pr.link) out.push({ kind: 'link', text: `${pr.name}: ${pr.link}`, sourceRef: ref(where), context: ctx });
  }

  for (const ed of p.education) {
    const dates = span(ed.start, ed.end);
    const text = `${[ed.degree, ed.school].filter(Boolean).join(', ')}${dates ? ` (${dates})` : ''}`;
    out.push({ kind: 'education', text, sourceRef: ref('education') });
    if (ed.details) out.push({ kind: 'education', text: ed.details, sourceRef: ref('education'), context: `edu:${ed.school}`.toLowerCase() });
  }

  for (const c of p.certifications) out.push({ kind: 'certification', text: c, sourceRef: ref('certifications') });
  for (const a of p.achievements) out.push({ kind: HAS_NUMBER.test(a) ? 'metric' : 'achievement', text: a, sourceRef: ref('achievements') });
  for (const l of p.languages) out.push({ kind: 'other', text: `Language: ${l}`, sourceRef: ref('languages') });
  for (const l of p.links) out.push({ kind: 'link', text: `${l.label}: ${l.url}`, sourceRef: ref('links') });
  return out;
}

/** The name of the CV the current profile came from, for sources the owner can read. */
export function currentCvRef(): string {
  const doc = get<{ filename: string }>("SELECT filename FROM documents WHERE kind = 'cv' ORDER BY created_at DESC LIMIT 1");
  return `CV: ${doc?.filename ?? 'profile'}`;
}

/** Diff the current CV extraction into profile_facts. */
export function syncCvFacts(p: Profile, cvRef = currentCvRef()): ReconcileResult {
  return reconcileFacts('cv', factsFromProfile(p, cvRef));
}

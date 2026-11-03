/**
 * The writer's answers (A04 tasks evidence, write_cv, write_letter, critic,
 * answer_q, audit) for every e2e employer, one module per employer under
 * ./letters/. Each request is matched to its pipeline step from the prompt
 * itself, and critic verdicts are looked up by the exact letter text they
 * score, so a revised or edited letter never inherits an earlier draft's score.
 *
 * Steps that only run when an earlier answer was flawed (the humanizer on a
 * tell, the lint rewrite, the truth-lock rewrites) are deliberately not
 * answered: the fix belongs in the authored letter, not in a recording.
 */
import { contentText, type Answer, type DumpedRequest } from './index.ts';
import { APPLICATIONS } from './letters/index.ts';

export type Strategy = 'hook' | 'proof' | 'story';
export type Framing = 'direct' | 'transferable' | 'learning' | 'omit';

export interface Verdict {
  score: number;
  scores: { specificity: number; evidence: number; voice: number; clarity: number; ask: number; aiTells: number };
  demands: string[];
}

export interface Letter {
  strategy: Strategy;
  passagesUsed: string[];
  text: string;
  verdict: Verdict;
}

export interface Application {
  company: string;
  evidence: {
    priorities: string[];
    mustWins: string[];
    tone: string;
    seniority: string;
    hooks: { text: string; sourceUrl: string }[];
    items: { requirement: string; importance: 'critical' | 'important' | 'nice'; factIds: string[]; evidence: string; framing: Framing; phrasing: string }[];
    biggestGap: string | null;
    fastLearning: string | null;
  };
  cv: {
    headline: string;
    summary: string;
    skills: { group: string; items: string[] }[];
    /** Bullets per employer, most relevant first (employer, title and dates are pinned by code). */
    tessellate: string[];
    kestrel: string[];
    projects: { name: 'ledger-lite' | 'chai-check' | 'Bus Tracker Lahore'; description: string; highlights: string[] }[];
    emphasis: string[];
    keywordsUsed: string[];
  };
  letters: Letter[];
  subjects: string[];
  bestSubject: number;
  outreach: string;
  followUp: string;
  answers: { whyUs: string; whyRole: string; project: string };
  /**
   * Form questions the replica asks beyond the three pre-written ones (answer_q, step "answer"), as the
   * form labels them; the prompt's question must contain `question` (case and spacing ignored). `maxChars`
   * is the field's limit as the engine passes it (bench.ts uses it).
   */
formAnswers?: { question: string; answer: string; maxChars?: number }[];
  /** Revisions the critic's demands produced, by strategy (only for letters with demands). */
  revised?: Partial<Record<Strategy, Letter>>;
}

// ── Fixed candidate data (fixtures/profile), copied the way the CV prompt says ──

const CONTACT = {
  email: 'rania.haroon.jobs@example.com',
  phone: '+92 301 5550142',
  location: 'Lahore, Pakistan',
  links: [
    { label: 'GitHub', url: 'https://github.com/rania-haroon-example' },
    { label: 'Portfolio', url: 'https://rania-haroon.example.com' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/rania-haroon-example' },
  ],
};
const PROJECT_LINKS: Record<string, string> = {
  'ledger-lite': 'https://github.com/rania-haroon-example/ledger-lite',
  'chai-check': 'https://github.com/rania-haroon-example/chai-check',
  'Bus Tracker Lahore': 'https://rania-haroon.example.com/bus-tracker',
};

export function cvOutput(a: Application) {
  return {
    cv: {
      name: 'Rania Haroon',
      headline: a.cv.headline,
      contact: CONTACT,
      summary: a.cv.summary,
      skills: a.cv.skills,
      experience: [
        { role: 'Junior Software Engineer', company: 'Tessellate Labs', location: 'Lahore (hybrid)', start: 'Jul 2023', end: 'Present', bullets: a.cv.tessellate },
        { role: 'Software Engineering Intern', company: 'Kestrel Analytics', location: 'Lahore', start: 'Jun 2022', end: 'Sep 2022', bullets: a.cv.kestrel },
      ],
      projects: a.cv.projects.map((p) => ({ name: p.name, link: PROJECT_LINKS[p.name], description: p.description, highlights: p.highlights })),
      education: [
        {
          school: 'Lahore Institute of Computing',
          degree: 'Bachelor of Science, Computer Science',
          start: '2019',
          end: '2023',
          details: 'CGPA 3.4 / 4.0. Final-year project: offline-first attendance app for rural schools (React Native, SQLite).',
        },
      ],
      certifications: [],
    },
    emphasis: a.cv.emphasis,
    keywordsUsed: a.cv.keywordsUsed,
  };
}

export function lettersOutput(a: Application) {
  return {
    variants: a.letters.map((l) => ({ strategy: l.strategy, passagesUsed: l.passagesUsed, text: l.text })),
    subjects: a.subjects,
    outreach: a.outreach,
    followUp: a.followUp,
  };
}

export function answersOutput(a: Application) {
  return {
    answers: [
      { key: 'why us', answer: a.answers.whyUs },
      { key: 'why this role', answer: a.answers.whyRole },
      { key: 'tell us about a project', answer: a.answers.project },
    ],
  };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The critic scores exactly the letters in its prompt, each looked up by its text. */
export function criticOutput(a: Application, letters: { strategy: string; text: string }[]): { variants: unknown[]; bestSubject: number } | string {
  const out: unknown[] = [];
  for (const l of letters) {
    const known = [...a.letters, ...Object.values(a.revised ?? {})].find((x) => x && x.strategy === l.strategy && squash(x.text) === squash(l.text));
    if (!known) return `critic: no verdict for this ${l.strategy} letter text`;
    out.push({ strategy: l.strategy, score: known.verdict.score, scores: known.verdict.scores, demands: known.verdict.demands });
  }
  return { variants: out, bestSubject: a.bestSubject };
}

export function reviseOutput(a: Application, strategies: string[]): { variants: unknown[] } | string {
  const variants: unknown[] = [];
  for (const s of strategies) {
    const r = a.revised?.[s as Strategy];
    if (!r) return `revise: no revised ${s} letter`;
    variants.push({ strategy: r.strategy, passagesUsed: r.passagesUsed, text: r.text });
  }
  return { variants };
}

/** One free-text form question (answerQuestion); retries after a failed gate are never answered. */
const normQ = (s: string) => s.toLowerCase().replace(/[‹<>*]/g, ' ').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
export function formAnswerOutput(a: Application, text: string): { answer: string; option: string | null } | string {
  const q = text.match(/<form_question>([\s\S]*?)<\/form_question>/)?.[1]?.trim();
  if (!q) return 'answer: no <form_question> in the prompt';
  if (/Your previous answer failed these checks/.test(text)) return `answer_retry: the authored answer failed a gate ("${q.slice(0, 80)}")`;
  if (/^Options \(choose exactly one/m.test(text)) return `answer: options questions are not authored ("${q.slice(0, 80)}")`;
  const hit = a.formAnswers?.find((f) => normQ(q).includes(normQ(f.question)));
  if (!hit) return `answer: nothing authored for "${q.slice(0, 160)}"`;
  const limit = Number(text.match(/Length limit: (\d+) characters\./)?.[1] ?? 0);
  if (limit && hit.answer.length > limit) return `answer: authored answer is ${hit.answer.length} chars, limit ${limit} ("${q.slice(0, 80)}")`;
  return { answer: hit.answer, option: null };
}

/** The writer's step for a prompt, as the pipeline labels it. */
export function writerStep(task: string, text: string): string {
  switch (task) {
    case 'evidence':
      return 'evidence';
    case 'write_cv':
      return text.includes('<tailored_cv>') ? 'cv_fix' : 'cv';
    case 'write_letter':
      if (/Write the three variants/.test(text)) return 'letters';
      if (/Apply the demands/.test(text)) return 'revise';
      return 'truth_fix';
    case 'critic':
      return 'critic';
    case 'answer_q':
      return /Questions \(answer each; return key exactly as given\)/.test(text) ? 'short_answers' : 'answer';
    case 'audit':
      return 'audit';
    default:
      return task;
  }
}

/** One step's answer for one employer; a string explains why there is none. */
export function stepOutput(a: Application, step: string, text: string): unknown {
  switch (step) {
    case 'evidence':
      return a.evidence;
    case 'cv':
      return cvOutput(a);
    case 'letters':
      return lettersOutput(a);
    case 'revise':
      return reviseOutput(a, [...text.matchAll(/<variant strategy="([a-z]+)"/g)].map((m) => m[1]));
    case 'critic':
    case 'critic_rescore':
    case 'critic_final':
      return criticOutput(
        a,
        [...text.matchAll(/<letter strategy="([a-z]+)">\n([\s\S]*?)\n<\/letter>/g)].map((m) => ({ strategy: m[1], text: m[2] })),
      );
    case 'short_answers':
      return answersOutput(a);
    case 'answer':
      return formAnswerOutput(a, text);
    case 'audit':
    case 'audit_recheck':
      // Every authored text is checked against the facts before it is recorded (bench.ts): nothing to report.
      return { issues: [] };
    default:
      return `${step}: not answered (fix the authored texts so this step is not needed)`;
  }
}

export function writerAnswer(req: DumpedRequest): Answer {
  const text = contentText(req);
  const company = text.match(/^Company: (.+)$/m)?.[1]?.trim() ?? text.match(/^Target role: .+ at (.+)$/m)?.[1]?.trim();
  if (!company) return { skip: `${req.task}: no company in the prompt` };
  const a = APPLICATIONS[company];
  if (!a) return { skip: `${req.task}: nothing authored for ${company}` };
  // In the first round research is not recorded yet and the writer carries on without it; answering
  // that prompt would only leave a recording the finished pipeline never asks for.
  const step = writerStep(req.task, text);
  // A single form question (answerQuestion) never carries research: its hooks come from the saved evidence map.
  if (step !== 'answer' && text.includes('No company research is available')) return { skip: `${req.task}: ${company} has no research yet (next round)` };
  const out = stepOutput(a, step, text);
  if (typeof out === 'string') return { skip: `${out} (${company})` };
  return { label: `${step}: ${company}`, body: { output: out } };
}

import type { LearningItem, ProfileFact } from '../contracts/profile.ts';
import type { EvidenceMap, TruthResult } from '../contracts/writer.ts';
import type { Profile } from '../services/profileStore.ts';
import type { TailoredCv } from './cvSchema.ts';
import { escapeRe, hasTerm, NUMBER_WORDS, splitSentences } from './text.ts';

/**
 * The truth lock, code half (spec non-negotiable 3). The auditor (task
 * `audit`) is the other half; both must be clean. The only sources of truth
 * are the active profile facts and the learning list (plus the structured CV
 * the facts were synced from, for employers, titles and dates). The employer's
 * own posting and research brief may be *mentioned* ("your AWS stack"), never
 * claimed as the candidate's.
 *
 * What it catches (each a high-severity issue):
 * - a figure (digits or a number word with a unit) found in no fact
 * - years of experience above the profile's
 * - a CV employer not in the source CV, a changed or inflated title, changed dates
 * - a CV skill not in the facts; a learning-list skill listed as a skill (a gap skill)
 * - a "Currently learning" item not on the learning list
 * - a certification or degree not in the source
 * - a tool or technology named in prose as the candidate's own without a fact behind it
 * - a learning-list skill presented as experience (no learning framing in the sentence)
 * - scope inflation ("led", "managed", "architected"… when no fact says so)
 * - self-described seniority ("as a senior engineer") no source title supports
 * - an employer named in prose ("when I worked at X") that is not a source employer
 * - an evidence-map claim that cites no real fact
 */

export type CodeIssue = TruthResult['issues'][number];

export interface TruthSource {
  profile: Pick<Profile, 'name' | 'email' | 'phone' | 'yearsExperience' | 'experience' | 'education' | 'certifications'>;
  facts: ProfileFact[];
  learning: LearningItem[];
  targetCompany: string;
  /** The posting and research text: numbers and names in it are the employer's, so they may be mentioned. */
  employerText: string;
  /** Extra terms the posting asks for (matcher atsKeywords): watched in prose like the lexicon. */
  watchTerms?: string[];
}

export interface TruthInput {
  cv?: TailoredCv | null;
  texts: { label: string; text: string }[];
  evidence?: EvidenceMap | null;
}

export const LEARNING_GROUP = /^(currently learning|learning now|learning|in progress)$/i;

/** True synonyms only. Never maps one tool onto another (GCP is not AWS). */
const ALIASES: string[][] = [
  ['postgresql', 'postgres', 'psql'],
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['node.js', 'nodejs'],
  ['kubernetes', 'k8s'],
  ['google cloud', 'gcp', 'google cloud platform'],
  ['amazon web services', 'aws'],
  ['react', 'react.js', 'reactjs'],
  ['vue', 'vue.js', 'vuejs'],
  ['next.js', 'nextjs'],
  ['express', 'express.js'],
  ['go', 'golang'],
  ['mongodb', 'mongo'],
  ['ci/cd', 'ci-cd', 'cicd', 'continuous integration'],
  ['rest api', 'rest apis', 'restful', 'restful apis', 'restful api'],
  ['c#', 'csharp'],
  ['c++', 'cpp'],
  ['.net', 'dotnet'],
  ['github actions', 'gh actions'],
  ['scikit-learn', 'sklearn'],
  ['machine learning', 'ml'],
];

export function aliasesOf(term: string): string[] {
  const t = term.trim().toLowerCase();
  const group = ALIASES.find((g) => g.includes(t));
  return group ? group : [t];
}

/** Words that are also ordinary English: matched case-sensitively. */
const CASE_SENSITIVE = new Set(['Go', 'Swift', 'Express', 'Flask', 'Spring', 'Rails', 'Lambda', 'Rust', 'Dart', 'Unity', 'Spark', 'Git', 'Jest', 'Make', 'Chef', 'Puppet', 'Salt', 'Helm', 'Ruby', 'Scala', 'Elixir', 'Mocha', 'Vite', 'Prisma', 'Celery', 'Airflow', 'Stripe']);

/** Tools and technologies a letter might claim. Watched in prose; the posting's keywords are added per job. */
export const TECH_LEXICON = [
  'Python', 'JavaScript', 'TypeScript', 'Java', 'Kotlin', 'Swift', 'Go', 'Golang', 'Rust', 'C++', 'C#', 'Ruby', 'PHP', 'Scala', 'Elixir', 'Haskell', 'Dart', 'Solidity', 'Lua', 'Perl', 'Objective-C', 'Clojure',
  'React', 'React Native', 'Next.js', 'Vue', 'Nuxt', 'Angular', 'Svelte', 'Redux', 'Tailwind', 'jQuery', 'Flutter', 'SwiftUI', 'Jetpack Compose', 'Electron', 'Webpack', 'Vite',
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Rails', 'Ruby on Rails', 'Laravel', 'ASP.NET', '.NET', 'gRPC', 'GraphQL', 'Kafka', 'RabbitMQ', 'Celery',
  'Redis', 'PostgreSQL', 'Postgres', 'MySQL', 'MongoDB', 'SQLite', 'DynamoDB', 'Cassandra', 'Elasticsearch', 'Snowflake', 'BigQuery', 'Firebase', 'Supabase', 'Prisma', 'sqlc',
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Helm', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'Prometheus', 'Grafana', 'Datadog', 'OpenTelemetry', 'Nginx', 'Lambda', 'EC2', 'S3', 'CloudFormation', 'Pulumi', 'ArgoCD', 'Istio', 'Vercel', 'Heroku',
  'Pandas', 'NumPy', 'PyTorch', 'TensorFlow', 'scikit-learn', 'Spark', 'Airflow', 'dbt', 'Hadoop', 'Tableau', 'Power BI', 'LangChain', 'OpenCV', 'Keras',
  'Burp Suite', 'Metasploit', 'Wireshark', 'Nmap', 'Splunk',
  'Jest', 'Cypress', 'Playwright', 'Selenium', 'pytest', 'JUnit', 'Vitest',
  'Unity', 'Unreal', 'Stripe', 'Shopify', 'WordPress', 'Salesforce',
];

function termRe(term: string): RegExp {
  const flags = CASE_SENSITIVE.has(term) ? 'g' : 'gi';
  return new RegExp(`(?<![A-Za-z0-9.])${escapeRe(term)}(?![A-Za-z0-9+#])`, flags);
}

function mentions(text: string, term: string): boolean {
  return termRe(term).test(text);
}

/** Is the skill backed by an active fact (the term or a true synonym, whole-term)? */
export function factBacks(term: string, factText: string): boolean {
  const t = term.trim();
  if (CASE_SENSITIVE.has(t) ? mentions(factText, t) : hasTerm(factText, t)) return true;
  return aliasesOf(t)
    .filter((a) => a !== t.toLowerCase())
    .some((a) => {
      const cs = [...CASE_SENSITIVE].find((c) => c.toLowerCase() === a);
      return cs ? mentions(factText, cs) : hasTerm(factText, a);
    });
}

function learningNow(src: TruthSource): LearningItem[] {
  return src.learning.filter((l) => l.status === 'learning');
}

function onLearningList(term: string, src: TruthSource): boolean {
  const t = aliasesOf(term);
  return learningNow(src).some((l) => aliasesOf(l.skill).some((a) => t.includes(a)));
}

// ── Figures ──────────────────────────────────────────────────────────────────

const FIGURE = /(?<![A-Za-z0-9.])(?:[$€£₨]\s?)?(\d[\d,]*(?:\.\d+)?)(?:\s?(?:%|percent)|([kKmMxX])(?![A-Za-z]))?(?![A-Za-z0-9])/g;
const UNIT_NOUN =
  /^(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?|people|users?|customers?|clients?|engineers?|developers?|teams?|projects?|services?|apps?|shops?|stores?|branches?|countries|cities|languages?|times|percent|requests?|transactions?|entries|orders?|students?|repos?|releases?|deployments?|servers?|sites?|pages?|products?|companies|members?|interns?|reports?)$/i;

function normNum(raw: string, unit?: string): string[] {
  const n = raw.replace(/,/g, '').replace(/\.0+$/, '');
  const out = [n];
  const u = unit?.toLowerCase();
  const v = Number(n);
  if (u === 'k' && Number.isFinite(v)) out.push(String(v * 1000));
  if (u === 'm' && Number.isFinite(v)) out.push(String(v * 1_000_000));
  return out;
}

export function figuresIn(text: string): { raw: string; values: string[] }[] {
  const out: { raw: string; values: string[] }[] = [];
  for (const m of text.matchAll(FIGURE)) out.push({ raw: m[0].trim(), values: normNum(m[1], m[2]) });
  for (const m of text.matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand)[\s-]+([A-Za-z]+)/gi)) {
    if (UNIT_NOUN.test(m[2])) out.push({ raw: m[0], values: [String(NUMBER_WORDS[m[1].toLowerCase()])] });
  }
  return out;
}

function numberSet(text: string): Set<string> {
  const s = new Set<string>();
  for (const f of figuresIn(text)) for (const v of f.values) s.add(v);
  // "10,000" in a source also backs "10k".
  for (const v of [...s]) {
    const x = Number(v);
    if (Number.isFinite(x) && x >= 1000 && x % 1000 === 0) s.add(String(x / 1000));
  }
  return s;
}

const YEARS_CLAIM =
  /(\d+(?:\.\d+)?|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\+?\s*(?:years?|yrs?)(?:['’])?\s+(?:of\s+)?(?:[a-z][a-z/-]*\s+){0,3}?(?:experience|exp\b)/gi;

// ── Scope and seniority ──────────────────────────────────────────────────────

const SCOPE_VERBS: { re: RegExp; stem: RegExp; label: string }[] = [
  { re: /\b(?:led|leading|lead)\b(?!\s+(?:to|by|in)\b)(?=\s+(?:a|an|the|our|my|two|three|four|five|\d|development|engineering|design|work|efforts?|teams?|projects?|migration|rollout)\b)/gi, stem: /\b(?:led|lead|leading|leads)\b/i, label: 'led' },
  { re: /\bmanag(?:ed|ing|es)\b(?!\s+to\b)(?=\s+(?:a|an|the|our|my|\d|two|three|four|five|teams?|engineers?|developers?|people|staff|interns?)\b)/gi, stem: /\bmanag(?:ed|ing|e|es|er)\b/i, label: 'managed' },
  { re: /\bhead(?:ed|ing)\b/gi, stem: /\bhead(?:ed|ing)?\b/i, label: 'headed' },
  { re: /\bspearhead(?:ed|ing|s)?\b/gi, stem: /\bspearhead/i, label: 'spearheaded' },
  { re: /\b(?:oversaw|oversee|overseeing)\b/gi, stem: /\b(?:oversaw|oversee|overseeing|oversight)\b/i, label: 'oversaw' },
  { re: /\bsupervis(?:ed|ing)\b/gi, stem: /\bsupervis/i, label: 'supervised' },
  { re: /\bdirected\b/gi, stem: /\bdirect(?:ed|or)\b/i, label: 'directed' },
  { re: /\barchitect(?:ed|ing)\b/gi, stem: /\barchitect/i, label: 'architected' },
];

const SENIOR_SELF = /\b(?:as an?|i(?:'m|’m| am) an?|i was an?|worked as an?|my role as an?)\s+(senior|lead|principal|staff|chief|head)\b/gi;

const EMPLOYMENT_CUE = /\b(?:worked|working|interned|internship|employed|my (?:job|role|time|years?)|joined|was hired|i was (?:a|an) [a-z ]{0,30}(?:at|for)|on the [A-Za-z ]{1,30} team at)\b/i;
const EMPLOYER_AFTER = /\b(?:at|for|with|joined)\s+([A-Z][\w&.'’-]*(?:\s+(?:[A-Z][\w&.'’-]*|&|of))*)/g;

const EMPLOYER_ATTRIBUTION = /\b(?:your|you|you're|you’re|yours|the team|this role|the role|the posting|the job|the listing|the ad|you've|you’ve)\b/i;
const LEARNING_CUE = /\b(?:learning|learn|currently|picking up|studying|course|tutorial|building [^.]{0,40}\bin\b|working through|new to|getting into|teaching myself|started|haven't|have not|not yet|no professional|never used)\b/i;
const GAP_CUE = /\b(?:haven't|have not|not yet|new to|no professional|never used|don't have|do not have|gap)\b/i;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPANY_NOISE = /\b(inc|ltd|llc|limited|pvt|private|co|corp|gmbh|plc)\b\.?/g;
function sameCompany(a: string, b: string): boolean {
  const x = norm(a).replace(COMPANY_NOISE, '').trim();
  const y = norm(b).replace(COMPANY_NOISE, '').trim();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

function normDate(s: string): string {
  return norm(s).replace(/\bpresent|current|now|today\b/, 'present');
}

/** Title inflation: the CV title may drop words from the source title but never add any. */
export function titleInflation(cvTitle: string, sourceTitle: string): string[] {
  const src = new Set(norm(sourceTitle).split(' '));
  const ignorable = new Set(['and', 'of', 'the', '&', '-', '/']);
  return norm(cvTitle)
    .split(' ')
    .filter((w) => w && !src.has(w) && !ignorable.has(w));
}

// ── The check ────────────────────────────────────────────────────────────────

export function codeTruth(input: TruthInput, src: TruthSource): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const add = (claim: string, reason: string, severity: CodeIssue['severity'] = 'high') => {
    if (!issues.some((i) => i.claim === claim && i.reason === reason)) issues.push({ claim, reason, severity, origin: 'code' });
  };
  const factText = src.facts.map((f) => f.text).join('\n');
  const learningText = learningNow(src)
    .map((l) => `${l.skill} ${l.notes}`)
    .join('\n');
  const profileDates = [...src.profile.experience.flatMap((e) => [e.start, e.end]), ...src.profile.education.flatMap((e) => [e.start, e.end]), String(src.profile.yearsExperience)].join(' ');
  const candidateNumbers = numberSet(`${factText}\n${learningText}\n${profileDates}`);
  const employerNumbers = numberSet(src.employerText);
  const sourceTitles = src.profile.experience.map((e) => e.role).join(' ');
  const cv = input.cv ?? null;

  // Prose: everything a reader sees as running text.
  const prose: { label: string; text: string }[] = [...input.texts];
  if (cv) {
    prose.push({ label: 'CV summary', text: cv.summary });
    prose.push({ label: 'CV headline', text: cv.headline });
    cv.experience.forEach((e) => e.bullets.forEach((b) => prose.push({ label: `CV ${e.company}`, text: b })));
    cv.projects.forEach((p) => [p.description, ...p.highlights].forEach((t) => prose.push({ label: `CV ${p.name}`, text: t })));
  }

  // 1. Figures.
  for (const { label, text } of prose) {
    for (const f of figuresIn(text)) {
      const core = f.values[0];
      if (/^(19|20)\d\d$/.test(core)) continue; // a year: dates are checked on the CV entries
      if (f.values.some((v) => candidateNumbers.has(v))) continue;
      if (f.values.some((v) => employerNumbers.has(v))) {
        // The employer's number may be mentioned, never claimed as the candidate's result.
        const sentence = splitSentences(text).find((s) => s.includes(f.raw)) ?? text;
        if (EMPLOYER_ATTRIBUTION.test(sentence) || hasTerm(sentence, src.targetCompany)) continue;
      }
      add(f.raw, `${label}: this figure is not in any of your profile facts.`);
    }
  }

  // 2. Years of experience.
  for (const { label, text } of prose) {
    for (const m of text.matchAll(YEARS_CLAIM)) {
      const v = Number(m[1]) || NUMBER_WORDS[m[1].toLowerCase()] || 0;
      if (v > src.profile.yearsExperience + 0.01) add(m[0], `${label}: claims ${v} years of experience; your profile has ${src.profile.yearsExperience}.`);
    }
  }

  // 3. Scope inflation and self-described seniority.
  for (const { label, text } of prose) {
    for (const v of SCOPE_VERBS) {
      v.re.lastIndex = 0;
      const m = v.re.exec(text);
      if (m && !v.stem.test(factText)) add(m[0], `${label}: "${v.label}" overstates your scope; no profile fact says you ${v.label} anything.`);
    }
    for (const m of text.matchAll(SENIOR_SELF)) {
      if (!new RegExp(`\\b${m[1]}\\b`, 'i').test(sourceTitles)) add(m[0], `${label}: none of your titles is ${m[1]}.`);
    }
  }

  // 4. Employers named in prose.
  const knownOrgs = [...src.profile.experience.map((e) => e.company), ...src.profile.education.map((e) => e.school), src.targetCompany].filter(Boolean);
  for (const { label, text } of prose) {
    for (const s of splitSentences(text)) {
      // An honest gap ("I haven't worked with CRDTs") names no employer.
      if (!EMPLOYMENT_CUE.test(s) || GAP_CUE.test(s)) continue;
      for (const m of s.matchAll(EMPLOYER_AFTER)) {
        const org = m[1]
          .replace(/(?:\s+(?:I|We|My|Our|And|But|So|Then))+$/, '')
          .replace(/['’]s$/, '')
          .trim();
        if (org.length < 2 || /^(I|The|A|An|My|Our|Your|Present|Now)$/.test(org)) continue;
        if (knownOrgs.some((k) => sameCompany(k, org))) continue;
        if (hasTerm(factText, org)) continue;
        // "worked with Postgres" is a tool claim; rule 5 checks it against the facts.
        if (m[0].toLowerCase().startsWith('with') && TECH_LEXICON.some((t) => t.toLowerCase() === org.toLowerCase())) continue;
        add(m[0], `${label}: "${org}" is not an employer in your profile.`);
      }
    }
  }

  // 5. Tools and technologies claimed in prose.
  const watch = new Set<string>(TECH_LEXICON);
  for (const t of src.watchTerms ?? []) if (/[A-Z0-9.+#]/.test(t) && t.length <= 30) watch.add(t);
  for (const l of learningNow(src)) watch.add(l.skill);
  for (const { label, text } of prose) {
    for (const term of watch) {
      if (!mentions(text, term)) continue;
      if (factBacks(term, factText)) continue;
      const sentences = splitSentences(text).filter((s) => mentions(s, term));
      for (const s of sentences) {
        const learning = onLearningList(term, src);
        if (learning && LEARNING_CUE.test(s)) continue;
        if (GAP_CUE.test(s)) continue;
        if (EMPLOYER_ATTRIBUTION.test(s) || hasTerm(s, src.targetCompany)) {
          // Naming their stack is fine unless the same sentence claims it ("I've used your AWS…").
          if (!new RegExp(`\\b(?:I|I've|I’ve|I have|my)\\b[^.]{0,40}\\b(?:used|built|shipped|deployed|run|ran|worked)\\b[^.]{0,30}${escapeRe(term)}`, 'i').test(s)) continue;
        }
        add(term, learning ? `${label}: presents ${term} as experience, but it is on your learning list (say you are learning it).` : `${label}: claims ${term}, which is in none of your profile facts.`);
        break;
      }
    }
  }

  // 6. The CV's structure.
  if (cv) {
    for (const e of cv.experience) {
      const source = src.profile.experience.find((s) => sameCompany(s.company, e.company));
      if (!source) {
        add(`${e.role} at ${e.company}`, 'This employer is not in your source CV.');
        continue;
      }
      const added = titleInflation(e.role, source.role);
      if (added.length) add(`${e.role} at ${e.company}`, `Title differs from your CV ("${source.role}"): adds ${added.join(', ')}.`);
      if (normDate(e.start) !== normDate(source.start) || normDate(e.end) !== normDate(source.end)) {
        add(`${e.company}: ${e.start} – ${e.end}`, `Dates differ from your CV (${source.start} – ${source.end}).`);
      }
    }
    for (const g of cv.skills) {
      const isLearning = LEARNING_GROUP.test(g.group.trim());
      for (const item of g.items) {
        if (isLearning) {
          if (!onLearningList(item, src)) add(item, `"Currently learning" lists ${item}, which is not on your learning list.`);
          continue;
        }
        if (factBacks(item, factText)) continue;
        if (onLearningList(item, src)) add(item, `${item} is a gap skill (on your learning list): it may only appear under "Currently learning".`);
        else add(item, `Skill ${item} is in none of your profile facts.`);
      }
    }
    const certSource = [...src.profile.certifications, ...src.facts.filter((f) => f.kind === 'certification').map((f) => f.text)];
    for (const c of cv.certifications) {
      if (!certSource.some((s) => norm(s).includes(norm(c)) || norm(c).includes(norm(s)))) add(c, 'This certification is not in your profile.');
    }
    for (const ed of cv.education) {
      const ok = src.profile.education.some((s) => sameCompany(s.school, ed.school) && (norm(s.degree).includes(norm(ed.degree)) || norm(ed.degree).includes(norm(s.degree))));
      if (!ok) add(`${ed.degree}, ${ed.school}`, 'This degree is not in your source CV.');
    }
    if (cv.contact.email && src.profile.email && cv.contact.email.trim().toLowerCase() !== src.profile.email.trim().toLowerCase()) add(cv.contact.email, 'Email differs from your profile.', 'medium');
    if (cv.name.trim() && norm(cv.name) !== norm(src.profile.name)) add(cv.name, 'Name differs from your profile.');
  }

  // 7. The evidence map: every direct or transferable claim cites a real fact; learning only from the list.
  if (input.evidence) {
    const ids = new Set(src.facts.map((f) => f.id));
    const learningIds = new Set(learningNow(src).map((l) => l.id));
    for (const it of input.evidence.items) {
      if (it.framing === 'direct' || it.framing === 'transferable') {
        const real = it.factIds.filter((id) => ids.has(id));
        if (!real.length) add(it.requirement, `Evidence map: the ${it.framing} claim cites no profile fact.`);
      } else if (it.framing === 'learning') {
        const ok = it.factIds.some((id) => learningIds.has(id)) || onLearningList(it.requirement, src) || learningNow(src).some((l) => hasTerm(it.requirement, l.skill));
        if (!ok) add(it.requirement, 'Evidence map: framed as learning, but it is not on your learning list.');
      }
    }
  }

  return issues;
}

export function truthResult(issues: CodeIssue[]): TruthResult {
  return { pass: !issues.some((i) => i.severity === 'high'), issues };
}

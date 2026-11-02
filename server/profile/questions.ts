/**
 * Question normalisation for the answer bank: the same question arrives in a
 * hundred wordings ("notice period", "when can you start", "earliest start
 * date *"). We clean the text, detect a known intent with its slot (the skill
 * in "years of React experience", the currency in "expected salary (PKR)", the
 * country in "right to work in the UK"), and fall back to cleaned words for
 * everything else.
 */

export type IntentKey =
  | 'sponsorship'
  | 'work_authorization'
  | 'tz_overlap'
  | 'timezone'
  | 'start_date'
  | 'expected_salary'
  | 'current_salary'
  | 'relocation'
  | 'onsite_hybrid'
  | 'remote'
  | 'previously_employed'
  | 'years_experience'
  | 'has_experience'
  | 'degree_completion'
  | 'highest_education'
  | 'referral_source'
  | 'referred_by_employee'
  | 'linkedin'
  | 'github'
  | 'portfolio'
  | 'age_18'
  | 'background_check'
  | 'travel'
  | 'languages'
  | 'current_location'
  | 'drivers_licence'
  | 'contract_work'
  | 'noncompete'
  | 'full_time'
  | 'security_clearance'
  | 'shifts'
  | 'full_name'
  | 'email'
  | 'phone';

export interface Intent {
  key: IntentKey;
  /** Normalised question text for this intent (plus its slot). */
  canonical: string;
  skill?: string;
  currency?: string;
  countries?: string[];
}

interface IntentDef {
  key: IntentKey;
  canonical: string;
  re: RegExp[];
  not?: RegExp;
  slot?: 'skill' | 'currency' | 'country';
}

const SKILL_TAIL = '(.+?)';

const DEFS: IntentDef[] = [
  { key: 'sponsorship', canonical: 'visa sponsorship', slot: 'country', re: [/sponsor/, /\b(require|need)\b.*\bvisa\b/, /\bh-?1-?b\b/, /\bvisa (support|assistance)\b/] },
  {
    key: 'work_authorization',
    canonical: 'work authorization',
    slot: 'country',
    re: [/\b(authori[sz]ed|eligible|entitled|permitted|allowed|legally able|legal right)\b.*\bwork\b/, /\bright to work\b/, /\bwork (permit|authori[sz]ation|eligibility|visa)\b/, /\b(work legally|legally work)\b/],
  },
  {
    key: 'tz_overlap',
    canonical: 'time zone overlap',
    re: [/\boverlap\b/, /\b(est|edt|pst|pdt|cst|cet|gmt|utc|eastern|pacific|central european)\b.*\b(hours|time)\b.*\b(work|available|availability)\b/, /\b(work|available)\b.*\b(est|pst|cet|gmt|utc|eastern|pacific)\b (business |working )?hours\b/],
  },
  { key: 'timezone', canonical: 'time zone', re: [/\btime ?zone\b/] },
  {
    key: 'start_date',
    canonical: 'start date',
    re: [
      /\bnotice period\b/,
      /\bwhen (can|could|would|will) you (start|join|begin|commence)\b/,
      /\b(earliest|soonest)\b.*\b(start|join|begin|joining|commence)\b/,
      /\b(earliest|soonest) (possible )?(date|availability)\b/,
      /\bstart(ing)? date\b/,
      /\bjoining date\b/,
      /\bhow soon\b.*\b(start|join|begin)\b/,
      /\bavailab(le|ility) to (start|join|begin)\b/,
      /\bdate (of )?availability\b/,
    ],
  },
  {
    key: 'expected_salary',
    canonical: 'expected salary',
    slot: 'currency',
    re: [
      /\b(salary|compensation|pay|ctc|remuneration|rate|wage)\b.*\b(expect\w*|desired?|requirements?|range|target|looking for)\b/,
      /\b(expect\w*|desired?|target|required|asking)\b.*\b(salary|compensation|pay|ctc|remuneration|rate|wage)\b/,
    ],
  },
  { key: 'current_salary', canonical: 'current salary', slot: 'currency', re: [/\b(current|present|last|most recent)\b.*\b(salary|compensation|ctc|pay|wage)\b/] },
  { key: 'relocation', canonical: 'relocation', re: [/\breloca/, /\b(willing|open|able) to move\b/] },
  {
    key: 'onsite_hybrid',
    canonical: 'onsite or hybrid work',
    re: [/\bon-?site\b/, /\bin[- ]office\b/, /\b(from|in|at|to) (the|our) office\b/, /\bhybrid\b/, /\bin[- ]person\b/, /\bcommute\b/],
  },
  { key: 'remote', canonical: 'remote work', re: [/\b(work(ing)?|job|role|position)\b.*\bremote(ly)?\b/, /\bremote(ly)?\b.*\b(work|working|setup|environment)\b/] },
  {
    key: 'previously_employed',
    canonical: 'previously employed here',
    re: [
      /\b(previously|ever|before|formerly)\b.*\b(work(ed)?|employed)\b.*\b(for|at|by)\b/,
      /\bformer(ly)? (an )?employee\b/,
      /\bworked (for|at) (us|this company|the company|our company)\b/,
    ],
  },
  {
    key: 'years_experience',
    canonical: 'years of experience',
    slot: 'skill',
    re: [
      new RegExp(`\\byears? (?:of )?(?:professional |relevant |hands-on |commercial |total |work |working |industry |practical )*(?:experience|exp)\\b(?: do you have)?(?: (?:with|in|using|of|working with|on) ${SKILL_TAIL})?(?: do you have)?$`),
      new RegExp(`\\bhow (?:long|many years) have you (?:been )?(?:worked|working|used|using|programmed|programming|coded|coding|developed|developing|written|writing)(?: with| in)? ${SKILL_TAIL}$`),
      new RegExp(`^(?:how many )?years (?:of )?${SKILL_TAIL} (?:experience|exp)(?: do you have)?$`),
      new RegExp(`^${SKILL_TAIL} experience (?:in )?years$`),
    ],
  },
  {
    key: 'has_experience',
    canonical: 'has experience with',
    slot: 'skill',
    re: [
      new RegExp(`\\b(?:do you have|have you (?:got|had)) (?:any )?(?:professional |prior |hands-on |previous |commercial |practical |production )*(?:experience|exposure) (?:with|in|using|of|working with|on) ${SKILL_TAIL}$`),
      new RegExp(`\\bhave you (?:ever )?(?:worked with|used|built with|shipped with) ${SKILL_TAIL}(?: before| professionally| in production)?$`),
    ],
  },
  {
    key: 'degree_completion',
    canonical: 'degree completion date',
    re: [
      /\bgraduat\w*\b.*\b(date|when|year)\b/,
      /\b(when|date|year)\b.*\bgraduat\w*/,
      /\b(complete|completed|finish|finished|completion)\b.*\b(degree|studies|studying|education|program|programme|bachelor|master)/,
      /\bexpected graduation\b/,
    ],
  },
  { key: 'highest_education', canonical: 'highest education', re: [/\bhighest\b.*\b(education|degree|qualification|level of study)\b/, /\b(level of|education) (education|level)\b/] },
  {
    key: 'referral_source',
    canonical: 'how did you hear about us',
    re: [
      /\bhow did you (first )?(hear|find|learn|come across|discover|get to know|know about)\b/,
      /\bwhere did you (first )?(hear|find|see|learn|come across|discover)\b/,
      /\b(referral|application|candidate|lead) source\b/,
      /\bsource of (this |your )?(application|referral)\b/,
    ],
  },
  {
    key: 'referred_by_employee',
    canonical: 'referred by an employee',
    re: [/\b(were|have) you (been )?referred\b/, /\breferred by\b/, /\bemployee referral\b/, /\bknow (anyone|someone|somebody) (who works|at|working)\b/, /\breferr(er|ing employee)\b/],
  },
  { key: 'linkedin', canonical: 'linkedin profile', re: [/\blinkedin\b/] },
  { key: 'github', canonical: 'github profile', re: [/\bgithub\b/] },
  { key: 'portfolio', canonical: 'portfolio', re: [/\bportfolio\b/, /\bpersonal (web ?)?site\b/, /\b(your|personal) (web ?site|homepage|home page|blog)\b/] },
  { key: 'age_18', canonical: 'at least 18', re: [/\b(at least|over|above|older than) (18|eighteen)\b/, /\b18 (years|yrs)\b/, /\blegal (working )?age\b/] },
  { key: 'background_check', canonical: 'background check', re: [/\bbackground (check|screening|verification|investigation)\b/] },
  { key: 'travel', canonical: 'willing to travel', re: [/\b(willing|able|open|available|comfortable) (to |with )?travel/, /\btravel (up to|requirements?|percentage|\d+)\b/] },
  {
    key: 'languages',
    canonical: 'spoken languages',
    not: /\bprogramming|coding|scripting|software\b/,
    re: [/\bwhat languages\b/, /\blanguages? (do you )?(speak|know)\b/, /\b(spoken|written) languages?\b/, /\b(english|language) (proficiency|level|fluency)\b/, /\bproficien\w* in english\b/, /\bfluent\b/, /\bspeak english\b/],
  },
  {
    key: 'current_location',
    canonical: 'current location',
    re: [/\bwhere are you (currently )?(located|based|living)\b/, /\bcurrent (location|city|country)\b/, /\b(city|country) (and country )?of residence\b/, /\bwhere do you (currently )?live\b/],
  },
  { key: 'drivers_licence', canonical: 'driving licence', re: [/\bdriv(ers?|ing) licen[cs]e\b/] },
  {
    key: 'contract_work',
    canonical: 'contract or freelance work',
    re: [/\b(contract|freelance|contractor|temporary|fixed-term)\b.*\b(role|position|basis|work|engagement|opportunit)/, /\bopen to (contract|freelance)\b/],
  },
  { key: 'noncompete', canonical: 'non-compete', re: [/\bnon-?compete\b/, /\brestrictive covenants?\b/, /\bnon-?solicit/] },
  { key: 'full_time', canonical: 'full time availability', re: [/\bfull-?time\b/, /\bhours (per|a) week\b/] },
  { key: 'security_clearance', canonical: 'security clearance', re: [/\bclearance\b/] },
  { key: 'shifts', canonical: 'weekends or shifts', re: [/\b(weekends?|night shifts?|shift work|shifts|on-?call|overtime)\b/] },
  { key: 'full_name', canonical: 'full name', re: [/^(your )?(full |legal |complete )?name$/, /\b(full|legal|first and last) name\b/] },
  { key: 'email', canonical: 'email', re: [/^(your )?e-?mail( address)?$/, /\bwhat is your e-?mail\b/] },
  { key: 'phone', canonical: 'phone', re: [/^(your )?(phone|mobile|telephone|cell)( number| no)?$/, /\bwhat is your (phone|mobile|telephone) (number)?\b/] },
];

/** Pairs that mean opposite things when they co-occur ("authorised to work without sponsorship?"): too risky to guess. */
const CONFLICTS: [IntentKey, IntentKey][] = [
  ['sponsorship', 'work_authorization'],
  ['expected_salary', 'current_salary'],
];

const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\bwhat's\b/g, 'what is'],
  [/\bwhere's\b/g, 'where is'],
  [/\bit's\b/g, 'it is'],
  [/\bthat's\b/g, 'that is'],
  [/\b(\w+)'re\b/g, '$1 are'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(\w+)'d\b/g, '$1 would'],
  [/\bi'm\b/g, 'i am'],
];

/** Lowercase, expand contractions, drop asterisks / "(required)" / punctuation. Keeps c++, c#, node.js, h-1b. */
export function cleanQuestion(q: string): string {
  let s = q.normalize('NFKC').toLowerCase().replace(/[‘’`´]/g, "'").replace(/[‐-―−]/g, '-');
  s = s.replace(/\((?:required|optional|mandatory|if applicable)\)|\*|\brequired\s*$/g, ' ');
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  s = s.replace(/'/g, '');
  s = s.replace(/[^a-z0-9+#.\s-]/g, ' ');
  s = s.replace(/(?<![a-z0-9])[.-]+|[.-]+(?![a-z0-9])/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// ── Slots ────────────────────────────────────────────────────────────────────

const SKILL_ALIASES: Record<string, string> = {
  'react.js': 'react',
  reactjs: 'react',
  'react js': 'react',
  'node.js': 'node',
  nodejs: 'node',
  'node js': 'node',
  'vue.js': 'vue',
  vuejs: 'vue',
  'next.js': 'nextjs',
  'nest.js': 'nestjs',
  'express.js': 'express',
  expressjs: 'express',
  'angular.js': 'angular',
  angularjs: 'angular',
  golang: 'go',
  ts: 'typescript',
  js: 'javascript',
  ecmascript: 'javascript',
  py: 'python',
  python3: 'python',
  k8s: 'kubernetes',
  postgres: 'postgresql',
  psql: 'postgresql',
  mongo: 'mongodb',
  'amazon web services': 'aws',
  'google cloud': 'gcp',
  'google cloud platform': 'gcp',
  'microsoft azure': 'azure',
  'c sharp': 'c#',
  csharp: 'c#',
  cpp: 'c++',
  'machine learning': 'ml',
  'artificial intelligence': 'ai',
  'ci cd': 'ci/cd',
  cicd: 'ci/cd',
  'react native': 'react native',
  tf: 'terraform',
};

const SKILL_NOISE = /\b(the|a|an|programming|programming language|language|languages|development|developing|framework|library|technologies|technology|stack|professionally|professional|commercially|in production|before|platform|tools?)\b/g;

export function normalizeSkill(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/\b(do you have|have you|so far|in total|total)\b/g, ' ')
    .replace(SKILL_NOISE, ' ')
    .replace(/[^a-z0-9+#./ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[./]+$/, '');
  return SKILL_ALIASES[s] ?? SKILL_ALIASES[s.replace(/\s/g, '')] ?? s;
}

const CURRENCIES: [RegExp, string][] = [
  [/\busd\b|\bus ?dollars?\b|\$|\bdollars?\b/, 'USD'],
  [/\beur\b|\beuros?\b|€/, 'EUR'],
  [/\bgbp\b|\bpounds?( sterling)?\b|£/, 'GBP'],
  [/\bpkr\b|\bpakistani rupees?\b|\brs\.?\s?\d/, 'PKR'],
  [/\binr\b|\bindian rupees?\b|₹/, 'INR'],
  [/\baed\b|\bdirhams?\b/, 'AED'],
  [/\bsar\b|\bsaudi riyals?\b/, 'SAR'],
  [/\bqar\b|\bqatari riyals?\b/, 'QAR'],
  [/\bcad\b|\bcanadian dollars?\b/, 'CAD'],
  [/\baud\b|\baustralian dollars?\b/, 'AUD'],
  [/\bchf\b|\bswiss francs?\b/, 'CHF'],
  [/\bsgd\b|\bsingapore dollars?\b/, 'SGD'],
];

/** The currency a question or an answer talks in, if it says. "CAD dollars" is CAD, not USD. */
export function detectCurrency(text: string): string | null {
  const t = text.toLowerCase();
  const found = CURRENCIES.filter(([re]) => re.test(t)).map(([, c]) => c);
  if (!found.length) return null;
  return found.find((c) => c !== 'USD') ?? found[0];
}

/** Country names and the aliases a location string or question uses for them. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  'united states': ['united states', 'usa', 'u.s.a', 'u.s', 'us', 'america', 'new york', 'nyc', 'san francisco', 'seattle', 'austin', 'boston', 'chicago', 'los angeles'],
  'united kingdom': ['united kingdom', 'uk', 'u.k', 'great britain', 'britain', 'england', 'scotland', 'wales', 'london', 'manchester', 'edinburgh'],
  pakistan: ['pakistan', 'karachi', 'lahore', 'islamabad', 'rawalpindi', 'faisalabad', 'peshawar'],
  india: ['india', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai'],
  'united arab emirates': ['united arab emirates', 'uae', 'dubai', 'abu dhabi', 'sharjah'],
  'saudi arabia': ['saudi arabia', 'ksa', 'riyadh', 'jeddah'],
  qatar: ['qatar', 'doha'],
  germany: ['germany', 'deutschland', 'berlin', 'munich', 'hamburg', 'frankfurt'],
  netherlands: ['netherlands', 'holland', 'amsterdam', 'rotterdam'],
  france: ['france', 'paris'],
  ireland: ['ireland', 'dublin'],
  spain: ['spain', 'madrid', 'barcelona'],
  portugal: ['portugal', 'lisbon'],
  italy: ['italy', 'milan', 'rome'],
  poland: ['poland', 'warsaw', 'krakow'],
  sweden: ['sweden', 'stockholm'],
  switzerland: ['switzerland', 'zurich', 'geneva'],
  canada: ['canada', 'toronto', 'vancouver', 'montreal'],
  australia: ['australia', 'sydney', 'melbourne'],
  singapore: ['singapore'],
  japan: ['japan', 'tokyo'],
  turkey: ['turkey', 'türkiye', 'istanbul'],
  egypt: ['egypt', 'cairo'],
  malaysia: ['malaysia', 'kuala lumpur'],
  'new zealand': ['new zealand', 'auckland'],
};

const COUNTRY_RES = Object.entries(COUNTRY_ALIASES).map(([country, aliases]) => ({
  country,
  re: new RegExp(`(?<![a-z])(${aliases.map((a) => a.replace(/\./g, '\\.?')).join('|')})(?![a-z])`, 'i'),
}));

/** Countries mentioned in a location or question ("London, UK" → united kingdom). */
export function detectCountries(text: string): string[] {
  // "US" in lowercase prose ("contact us", "join us") is not a country: only trust it as written in capitals.
  const out = new Set<string>();
  for (const { country, re } of COUNTRY_RES) {
    const m = text.match(re);
    if (!m) continue;
    if (country === 'united states' && /^us$/i.test(m[1]) && m[1] !== 'US') continue;
    out.add(country);
  }
  return [...out];
}

/** Canonical country for a scope entry the owner typed ("UK", "U.S.", "Dubai" → its country). */
export function canonicalCountry(name: string): string {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) if (aliases.includes(n) || country === n) return country;
  return n;
}

// ── Intent detection ─────────────────────────────────────────────────────────

export function detectIntent(raw: string): Intent | null {
  const clean = cleanQuestion(raw);
  if (!clean) return null;
  const hits: { def: IntentDef; m: RegExpMatchArray }[] = [];
  for (const def of DEFS) {
    if (def.not?.test(clean)) continue;
    for (const re of def.re) {
      const m = clean.match(re);
      if (m) {
        hits.push({ def, m });
        break;
      }
    }
  }
  if (!hits.length) return null;
  const keys = new Set(hits.map((h) => h.def.key));
  if (CONFLICTS.some(([a, b]) => keys.has(a) && keys.has(b))) return null;
  const { def, m } = hits[0];
  const intent: Intent = { key: def.key, canonical: def.canonical };
  if (def.slot === 'skill') {
    const skillRaw = m.slice(1).find((g) => g && g.trim());
    const skill = skillRaw ? normalizeSkill(skillRaw) : '';
    if (skill) intent.skill = skill;
    if (def.key === 'has_experience' && !skill) return null;
  }
  if (def.slot === 'currency') {
    const c = detectCurrency(raw);
    if (c) intent.currency = c;
  }
  if (def.slot === 'country') {
    const countries = detectCountries(raw);
    if (countries.length) intent.countries = countries.sort();
  }
  return intent;
}

/**
 * The stored `question_norm`: the intent (with slot) when one is recognised,
 * otherwise the cleaned question. Two wordings of the same question share it.
 */
export function normalizeQuestion(raw: string): string {
  const intent = detectIntent(raw);
  if (!intent) return cleanQuestion(raw);
  const slot = [intent.skill, intent.currency?.toLowerCase(), ...(intent.countries ?? [])].filter(Boolean).join(' ');
  return slot ? `${intent.canonical} :: ${slot}` : intent.canonical;
}

// ── Fuzzy text ───────────────────────────────────────────────────────────────

const WORD_SYNONYMS: Record<string, string> = {
  position: 'role',
  job: 'role',
  opportunity: 'role',
  vacancy: 'role',
  opening: 'role',
  organization: 'company',
  organisation: 'company',
  firm: 'company',
  motivates: 'motivate',
  drives: 'motivate',
  inspires: 'motivate',
  motivated: 'motivate',
  biggest: 'greatest',
  strengths: 'strength',
  weaknesses: 'weakness',
  challenging: 'challenge',
  challenges: 'challenge',
  difficult: 'challenge',
  projects: 'project',
  interested: 'interest',
  excited: 'interest',
  excites: 'interest',
  passionate: 'interest',
  proudest: 'proud',
  accomplishment: 'achievement',
  accomplishments: 'achievement',
  achievements: 'achievement',
  goals: 'goal',
  aspirations: 'goal',
  apply: 'applying',
  applied: 'applying',
  salary: 'salary',
  cybersecurity: 'security',
  infosec: 'security',
};

const STOP = new Set(
  'a an the and or of to in on for with by at as is are was were be been being it its this that these those you your yours we us our ours i me my do does did have has had can could would will should shall may might what which who whom whose why how when where please kindly tell describe share explain give briefly about us here there any some if so than then just also very really most more much many one ever yet own say would like know think feel let looking'.split(
    ' ',
  ),
);

/** Cleaned text with word-level synonyms applied, for embeddings. */
export function fuzzyText(raw: string): string {
  return cleanQuestion(raw)
    .replace(/\bcyber security\b/g, 'cybersecurity')
    .split(' ')
    .map((w) => WORD_SYNONYMS[w] ?? w)
    .join(' ');
}

/** The words that carry the question's meaning. */
export function contentWords(raw: string): Set<string> {
  return new Set(
    fuzzyText(raw)
      .split(' ')
      .filter((w) => w && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

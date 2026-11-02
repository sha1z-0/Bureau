import { labelNorm } from './normalize.ts';

/**
 * Label variants → value keys. Deterministic, first step of the mapper.
 *
 * Each key says where its value comes from:
 *  - profile:   straight from the candidate's profile (name, contacts, links, location, work, education)
 *  - file:      the packet's CV or cover letter
 *  - bank:      the answer bank (A03 `answerFor`), never guessed. Legal attestations live here.
 *  - eeo:       voluntary demographic questions: always the decline option
 *  - consent:   consent and certification checkboxes
 *  - generated: derived truthfully from the job (e.g. "how did you hear about us")
 *  - never:     data Bureau must never enter (government ids, date of birth): the owner does it
 */

export type SynSource = 'profile' | 'file' | 'bank' | 'eeo' | 'consent' | 'generated' | 'never';

export interface SynEntry {
  key: string;
  source: SynSource;
  labels: string[];
  /** Extra regexes over the normalised label (for long question wordings). */
  patterns?: RegExp[];
  /** Only inside this repeating group. */
  group?: 'work' | 'education';
  /** Legal attestation: only an owner-confirmed answer-bank entry may answer it. */
  attestation?: boolean;
}

export const SYNONYMS: SynEntry[] = [
  // ── Identity ──
  { key: 'first_name', source: 'profile', labels: ['first name', 'given name', 'given names', 'firstname', 'forename', 'first', 'legal first name', 'name first', 'first name s', 'vorname', 'prenom', 'nombre', 'legal given name'] },
  { key: 'last_name', source: 'profile', labels: ['last name', 'surname', 'family name', 'lastname', 'legal last name', 'name last', 'last', 'nachname', 'nom', 'apellido', 'apellidos', 'legal family name', 'last name surname'] },
  { key: 'middle_name', source: 'profile', labels: ['middle name', 'middle initial', 'middle names', 'middle name s', 'mi'] },
  { key: 'preferred_name', source: 'profile', labels: ['preferred name', 'preferred first name', 'nickname', 'name you go by', 'what should we call you', 'known as', 'chosen name', 'preferred full name'] },
  { key: 'full_name', source: 'profile', labels: ['full name', 'name', 'your name', 'legal name', 'full legal name', 'candidate name', 'applicant name', 'first and last name', 'complete name', 'name and surname', 'vollstandiger name', 'name surname', 'your full name'] },
  { key: 'email', source: 'profile', labels: ['email', 'email address', 'e mail', 'e mail address', 'your email', 'contact email', 'email id', 'mail', 'personal email', 'e mail adresse', 'email adresse', 'your email address', 'primary email'] },
  { key: 'email_confirm', source: 'profile', labels: ['confirm email', 'confirm email address', 're enter email', 're enter email address', 'retype email', 'verify email', 'email confirmation', 'repeat email', 'confirm your email'] },
  { key: 'phone', source: 'profile', labels: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile phone', 'mobile phone number', 'cell', 'cell phone', 'cell phone number', 'telephone', 'telephone number', 'contact number', 'primary phone', 'phone no', 'mobile no', 'whatsapp number', 'contact phone', 'telefon', 'telefonnummer', 'handynummer', 'best phone number', 'your phone number'] },
  { key: 'phone_country_code', source: 'profile', labels: ['country code', 'phone country code', 'country phone code', 'dial code', 'calling code', 'phone code', 'country calling code'] },
  { key: 'phone_type', source: 'profile', labels: ['phone type', 'phone device type', 'type of phone', 'device type', 'phone number type'] },
  { key: 'phone_extension', source: 'never', labels: ['extension', 'phone extension', 'ext'] },
  // ── Links ──
  { key: 'linkedin', source: 'profile', labels: ['linkedin', 'linkedin profile', 'linkedin url', 'linkedin profile url', 'linkedin link', 'your linkedin', 'linked in', 'linkedin profile link'], patterns: [/\blinked ?in\b/] },
  { key: 'github', source: 'profile', labels: ['github', 'github profile', 'github url', 'github username', 'github link', 'git hub', 'github profile url'], patterns: [/\bgithub\b/] },
  { key: 'portfolio', source: 'profile', labels: ['portfolio', 'portfolio url', 'portfolio link', 'website', 'personal website', 'web site', 'personal site', 'homepage', 'blog', 'website url', 'your website', 'other website', 'link to portfolio', 'portfolio website', 'personal url', 'personal homepage'], patterns: [/\bportfolio\b/, /\bpersonal (web ?)?site\b/] },
  { key: 'twitter', source: 'profile', labels: ['twitter', 'twitter handle', 'x handle', 'twitter url', 'x twitter', 'twitter profile'] },
  { key: 'other_url', source: 'profile', labels: ['other url', 'other link', 'additional link', 'url', 'links', 'other profile', 'social media', 'other website or profile', 'online profile'] },
  // ── Location ──
  { key: 'location', source: 'profile', labels: ['location', 'current location', 'where are you located', 'where are you based', 'city and country', 'location city', 'your location', 'based in', 'current city and country', 'residence', 'place of residence', 'wohnort', 'where do you live', 'location city country'] },
  { key: 'city', source: 'profile', labels: ['city', 'town', 'city town', 'current city', 'city of residence', 'stadt', 'ciudad', 'ort', 'town city'] },
  { key: 'state', source: 'profile', labels: ['state', 'province', 'region', 'state province', 'state or province', 'county', 'state region', 'province state', 'bundesland'] },
  { key: 'country', source: 'profile', labels: ['country', 'country of residence', 'current country', 'country region', 'nation', 'land', 'pais', 'country you live in', 'residence country', 'country territory'] },
  { key: 'postal_code', source: 'bank', labels: ['zip', 'zip code', 'postal code', 'postcode', 'post code', 'plz', 'postleitzahl', 'zip postal code'] },
  { key: 'address_line', source: 'bank', labels: ['address', 'street address', 'address line 1', 'street', 'home address', 'address 1', 'mailing address', 'address line1', 'strasse'] },
  { key: 'address_line2', source: 'never', labels: ['address line 2', 'apartment', 'apt suite', 'address 2', 'address line2'] },
  // ── Current role ──
  { key: 'current_company', source: 'profile', labels: ['current company', 'current employer', 'employer', 'present employer', 'most recent employer', 'latest employer', 'current organization', 'current organisation', 'company you work for', 'current company name'] },
  { key: 'current_title', source: 'profile', labels: ['current title', 'current job title', 'current role', 'current position', 'present position', 'most recent title', 'designation', 'most recent job title', 'your current title'] },
  { key: 'years_experience', source: 'bank', labels: ['years of experience', 'total years of experience', 'how many years of experience do you have', 'years experience', 'work experience years', 'years of professional experience', 'experience in years', 'total experience', 'yrs of experience', 'how many years of professional experience do you have', 'total work experience'], patterns: [/\bhow many years\b.*\bexperience\b/, /\byears of (professional |relevant |work |industry )?experience\b/] },
  // ── Logistics (answer bank) ──
  { key: 'salary_expectation', source: 'bank', labels: ['salary expectations', 'expected salary', 'desired salary', 'salary requirements', 'compensation expectations', 'desired compensation', 'expected compensation', 'salary expectation', 'what are your salary expectations', 'target salary', 'gehaltsvorstellung', 'expected ctc', 'salary range expectation', 'desired pay'], patterns: [/\b(expected|desired|target)\b.*\b(salary|compensation|pay)\b/, /\bsalary (expectation|requirement)/] },
  { key: 'current_salary', source: 'bank', labels: ['current salary', 'current compensation', 'current ctc', 'present salary', 'current base salary'] },
  { key: 'notice_period', source: 'bank', labels: ['notice period', 'notice', 'how much notice', 'current notice period', 'kundigungsfrist', 'what is your notice period', 'notice period in weeks'] },
  { key: 'start_date', source: 'bank', labels: ['start date', 'earliest start date', 'available start date', 'when can you start', 'availability', 'available from', 'date available', 'availability date', 'desired start date', 'earliest available start date', 'when are you available to start', 'when could you start', 'available to start', 'start date availability'], patterns: [/\bwhen (can|could|would) you (start|begin|join)\b/, /\b(earliest|possible|available) (start|starting) date\b/] },
  { key: 'sponsorship', source: 'bank', attestation: true, labels: ['sponsorship', 'visa sponsorship', 'require sponsorship', 'need sponsorship', 'will you require sponsorship', 'do you require visa sponsorship', 'sponsorship required'], patterns: [/\bsponsor/, /\b(require|need)\b.*\bvisa\b/, /\bh ?1 ?b\b/, /\b(need|require)\b.*\bwork permit\b/] },
  { key: 'work_authorization', source: 'bank', attestation: true, labels: ['work authorization', 'work authorisation', 'authorized to work', 'legally authorized to work', 'right to work', 'work permit', 'eligible to work', 'work eligibility', 'are you legally authorized to work', 'employment eligibility'], patterns: [/\b(legally )?(authori[sz]ed|eligible|entitled|permitted) to work\b/, /\bright to work\b/, /\bwork (permit|authori[sz]ation|visa)\b/] },
  { key: 'citizenship', source: 'bank', attestation: true, labels: ['citizenship', 'nationality', 'citizen', 'country of citizenship', 'are you a citizen'], patterns: [/\bcitizen(ship)?\b/, /\bnationalit/] },
  { key: 'criminal', source: 'bank', attestation: true, labels: ['criminal record', 'have you been convicted', 'criminal conviction', 'felony'], patterns: [/\bconvict/, /\bcriminal\b/, /\bfelony\b/, /\bmisdemeanou?r\b/] },
  { key: 'noncompete', source: 'bank', attestation: true, labels: ['non compete', 'noncompete', 'restrictive covenant', 'non solicitation agreement'], patterns: [/\bnon ?compete\b/, /\brestrictive covenants?\b/] },
  { key: 'security_clearance', source: 'bank', attestation: true, labels: ['security clearance', 'clearance', 'active clearance', 'clearance level'], patterns: [/\bclearance\b/] },
  { key: 'age_18', source: 'bank', attestation: true, labels: ['are you 18 or older', 'are you at least 18 years of age', 'over 18', 'legal age'], patterns: [/\b(at least|over|above|older than) (18|eighteen)\b/, /\b18 (years|yrs)\b/] },
  { key: 'background_check', source: 'bank', attestation: true, labels: ['background check', 'consent to background check', 'background screening', 'drug test', 'drug screening'], patterns: [/\bbackground (check|screening)\b/, /\bdrug (test|screen)/] },
  { key: 'previously_employed', source: 'bank', labels: ['have you worked here before', 'previously employed', 'former employee', 'have you previously worked for', 'previous employment with us'], patterns: [/\b(previously|ever) (been )?(employed|worked)\b/, /\bformer(ly)? (employee|employed)\b/] },
  { key: 'relocation', source: 'bank', labels: ['relocation', 'willing to relocate', 'open to relocation', 'relocate', 'are you willing to relocate'], patterns: [/\breloca/] },
  { key: 'remote', source: 'bank', labels: ['open to remote', 'work remotely', 'remote work', 'are you open to hybrid', 'onsite', 'on site', 'in office', 'hybrid work'], patterns: [/\b(on ?site|in (the )?office|hybrid)\b.*\b(work|days|able|willing|comfortable)\b/] },
  { key: 'travel', source: 'bank', labels: ['willing to travel', 'travel', 'are you willing to travel', 'travel requirements'], patterns: [/\b(willing|able|open|available) to travel\b/] },
  { key: 'languages', source: 'bank', labels: ['languages', 'languages spoken', 'what languages do you speak', 'language skills', 'spoken languages'] },
  { key: 'timezone', source: 'bank', labels: ['timezone', 'time zone', 'your time zone', 'current time zone'], patterns: [/\btime ?zone\b/] },
  { key: 'highest_education', source: 'bank', labels: ['highest level of education', 'highest degree', 'highest education', 'education level', 'level of education', 'highest qualification', 'highest degree obtained'] },
  { key: 'drivers_licence', source: 'bank', labels: ['drivers license', 'driving licence', 'driver s license', 'valid drivers license'] },
  // ── Source / referral ──
  { key: 'how_heard', source: 'generated', labels: ['how did you hear about us', 'how did you hear about this job', 'how did you hear about this position', 'how did you hear about this role', 'source', 'where did you find this job', 'how did you find us', 'referral source', 'how did you learn about this position', 'where did you hear about us', 'wie haben sie von uns erfahren', 'how did you hear about the job', 'where did you hear about this job', 'how did you find this job', 'application source', 'lead source'], patterns: [/\bhow did you (hear|find|learn)\b/, /\bwhere did you (hear|find|see)\b/] },
  { key: 'referred_by', source: 'bank', labels: ['referred by', 'referral name', 'employee referral', 'who referred you', 'referrer name', 'referral', 'name of referrer', 'were you referred', 'referrer'], patterns: [/\breferr?(ed|al|er)\b/] },
  // ── Voluntary self-identification: always declined ──
  { key: 'pronouns', source: 'eeo', labels: ['pronouns', 'preferred pronouns', 'your pronouns', 'pronoun'] },
  { key: 'gender', source: 'eeo', labels: ['gender', 'sex', 'gender identity', 'what is your gender', 'gender optional'], patterns: [/\bgender\b/] },
  { key: 'race', source: 'eeo', labels: ['race', 'ethnicity', 'race ethnicity', 'ethnic background', 'racial', 'race and ethnicity', 'ethnic origin'], patterns: [/\b(race|ethnicit)/] },
  { key: 'hispanic', source: 'eeo', labels: ['hispanic latino', 'are you hispanic or latino', 'hispanic or latino', 'hispanic latinx'], patterns: [/\bhispanic\b|\blatin[oax]\b/] },
  { key: 'veteran', source: 'eeo', labels: ['veteran status', 'protected veteran', 'veteran', 'military status', 'are you a veteran', 'protected veteran status'], patterns: [/\bveteran\b/] },
  { key: 'disability', source: 'eeo', labels: ['disability', 'disability status', 'do you have a disability', 'voluntary self identification of disability', 'disability self identification'], patterns: [/\bdisabilit/] },
  { key: 'sexual_orientation', source: 'eeo', labels: ['sexual orientation', 'orientation', 'lgbtq'], patterns: [/\bsexual orientation\b|\blgbt/] },
  { key: 'transgender', source: 'eeo', labels: ['transgender', 'do you identify as transgender', 'trans'], patterns: [/\btransgender\b/] },
  // ── Documents ──
  { key: 'resume', source: 'file', labels: ['resume', 'cv', 'resume cv', 'cv resume', 'curriculum vitae', 'upload resume', 'attach resume', 'upload your resume', 'resume upload', 'lebenslauf', 'upload cv', 'your resume', 'resume file', 'attach your cv'], patterns: [/\b(resume|cv|curriculum vitae|lebenslauf)\b/] },
  { key: 'cover_letter', source: 'file', labels: ['cover letter', 'covering letter', 'motivation letter', 'letter of motivation', 'anschreiben', 'motivationsschreiben', 'cover letter upload', 'attach cover letter', 'upload cover letter', 'your cover letter'], patterns: [/\bcover(ing)? letter\b|\bmotivation(al)? letter\b|\banschreiben\b/] },
  { key: 'resume_text', source: 'profile', labels: ['paste resume', 'resume text', 'paste your resume', 'plain text resume', 'copy and paste your resume'] },
  // ── Education (repeating group or flat) ──
  { key: 'school', source: 'profile', labels: ['school', 'university', 'school name', 'college', 'institution', 'university name', 'educational institution', 'school university', 'hochschule', 'college university', 'school or university', 'institution name', 'name of school'] },
  { key: 'degree', source: 'profile', labels: ['degree', 'degree type', 'qualification', 'degree obtained', 'degree name', 'type of degree', 'abschluss'] },
  { key: 'discipline', source: 'profile', labels: ['discipline', 'field of study', 'major', 'area of study', 'course', 'subject', 'specialization', 'specialisation', 'concentration', 'studienfach', 'course of study', 'major field of study'] },
  { key: 'edu_start', source: 'profile', group: 'education', labels: ['start date', 'from', 'start year', 'start month', 'from date', 'year started', 'start'] },
  { key: 'edu_end', source: 'profile', group: 'education', labels: ['end date', 'to', 'end year', 'graduation date', 'graduation year', 'to date', 'year graduated', 'end', 'expected graduation', 'completion date', 'actual or expected'] },
  { key: 'edu_description', source: 'profile', group: 'education', labels: ['description', 'summary', 'details', 'activities', 'activities and societies', 'additional details'] },
  { key: 'gpa', source: 'never', labels: ['gpa', 'grade', 'grade point average', 'overall result', 'cgpa', 'grades'] },
  // ── Work history (repeating group) ──
  { key: 'work_company', source: 'profile', group: 'work', labels: ['company', 'employer', 'company name', 'organization', 'organisation', 'employer name'] },
  { key: 'work_title', source: 'profile', group: 'work', labels: ['job title', 'title', 'position', 'role', 'position title'] },
  { key: 'work_location', source: 'profile', group: 'work', labels: ['location', 'city', 'work location'] },
  { key: 'work_start', source: 'profile', group: 'work', labels: ['start date', 'from', 'start', 'from date', 'start month', 'start year'] },
  { key: 'work_end', source: 'profile', group: 'work', labels: ['end date', 'to', 'end', 'to date', 'end month', 'end year'] },
  { key: 'work_current', source: 'profile', group: 'work', labels: ['i currently work here', 'current job', 'currently working here', 'present', 'current', 'i currently work here present', 'this is my current job', 'currently employed here'] },
  { key: 'work_description', source: 'profile', group: 'work', labels: ['description', 'role description', 'responsibilities', 'summary', 'job description', 'duties', 'key responsibilities'] },
  // ── Flat "current" job fields that reuse work words outside a group ──
  { key: 'current_company', source: 'profile', labels: ['company', 'company name', 'organization', 'organisation'] },
  { key: 'current_title', source: 'profile', labels: ['job title', 'title', 'position', 'role', 'headline'] },
  // ── Skills and summary (from the profile) ──
  { key: 'skills', source: 'profile', labels: ['skills', 'technical skills', 'key skills', 'tech stack', 'technologies', 'tools', 'programming languages', 'which technologies have you used'], patterns: [/\b(which|what) (of these|technologies|tools|languages|frameworks|skills)\b/, /\bhave you used\b/, /\b(tech(nology)? stack|technical skills|key skills)\b/] },
  { key: 'summary', source: 'profile', labels: ['summary', 'professional summary', 'about you', 'about me', 'bio', 'profile summary', 'short bio', 'introduce yourself', 'tell us about yourself'] },
  // ── Consent and certification ──
  { key: 'consent_marketing', source: 'consent', labels: ['send me job alerts', 'subscribe', 'keep me updated', 'talent community', 'future opportunities', 'marketing emails', 'newsletter'], patterns: [/\b(job alerts?|newsletter|talent (community|pool|network)|future (job )?opportunit\w*|future (roles|positions|vacancies|openings|jobs)|keep my (data|details|cv|information)|keep me (informed|updated)|marketing|subscribe|sms|text messages?)\b/] },
  { key: 'consent_privacy', source: 'consent', labels: ['i agree to the privacy policy', 'privacy policy', 'i have read the privacy notice', 'data processing consent', 'gdpr consent', 'i consent to the processing of my personal data', 'i accept the terms and conditions', 'terms and conditions', 'i agree', 'privacy notice', 'consent'], patterns: [/\b(privacy|gdpr|data (protection|processing)|personal data|terms (and|&) conditions|terms of (use|service)|i (have )?read|i agree|i accept|i consent)\b/] },
  { key: 'certify_accurate', source: 'consent', labels: ['i certify that the information provided is accurate', 'i certify', 'attestation', 'i confirm the information is true', 'acknowledgement'], patterns: [/\b(certify|attest|confirm)\b.*\b(true|accurate|correct|complete)\b/] },
  // ── Signature dates: today ──
  { key: 'date_today', source: 'generated', labels: ['date', 'today s date', 'todays date', 'date signed', 'signature date', 'date of signature', 'signed on'] },
  { key: 'graduation_date', source: 'bank', labels: ['graduation date', 'graduation year', 'expected graduation', 'year of graduation', 'expected graduation date', 'date of graduation'] },
  // ── Never entered by Bureau ──
  { key: 'date_of_birth', source: 'never', labels: ['date of birth', 'dob', 'birthday', 'birth date', 'geburtsdatum'], patterns: [/\b(date of birth|birth ?date|birthday)\b/] },
  { key: 'national_id', source: 'never', labels: ['social security number', 'ssn', 'national id', 'cnic', 'passport number', 'tax id', 'national insurance number', 'sin', 'id number'], patterns: [/\b(social security|ssn|national (id|identity|insurance)|passport|cnic|tax (id|number)|aadhaar|pan number)\b/] },
  { key: 'salary_history_ban', source: 'never', labels: ['bank account', 'iban', 'credit card'], patterns: [/\b(bank account|iban|credit card|routing number)\b/] },
];

export interface SynMatch {
  entry: SynEntry;
  how: 'exact' | 'pattern' | 'contains';
  confidence: number;
}

const exactIndex = new Map<string, SynEntry[]>();
for (const e of SYNONYMS) {
  for (const l of e.labels) {
    const k = labelNorm(l);
    const list = exactIndex.get(k) ?? [];
    list.push(e);
    exactIndex.set(k, list);
  }
}

/** Number of distinct label variants in the dictionary. */
export function synonymCount(): number {
  return exactIndex.size + SYNONYMS.reduce((n, e) => n + (e.patterns?.length ?? 0), 0);
}

const pick = (list: SynEntry[], group: string | null) =>
  list.find((e) => e.group && e.group === group) ?? list.find((e) => !e.group) ?? null;

/** Find the value key for a label. `group` is the repeating group the field sits in, if any. */
export function matchSynonym(labelN: string, group: string | null = null): SynMatch | null {
  const l = labelN.replace(/\s*\d+$/, '').trim();
  if (!l) return null;
  const exact = exactIndex.get(l);
  if (exact) {
    const e = pick(exact, group);
    if (e) return { entry: e, how: 'exact', confidence: 0.97 };
  }
  // Long, question-like labels: patterns first.
  for (const e of SYNONYMS) {
    if (e.group && e.group !== group) continue;
    if (e.patterns?.some((re) => re.test(l))) return { entry: e, how: 'pattern', confidence: 0.9 };
  }
  // Short labels that contain a known variant ("Your LinkedIn URL (optional)").
  const words = l.split(' ');
  if (words.length <= 7) {
    let best: { e: SynEntry; len: number } | null = null;
    for (const [k, list] of exactIndex) {
      if (k.length < 4 || list.every((x) => x.key === 'date_today')) continue;
      if ((' ' + l + ' ').includes(' ' + k + ' ')) {
        const e = pick(list, group);
        if (e && (!best || k.length > best.len)) best = { e, len: k.length };
      }
    }
    if (best) return { entry: best.e, how: 'contains', confidence: 0.85 };
  }
  return null;
}

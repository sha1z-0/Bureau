import type { Profile } from '../services/profileStore.ts';

/** The candidate's facts in the shapes forms ask for. Derived from the profile only: nothing invented. */

export interface WorkEntry {
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  current: boolean;
  description: string;
}
export interface EduEntry {
  school: string;
  degree: string;
  degreeLevel: string;
  discipline: string;
  start: string;
  end: string;
}
export interface Candidate {
  name: string;
  first: string;
  middle: string;
  last: string;
  email: string;
  phone: string;
  phoneCc: string;
  phoneNational: string;
  phoneCountry: string;
  location: string;
  city: string;
  state: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  twitter: string;
  currentCompany: string;
  currentTitle: string;
  yearsExperience: number;
  work: WorkEntry[];
  education: EduEntry[];
  cvText: string;
}

/** Calling codes for the countries Bureau users apply from and to most. */
export const DIAL_CODES: Record<string, string> = {
  'united states': '1', canada: '1', 'united kingdom': '44', ireland: '353', germany: '49', france: '33', netherlands: '31', belgium: '32',
  spain: '34', portugal: '351', italy: '39', switzerland: '41', austria: '43', poland: '48', sweden: '46', norway: '47', denmark: '45',
  finland: '358', estonia: '372', 'czech republic': '420', romania: '40', greece: '30', turkey: '90', israel: '972', 'united arab emirates': '971',
  'saudi arabia': '966', qatar: '974', bahrain: '973', kuwait: '965', oman: '968', egypt: '20', pakistan: '92', india: '91', bangladesh: '880',
  'sri lanka': '94', nepal: '977', singapore: '65', malaysia: '60', indonesia: '62', philippines: '63', vietnam: '84', thailand: '66',
  japan: '81', 'south korea': '82', china: '86', 'hong kong': '852', taiwan: '886', australia: '61', 'new zealand': '64', brazil: '55',
  mexico: '52', argentina: '54', chile: '56', colombia: '57', nigeria: '234', kenya: '254', 'south africa': '27', ukraine: '380',
};

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'United States', us: 'United States', 'u s': 'United States', 'u s a': 'United States', 'united states of america': 'United States', america: 'United States',
  uk: 'United Kingdom', 'u k': 'United Kingdom', 'great britain': 'United Kingdom', britain: 'United Kingdom', england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  uae: 'United Arab Emirates', 'u a e': 'United Arab Emirates', ksa: 'Saudi Arabia', deutschland: 'Germany', holland: 'Netherlands', 'the netherlands': 'Netherlands',
  korea: 'South Korea', 'republic of korea': 'South Korea', czechia: 'Czech Republic', turkiye: 'Turkey', 'türkiye': 'Turkey',
};

const US_STATES = /^(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)$/;

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function canonicalCountry(raw: string): string {
  const k = raw.toLowerCase().replace(/[.]/g, '').trim();
  if (COUNTRY_ALIASES[k]) return COUNTRY_ALIASES[k];
  if (DIAL_CODES[k]) return titleCase(k);
  return raw.trim();
}

export function splitLocation(loc: string): { city: string; state: string; country: string } {
  const parts = loc
    .replace(/\((remote|hybrid|onsite)\)/gi, '')
    .split(/[,|·/]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(remote|hybrid|on-?site)$/i.test(s));
  if (!parts.length) return { city: '', state: '', country: '' };
  if (parts.length === 1) {
    const c = canonicalCountry(parts[0]);
    return DIAL_CODES[c.toLowerCase()] ? { city: '', state: '', country: c } : { city: parts[0], state: '', country: '' };
  }
  const last = parts[parts.length - 1];
  if (US_STATES.test(last)) return { city: parts[0], state: last, country: 'United States' };
  const country = canonicalCountry(last);
  return { city: parts[0], state: parts.length > 2 ? parts[1] : '', country };
}

export function splitPhone(raw: string, country: string): { cc: string; national: string; country: string } {
  const t = raw.trim();
  const plus = t.match(/^\+\s?(\d{1,4})[\s\-().]*(.*)$/) ?? t.match(/^00\s?(\d{1,4})[\s\-().]*(.*)$/);
  if (plus) {
    const rest = plus[2].replace(/\D/g, '');
    // Longest calling code that is a real one.
    const all = (plus[1] + rest).replace(/\D/g, '');
    for (const len of [3, 2, 1]) {
      const cc = all.slice(0, len);
      const hit = Object.entries(DIAL_CODES).find(([, code]) => code === cc);
      if (hit) {
        const name = cc === '1' && country ? country : titleCase(hit[0]);
        return { cc, national: all.slice(len), country: name };
      }
    }
    return { cc: plus[1], national: rest, country };
  }
  const code = DIAL_CODES[country.toLowerCase()] ?? '';
  return { cc: code, national: t.replace(/\D/g, '').replace(/^0/, ''), country };
}

const DEGREE_RE = /^\s*(b\.?\s?s\.?c?|bsc|bs|ba|b\.?a\.?|b\.?e\.?|beng|b\.?tech|btech|bba|bcs|m\.?s\.?c?|msc|ms|ma|m\.?a\.?|mba|m\.?eng|meng|m\.?tech|mtech|ph\.?\s?d|phd|associate(?:'s)?(?: degree)?|bachelor(?:'s)?(?: degree)?(?: of [a-z]+)?|master(?:'s)?(?: degree)?(?: of [a-z]+)?|doctor(?:ate)?(?: of [a-z]+)?|diploma|high school|a levels?|o levels?|intermediate|matric(?:ulation)?|hssc|ssc)\b\.?\s*(?:\(([^)]*)\))?\s*(?:in|of|-|,|:)?\s*(.*)$/i;

export function degreeLevel(deg: string): string {
  const d = deg.toLowerCase();
  if (/ph\.?\s?d|doctor/.test(d)) return 'Doctorate';
  if (/\bm\.?s\.?c?\b|\bmsc\b|\bms\b|\bma\b|\bmba\b|master|m\.?eng|m\.?tech/.test(d)) return "Master's Degree";
  if (/\bb\.?s\.?c?\b|\bbsc\b|\bbs\b|\bba\b|bachelor|b\.?e\.?\b|beng|b\.?tech|bba|bcs/.test(d)) return "Bachelor's Degree";
  if (/associate/.test(d)) return "Associate's Degree";
  if (/high school|a level|intermediate|hssc|matric|ssc|o level/.test(d)) return 'High School';
  if (/diploma/.test(d)) return 'Diploma';
  return deg;
}

export function splitDegree(raw: string): { degree: string; discipline: string } {
  const m = raw.match(DEGREE_RE);
  if (m) return { degree: m[1].trim(), discipline: (m[3] || m[2] || '').trim() };
  const idx = raw.search(/\s(in|of)\s/i);
  if (idx > 0) return { degree: raw.slice(0, idx).trim(), discipline: raw.slice(idx).replace(/^\s*(in|of)\s*/i, '').trim() };
  return { degree: raw.trim(), discipline: '' };
}

const isPresent = (s: string) => !s.trim() || /present|current|now|ongoing|today/i.test(s);

export function candidateFrom(p: Profile | null, links: { linkedin?: string; github?: string; portfolio?: string; socials?: { label: string; url: string }[] } = {}): Candidate | null {
  if (!p) return null;
  const tokens = p.name.trim().split(/\s+/).filter(Boolean);
  const first = tokens[0] ?? '';
  const last = tokens.length > 1 ? tokens[tokens.length - 1] : '';
  const middle = tokens.length > 2 ? tokens.slice(1, -1).join(' ') : '';
  const loc = splitLocation(p.location || '');
  const phone = splitPhone(p.phone || '', loc.country);
  const link = (re: RegExp) => p.links.find((l) => re.test(l.url) || re.test(l.label))?.url ?? '';
  const work: WorkEntry[] = p.experience.map((e) => ({
    company: e.company,
    title: e.role,
    location: e.location,
    start: e.start,
    end: isPresent(e.end) ? '' : e.end,
    current: isPresent(e.end),
    description: e.bullets.join('\n'),
  }));
  const education: EduEntry[] = p.education.map((e) => {
    const sd = splitDegree(e.degree);
    return { school: e.school, degree: e.degree, degreeLevel: degreeLevel(sd.degree || e.degree), discipline: sd.discipline || e.details.split(/[.;\n]/)[0]?.trim() || '', start: e.start, end: e.end };
  });
  const current = work.find((w) => w.current) ?? null;
  return {
    name: p.name.trim(),
    first,
    middle,
    last,
    email: p.email.trim(),
    phone: p.phone.trim(),
    phoneCc: phone.cc,
    phoneNational: phone.national,
    phoneCountry: phone.country || loc.country,
    location: p.location.trim(),
    city: loc.city,
    state: loc.state,
    country: loc.country || phone.country,
    linkedin: links.linkedin || link(/linkedin\.com/i),
    github: links.github || link(/github\.com/i),
    portfolio: links.portfolio || link(/portfolio|website|site|blog/i),
    twitter: links.socials?.find((s) => /twitter\.com|x\.com/i.test(s.url))?.url || link(/twitter\.com|x\.com/i),
    currentCompany: current?.company ?? '',
    currentTitle: current?.title ?? '',
    yearsExperience: p.yearsExperience,
    work,
    education,
    cvText: p.cvMarkdown,
  };
}

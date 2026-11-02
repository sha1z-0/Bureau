import crypto from 'node:crypto';
import { z } from 'zod/v4';
import { StyleFingerprintSchema, type StyleFingerprint, type VoicePassage } from '../contracts/profile.ts';
import { all, get, getSetting, now, run, setSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { parseJson as json } from './text.ts';
import { bump } from './state.ts';

/**
 * The voice bank: short passages the candidate writes in their own words. The
 * writer builds letters by editing these (AI-edited human text reads as human;
 * AI-generated text doesn't), and its stylometric lint compares every letter
 * against the fingerprint measured here.
 */

export const SUGGESTED_PROMPTS = [
  { key: 'why_build', prompt: 'Why do you build things? What got you started, and what keeps you at it?' },
  { key: 'proudest_project', prompt: 'Tell the story of the project you are proudest of: the problem, what you did, and how it turned out.' },
  { key: 'hard_bug', prompt: 'Describe a hard bug or problem you cracked. What made it hard, and how did you find the answer?' },
  { key: 'learned_fast', prompt: 'Something you had to learn fast. How did you go about it, and what did you ship with it?' },
  { key: 'team_loved', prompt: 'A team you loved working in. What made it work, and what was your part in it?' },
  { key: 'learning_now', prompt: 'What are you learning right now, and why that?' },
  { key: 'why_field', prompt: 'Why this field? What draws you to the kind of work you are applying for?' },
  { key: 'failure', prompt: 'A failure or mistake, and what you changed because of it.' },
] as const;

export const VOICE_GUIDANCE =
  'Write 80–200 words per answer, the way you would say it to a friend in the field. Bureau edits these into your letters, so they keep sounding like you.';

interface Row {
  id: string;
  prompt: string;
  text: string;
  tags: string;
  created_at: string;
}

const toPassage = (r: Row): VoicePassage => ({ id: r.id, prompt: r.prompt, text: r.text, tags: json<string[]>(r.tags, []), createdAt: r.created_at });

export function listVoice(): VoicePassage[] {
  return all<Row>('SELECT * FROM voice_bank ORDER BY created_at, id').map(toPassage);
}

export const VoiceInput = z.object({
  prompt: z.string().trim().min(1).max(400),
  text: z.string().trim().min(1).max(6000),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
});

export function addVoice(input: z.input<typeof VoiceInput>): VoicePassage {
  const v = VoiceInput.parse(input);
  const id = crypto.randomUUID();
  run('INSERT INTO voice_bank (id, prompt, text, tags, created_at) VALUES (?, ?, ?, ?, ?)', id, v.prompt, v.text, JSON.stringify(v.tags), now());
  refreshStyle();
  return toPassage(get<Row>('SELECT * FROM voice_bank WHERE id = ?', id)!);
}

export function updateVoice(id: string, input: Partial<z.input<typeof VoiceInput>>): VoicePassage {
  const cur = get<Row>('SELECT * FROM voice_bank WHERE id = ?', id);
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'No such passage');
  const v = VoiceInput.parse({ prompt: input.prompt ?? cur.prompt, text: input.text ?? cur.text, tags: input.tags ?? json<string[]>(cur.tags, []) });
  run('UPDATE voice_bank SET prompt = ?, text = ?, tags = ? WHERE id = ?', v.prompt, v.text, JSON.stringify(v.tags), id);
  refreshStyle();
  return toPassage(get<Row>('SELECT * FROM voice_bank WHERE id = ?', id)!);
}

export function deleteVoice(id: string) {
  const res = run('DELETE FROM voice_bank WHERE id = ?', id);
  if (!res.changes) throw new AppError(404, 'NOT_FOUND', 'No such passage');
  refreshStyle();
}

// ── Style fingerprint ────────────────────────────────────────────────────────

const STYLE_KEY = 'profile.style';

/** Connectives worth tracking: the glue words that make a person's prose theirs. Longest first so phrases win. */
const CONNECTIVES = [
  'which meant',
  'that meant',
  'turns out',
  'it turned out',
  'in the end',
  'after that',
  'that said',
  'even so',
  'as a result',
  'for example',
  'for instance',
  'in fact',
  'on top of that',
  'so',
  'but',
  'because',
  'though',
  'although',
  'however',
  'still',
  'also',
  'actually',
  'anyway',
  'instead',
  'while',
  'since',
  'yet',
  'plus',
  'then',
  'meanwhile',
  'besides',
  'otherwise',
  'therefore',
  'thus',
  'honestly',
  'eventually',
  'basically',
];

const WORD = /[A-Za-z0-9]+(?:['’][A-Za-z]+)*/g;
const CONTRACTION = /^[a-z]+(?:n['’]t|['’](?:re|ve|ll|d|m))$|^(?:it|that|there|what|let|here|who|he|she|where|how)['’]s$/i;
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', "i'm", "i've", "i'd", "i'll"]);

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}|\n(?=[-•*\d])/)
    .flatMap((para) => para.replace(/\s+/g, ' ').split(/(?<=[.!?…])["'”’)]?\s+(?=["'“‘(]?[A-Z0-9])/))
    .map((s) => s.trim())
    .filter((s) => (s.match(WORD) ?? []).length > 0);
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Moving-average type-token ratio: stable across text lengths, unlike the raw ratio. */
function mattr(words: string[], window = 50): number {
  if (!words.length) return 0;
  if (words.length <= window) return new Set(words).size / words.length;
  const counts = new Map<string, number>();
  let unique = 0;
  let total = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const c = counts.get(w) ?? 0;
    if (c === 0) unique++;
    counts.set(w, c + 1);
    if (i >= window) {
      const old = words[i - window];
      const oc = counts.get(old)! - 1;
      counts.set(old, oc);
      if (oc === 0) unique--;
    }
    if (i >= window - 1) total += unique / window;
  }
  return total / (words.length - window + 1);
}

/**
 * Measure a body of writing. A04 runs this on candidate letters too and
 * compares against the voice-bank fingerprint.
 */
export function fingerprintOf(texts: string[]): StyleFingerprint {
  const joined = texts.map((t) => t.trim()).filter(Boolean);
  const sentences = joined.flatMap(splitSentences);
  const lengths = sentences.map((s) => (s.match(WORD) ?? []).length);
  const words = joined.flatMap((t) => (t.match(WORD) ?? []).map((w) => w.toLowerCase().replace(/’/g, "'")));
  const n = words.length || 1;
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const std = lengths.length ? Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length) : 0;
  const lower = ` ${joined.join(' ').toLowerCase().replace(/’/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  const counts: { c: string; n: number }[] = [];
  let scrubbed = lower;
  for (const c of CONNECTIVES) {
    const re = new RegExp(` ${c} `, 'g');
    const hits = scrubbed.match(re)?.length ?? 0;
    if (hits) {
      counts.push({ c, n: hits });
      scrubbed = scrubbed.replace(re, ' | ');
    }
  }
  counts.sort((a, b) => b.n - a.n || CONNECTIVES.indexOf(a.c) - CONNECTIVES.indexOf(b.c));
  return StyleFingerprintSchema.parse({
    passages: joined.length,
    words: words.length,
    sentenceLenMean: round(mean, 2),
    sentenceLenStd: round(std, 2),
    typeTokenRatio: round(mattr(words)),
    contractionRate: round(words.filter((w) => CONTRACTION.test(w)).length / n, 4),
    firstPersonRate: round(words.filter((w) => FIRST_PERSON.has(w)).length / n, 4),
    connectives: counts.slice(0, 8).map((x) => x.c),
  });
}

/** Recompute and store the fingerprint (null with no passages). */
export function refreshStyle(): StyleFingerprint | null {
  const passages = listVoice();
  const fp = passages.length ? fingerprintOf(passages.map((p) => p.text)) : null;
  setSetting(STYLE_KEY, fp);
  bump();
  return fp;
}

export function storedStyle(): StyleFingerprint | null {
  const raw = getSetting<unknown>(STYLE_KEY, undefined);
  if (raw === undefined) return refreshStyle();
  const parsed = StyleFingerprintSchema.nullable().safeParse(raw);
  return parsed.success ? parsed.data : refreshStyle();
}

import crypto from 'node:crypto';
import { all, run } from '../db.ts';
import { cosine, embed, fromBlob, HASH_MODEL, MODEL_ID, toBlob } from '../ai/embed.ts';
import type { MatchJob } from './jobs.ts';

/**
 * Similarity pre-rank: cosine between each job's embedding (the scout's
 * job_embeddings row, embedded on demand when missing) and the candidate's
 * profile embedding. Only vectors from the same model are ever compared.
 */

/** Cosine ranges that map to 0–100 for each model; the hash fallback runs much lower than MiniLM. */
const CALIBRATION: Record<string, { lo: number; hi: number }> = {
  [MODEL_ID]: { lo: 0.15, hi: 0.6 },
  [HASH_MODEL]: { lo: 0.02, hi: 0.35 },
};

export function similarityScore(cos: number, model: string): number {
  const { lo, hi } = CALIBRATION[model] ?? { lo: 0.1, hi: 0.6 };
  return Math.round(Math.max(0, Math.min(1, (cos - lo) / (hi - lo))) * 100);
}

/** Pre-rank 0–100: half the cheap prefilter, half the embedding similarity (prefilter alone when no similarity). */
export function preRank(prefilter: number, similarity: number | null): number {
  const p = Math.max(0, Math.min(100, prefilter));
  return similarity === null ? Math.round(p) : Math.round(0.5 * p + 0.5 * similarity);
}

export function jobEmbeddingText(j: Pick<MatchJob, 'title' | 'company' | 'descriptionText'>): string {
  return `${j.title} at ${j.company}\n${j.descriptionText.replace(/\s+/g, ' ').slice(0, 1800)}`;
}

const profileCache = new Map<string, { model: string; vector: Float32Array }>();

async function profileVector(text: string): Promise<{ model: string; vector: Float32Array }> {
  const key = crypto.createHash('sha256').update(text).digest('hex');
  const hit = profileCache.get(key);
  if (hit) return hit;
  const { model, vectors } = await embed([text]);
  const out = { model, vector: vectors[0] };
  if (profileCache.size > 20) profileCache.clear();
  profileCache.set(key, out);
  return out;
}

export interface SimilarityResult {
  model: string;
  /** Raw cosine per job id. */
  cosine: Map<string, number>;
  /** 0–100 per job id. */
  score: Map<string, number>;
  /** How many job vectors were computed now rather than read from job_embeddings. */
  embedded: number;
}

/**
 * Similarity for each job against the profile text. Stored vectors from the
 * current model are reused; missing ones are embedded and stored; vectors from
 * another model are recomputed in memory and left for the scout to replace.
 */
export async function jobSimilarity(jobs: MatchJob[], profileText: string): Promise<SimilarityResult> {
  const prof = await profileVector(profileText);
  const stored = new Map<string, { model: string; vector: Uint8Array }>();
  const ids = jobs.map((j) => j.id);
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of all<{ job_id: string; model: string; vector: Uint8Array }>(
      `SELECT job_id, model, vector FROM job_embeddings WHERE job_id IN (${chunk.map(() => '?').join(',')})`,
      ...chunk,
    )) {
      stored.set(r.job_id, { model: r.model, vector: r.vector });
    }
  }

  const vectors = new Map<string, Float32Array>();
  const toEmbed: MatchJob[] = [];
  for (const j of jobs) {
    const s = stored.get(j.id);
    if (s && s.model === prof.model) {
      const v = fromBlob(s.vector);
      if (v.length === prof.vector.length) {
        vectors.set(j.id, v);
        continue;
      }
    }
    toEmbed.push(j);
  }
  if (toEmbed.length) {
    const { model, vectors: fresh } = await embed(toEmbed.map(jobEmbeddingText));
    toEmbed.forEach((j, i) => {
      if (model !== prof.model) return; // the model changed mid-run; never compare across models
      vectors.set(j.id, fresh[i]);
      if (!stored.has(j.id)) run('INSERT OR IGNORE INTO job_embeddings (job_id, model, vector) VALUES (?, ?, ?)', j.id, model, toBlob(fresh[i]));
    });
  }

  const cos = new Map<string, number>();
  const score = new Map<string, number>();
  for (const [id, v] of vectors) {
    const c = cosine(v, prof.vector);
    cos.set(id, c);
    score.set(id, similarityScore(c, prof.model));
  }
  return { model: prof.model, cosine: cos, score, embedded: toEmbed.length };
}

import path from 'node:path';
import { DATA_DIR } from '../config.ts';

/**
 * Local sentence embeddings, shared by the scout (dedupe), the matcher
 * (similarity pre-rank) and the answer bank (fuzzy questions). Runs a small
 * model on this machine through @huggingface/transformers; nothing leaves it.
 *
 * When the model can't load (first run offline, or BUREAU_EMBED=hash in tests)
 * a deterministic feature-hashing embedding stands in. Vectors from different
 * models are never comparable, so every result names its model.
 */

export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const HASH_MODEL = 'hash-384';
const DIMS = 384;

type Extractor = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

let loading: Promise<Extractor | null> | null = null;
let failedReason: string | null = null;

function useHash() {
  return process.env.BUREAU_EMBED === 'hash';
}

async function loadModel(): Promise<Extractor | null> {
  if (useHash()) return null;
  loading ??= (async () => {
    try {
      const tf = await import('@huggingface/transformers');
      tf.env.cacheDir = path.join(DATA_DIR, 'models');
      const pipe = await tf.pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
      return pipe as unknown as Extractor;
    } catch (err) {
      failedReason = (err as Error).message;
      return null;
    }
  })();
  return loading;
}

/** Which model embeddings will come from right now, and why the fallback is in use if it is. */
export async function embedStatus(): Promise<{ model: string; fallbackReason: string | null }> {
  const m = await loadModel();
  return { model: m ? MODEL_ID : HASH_MODEL, fallbackReason: m ? null : useHash() ? 'BUREAU_EMBED=hash' : failedReason };
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic bag-of-words-and-bigrams embedding: crude, but stable and offline. */
export function hashEmbed(text: string): Float32Array {
  const v = new Float32Array(DIMS);
  const words = text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? [];
  const grams = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  const counts = new Map<string, number>();
  for (const g of grams) counts.set(g, (counts.get(g) ?? 0) + 1);
  for (const [g, c] of counts) {
    const h = fnv1a(g);
    v[h % DIMS] += (h & 0x80000000 ? -1 : 1) * (1 + Math.log(c));
  }
  return normalize(v);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export async function embed(texts: string[]): Promise<{ model: string; vectors: Float32Array[] }> {
  const clipped = texts.map((t) => t.slice(0, 2000));
  const model = await loadModel();
  if (!model) return { model: HASH_MODEL, vectors: clipped.map(hashEmbed) };
  const vectors: Float32Array[] = [];
  for (let i = 0; i < clipped.length; i += 32) {
    const batch = clipped.slice(i, i + 32);
    const out = await model(batch, { pooling: 'mean', normalize: true });
    const dim = out.dims[out.dims.length - 1];
    for (let j = 0; j < batch.length; j++) vectors.push(Float32Array.from(out.data.subarray(j * dim, (j + 1) * dim)));
  }
  return { model: MODEL_ID, vectors };
}

/** Cosine similarity of two normalised vectors (a dot product). */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

export function toBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export function fromBlob(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b);
  return new Float32Array(copy.buffer);
}

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod/v4';
import { ROOT } from '../config.ts';
import { get, getSetting, now, run } from '../db.ts';
import { AppError } from '../errors.ts';
import { getSecret } from '../security/vault.ts';

/**
 * Every Claude call in Bureau goes through here: one place for the key, model
 * choice per task, refusal handling, server-side fallback, and cost metering.
 */

export const TASKS = [
  // v1
  'profile',
  'score',
  'tailor',
  'audit',
  'scan',
  'capture',
  'apply',
  // v2
  'profile_sync',
  'research',
  'match',
  'evidence',
  'write_cv',
  'write_letter',
  'critic',
  'humanize',
  'form_map',
  'agent_step',
  'recipe_compile',
  'inbox_classify',
  'learning_plan',
  'gap_report',
  'answer_q',
] as const;
export type Task = (typeof TASKS)[number];
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const MODEL_CHOICES = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', input: 4, output: 20, cacheRead: 0.2 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5, cacheRead: 0.01 },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', input: 10, output: 50, cacheRead: 0.25 },
] as const;

const DEFAULT_MODEL = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';

/**
 * Scoring is the high-volume task (dozens of roles per hunt round), so it runs
 * on Haiku 5.5 by default: ~40× cheaper per token, and the two-pass rubric
 * plus code-side weighting keep its judgements consistent. Everything a hiring
 * manager reads stays on Opus 5.5. Each task can be changed in Settings.
 */
export const DEFAULT_MODELS: Record<Task, string> = {
  profile: DEFAULT_MODEL,
  score: HAIKU,
  tailor: DEFAULT_MODEL,
  audit: DEFAULT_MODEL,
  scan: DEFAULT_MODEL,
  capture: DEFAULT_MODEL,
  apply: DEFAULT_MODEL,
  // v2: anything a hiring manager reads is written on Opus; classification and scoring run on Haiku.
  profile_sync: SONNET,
  research: SONNET,
  match: HAIKU,
  evidence: DEFAULT_MODEL,
  write_cv: DEFAULT_MODEL,
  write_letter: DEFAULT_MODEL,
  critic: DEFAULT_MODEL,
  humanize: DEFAULT_MODEL,
  form_map: HAIKU,
  agent_step: SONNET,
  recipe_compile: SONNET,
  inbox_classify: HAIKU,
  learning_plan: DEFAULT_MODEL,
  gap_report: SONNET,
  answer_q: DEFAULT_MODEL,
};
const DEFAULT_EFFORT: Record<Task, Effort> = {
  profile: 'medium',
  score: 'low',
  tailor: 'high',
  audit: 'low',
  scan: 'medium',
  capture: 'low',
  apply: 'medium',
  profile_sync: 'low',
  research: 'medium',
  match: 'low',
  evidence: 'medium',
  write_cv: 'high',
  write_letter: 'high',
  critic: 'medium',
  humanize: 'medium',
  form_map: 'low',
  agent_step: 'low',
  recipe_compile: 'low',
  inbox_classify: 'low',
  learning_plan: 'medium',
  gap_report: 'low',
  answer_q: 'medium',
};

/**
 * Replay mode (BUREAU_REPLAY=1) serves recorded responses from
 * fixtures/claude/<task>/<hash>.json so tests make no API calls; a missing
 * recording fails loudly with its task and hash. BUREAU_RECORD=1 records live
 * responses there (ignored while replaying). The hash covers the task, system
 * prompt and user content, so prompts must not embed timestamps or random ids.
 *
 * BUREAU_REPLAY_DUMP=<dir> additionally writes every missed request to
 * <dir>/<task>/<hash>.request.json (system, content, output schema), so a
 * recording can be written by hand or recorded later. Misses are also kept in
 * `replayMisses()` for test reports.
 */
export const REPLAY = process.env.BUREAU_REPLAY === '1';
const RECORD = process.env.BUREAU_RECORD === '1' && !REPLAY;
export const FIXTURES_DIR = path.resolve(process.env.BUREAU_FIXTURES_DIR ?? path.join(ROOT, 'fixtures'));

interface Recording {
  task: string;
  hash: string;
  model: string;
  usage: Usage;
  output?: unknown;
  text?: string;
  sources?: { url: string; title: string }[];
}

/**
 * Loopback ports are ephemeral (the e2e fixture server binds port 0), so they are
 * not part of the key: `http://127.0.0.1:54573/x` and `…:61002/x` hash alike.
 * Real hosts are never loopback, so production keys are unaffected.
 */
const LOOPBACK_PORT = /(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\b/g;

export function replayHash(task: string, system: SystemBlocks, content: UserContent): string {
  const body = JSON.stringify({ task, system: system.map((b) => b.text), content }).replace(LOOPBACK_PORT, '$1:<port>');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 24);
}

export function recordingPath(task: string, hash: string) {
  return path.join(FIXTURES_DIR, 'claude', task, `${hash}.json`);
}

export interface ReplayMiss {
  task: string;
  hash: string;
  file: string;
  at: string;
}
const misses: ReplayMiss[] = [];

/** Every recording replay mode asked for and did not find, in order (for e2e/selfcheck reports). */
export function replayMisses(): ReplayMiss[] {
  return [...misses];
}

/** Images and documents are replaced by a size note so dumps stay readable. */
function dumpable(content: UserContent): unknown {
  if (typeof content === 'string') return content;
  return content.map((b) => {
    const src = (b as { source?: { type?: string; data?: string } }).source;
    return src?.type === 'base64' && typeof src.data === 'string' ? { ...b, source: { ...src, data: `<${src.data.length} base64 chars>` } } : b;
  });
}

function dumpMiss(task: string, hash: string, system: SystemBlocks, content: UserContent, schema?: z.ZodType) {
  const dir = process.env.BUREAU_REPLAY_DUMP;
  if (!dir) return;
  try {
    let jsonSchema: unknown = null;
    if (schema) {
      try {
        jsonSchema = betaZodOutputFormat(schema);
      } catch {
        jsonSchema = null;
      }
    }
    const file = path.join(path.resolve(dir), task, `${hash}.request.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ task, hash, model: modelFor(task as Task), system: system.map((b) => b.text), content: dumpable(content), outputFormat: jsonSchema, recordTo: path.relative(ROOT, recordingPath(task, hash)) }, null, 2),
    );
  } catch {
    /* a dump is a convenience; never let it mask the real error */
  }
}

function loadRecording(task: string, hash: string, req: { system: SystemBlocks; content: UserContent; schema?: z.ZodType }): Recording {
  const file = recordingPath(task, hash);
  if (!fs.existsSync(file)) {
    misses.push({ task, hash, file: path.relative(ROOT, file), at: new Date().toISOString() });
    dumpMiss(task, hash, req.system, req.content, req.schema);
    throw new AppError(500, 'REPLAY_MISSING', `No recorded Claude response for task "${task}" (hash ${hash}). Record it with BUREAU_RECORD=1 or add ${path.relative(ROOT, file)}.`);
  }
  let rec: Recording;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8')) as Recording;
  } catch {
    throw new AppError(500, 'REPLAY_INVALID', `Recording ${path.relative(ROOT, file)} is not valid JSON.`);
  }
  if (rec.task !== task || rec.hash !== hash) {
    throw new AppError(500, 'REPLAY_INVALID', `Recording ${path.relative(ROOT, file)} says task "${rec.task}" / hash ${rec.hash}; expected "${task}" / ${hash}.`);
  }
  if (!rec.usage || typeof rec.usage.input_tokens !== 'number' || typeof rec.usage.output_tokens !== 'number') {
    throw new AppError(500, 'REPLAY_INVALID', `Recording ${path.relative(ROOT, file)} needs usage.input_tokens and usage.output_tokens.`);
  }
  return rec;
}

function saveRecording(rec: Recording) {
  const file = recordingPath(rec.task, rec.hash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rec, null, 2));
}

export interface AiSettings {
  models: Partial<Record<Task, string>>;
  monthlyBudgetUsd: number;
}

export function aiSettings(): AiSettings {
  return getSetting<AiSettings>('ai', { models: {}, monthlyBudgetUsd: 25 });
}

export function modelFor(task: Task): string {
  const chosen = aiSettings().models[task];
  return MODEL_CHOICES.some((m) => m.id === chosen) ? chosen! : DEFAULT_MODELS[task];
}

let cached: { key: string; client: Anthropic } | null = null;

export function apiKey(): string | null {
  if (process.env.BUREAU_REPLAY === '1') return 'replay';
  return getSecret('anthropic_api_key') ?? process.env.ANTHROPIC_API_KEY ?? null;
}

export function client(): Anthropic {
  const key = apiKey();
  if (!key) throw new AppError(412, 'NO_API_KEY', 'Add your Anthropic API key in Settings to wake the engine.');
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 3, timeout: 10 * 60 * 1000 }) };
  return cached.client;
}

export function resetClient() {
  cached = null;
}

export function monthSpend(): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const row = get<{ total: number }>(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM ai_usage WHERE ts >= ?`, start.toISOString());
  return Number(row?.total ?? 0);
}

function guardBudget() {
  const { monthlyBudgetUsd } = aiSettings();
  if (monthlyBudgetUsd > 0 && monthSpend() >= monthlyBudgetUsd) {
    throw new AppError(402, 'BUDGET', `Monthly AI budget of $${monthlyBudgetUsd} reached. Raise it in Settings to continue.`);
  }
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Tags AI spend with the campaign whose work caused it (A08 wraps each job). */
const aiScope = new AsyncLocalStorage<{ campaignId: string | null }>();
export function withCampaign<T>(campaignId: string | null, fn: () => T): T {
  return aiScope.run({ campaignId }, fn);
}

function meter(task: Task, model: string, usage: Usage) {
  const price = MODEL_CHOICES.find((m) => m.id === model) ?? MODEL_CHOICES[0];
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const cost =
    (usage.input_tokens * price.input +
      cacheWrite * price.input * 1.25 +
      cacheRead * price.cacheRead +
      usage.output_tokens * price.output) /
      1_000_000 +
    searches * 0.01;
  run(
    `INSERT INTO ai_usage (ts, task, model, input_tokens, output_tokens, cache_read, cache_write, web_searches, cost_usd, campaign_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    now(),
    task,
    model,
    usage.input_tokens,
    usage.output_tokens,
    cacheRead,
    cacheWrite,
    searches,
    cost,
    aiScope.getStore()?.campaignId ?? null,
  );
}

function translate(err: unknown): never {
  if (err instanceof AppError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new AppError(401, 'AI_AUTH', 'Anthropic rejected the API key. Check it in Settings.');
  if (err instanceof Anthropic.PermissionDeniedError) throw new AppError(403, 'AI_PERMISSION', 'This API key cannot use the selected model.');
  if (err instanceof Anthropic.RateLimitError) throw new AppError(429, 'AI_RATE', 'Anthropic rate limit hit — Bureau will pick up again shortly.');
  if (err instanceof Anthropic.BadRequestError) throw new AppError(400, 'AI_BAD_REQUEST', `Claude rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) throw new AppError(503, 'AI_OFFLINE', 'Could not reach the Anthropic API. Are you online?');
  if (err instanceof Anthropic.APIError) throw new AppError(502, 'AI_ERROR', `Anthropic API error ${err.status ?? ''}`.trim());
  throw err;
}

export type SystemBlocks = Anthropic.Beta.BetaTextBlockParam[];
export type UserContent = string | Anthropic.Beta.BetaContentBlockParam[];

/** Structured call: returns a value validated against the zod schema. */
export async function structured<S extends z.ZodType>(opts: {
  task: Task;
  system: SystemBlocks;
  content: UserContent;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  guardBudget();
  const model = modelFor(opts.task);
  const hash = REPLAY || RECORD ? replayHash(opts.task, opts.system, opts.content) : '';
  if (REPLAY) {
    const rec = loadRecording(opts.task, hash, { system: opts.system, content: opts.content, schema: opts.schema });
    meter(opts.task, rec.model, rec.usage);
    const parsed = opts.schema.safeParse(rec.output);
    if (!parsed.success) {
      throw new AppError(500, 'REPLAY_INVALID', `Recording ${path.relative(ROOT, recordingPath(opts.task, hash))} does not match the ${opts.task} output schema: ${parsed.error.message.slice(0, 300)}`);
    }
    return parsed.data as z.infer<S>;
  }
  try {
    const res = await client().beta.messages.parse({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: opts.system,
      output_config: { effort: opts.effort ?? DEFAULT_EFFORT[opts.task], format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: 'user', content: opts.content }],
    });
    meter(opts.task, res.model ?? model, res.usage);
    if (res.stop_reason === 'refusal') {
      throw new AppError(422, 'AI_REFUSAL', `Claude declined this request${res.stop_details?.category ? ` (${res.stop_details.category})` : ''}.`);
    }
    if (res.stop_reason === 'max_tokens') throw new AppError(502, 'AI_TRUNCATED', 'Claude ran out of room before finishing. Try again.');
    if (!res.parsed_output) throw new AppError(502, 'AI_PARSE', 'Claude returned something Bureau could not read.');
    if (RECORD) saveRecording({ task: opts.task, hash, model: res.model ?? model, usage: res.usage, output: res.parsed_output });
    return res.parsed_output as z.infer<S>;
  } catch (err) {
    translate(err);
  }
}

/** Free-form call with Anthropic's web search tool, resuming paused turns. Returns the final text. */
export async function research(opts: {
  task: Task;
  system: SystemBlocks;
  prompt: string;
  maxSearches: number;
  blockedDomains?: string[];
}): Promise<{ text: string; sources: { url: string; title: string }[] }> {
  guardBudget();
  const model = modelFor(opts.task);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: opts.prompt }];
  const sources = new Map<string, string>();
  let text = '';
  const hash = REPLAY || RECORD ? replayHash(opts.task, opts.system, opts.prompt) : '';
  if (REPLAY) {
    const rec = loadRecording(opts.task, hash, { system: opts.system, content: opts.prompt });
    meter(opts.task, rec.model, rec.usage);
    return { text: rec.text ?? '', sources: rec.sources ?? [] };
  }
  const total: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  try {
    for (let turn = 0; turn < 5; turn++) {
      const stream = client().beta.messages.stream({
        model,
        max_tokens: 32000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: opts.system,
        output_config: { effort: DEFAULT_EFFORT[opts.task] },
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: opts.maxSearches,
            ...(opts.blockedDomains?.length ? { blocked_domains: opts.blockedDomains } : {}),
          },
        ],
        messages,
      });
      const res = await stream.finalMessage();
      meter(opts.task, res.model ?? model, res.usage);
      total.input_tokens += res.usage.input_tokens;
      total.output_tokens += res.usage.output_tokens;
      for (const block of res.content) {
        if (block.type === 'text') text += block.text;
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === 'web_search_result') sources.set(r.url, r.title);
        }
      }
      if (res.stop_reason === 'refusal') throw new AppError(422, 'AI_REFUSAL', 'Claude declined this search.');
      if (res.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: res.content });
    }
  } catch (err) {
    translate(err);
  }
  const out = { text, sources: [...sources].map(([url, title]) => ({ url, title })) };
  if (RECORD) saveRecording({ task: opts.task, hash, model, usage: total, ...out });
  return out;
}

/** Cheapest possible round-trip to prove a key works. */
export async function pingKey(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const probe = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 });
    await probe.models.retrieve(DEFAULT_MODEL);
    return { ok: true, message: 'Key accepted — Claude Opus 5.5 is available.' };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Anthropic rejected that key.' };
    if (err instanceof Anthropic.NotFoundError) return { ok: true, message: 'Key accepted, but Opus 5.5 is not enabled on it — pick another model.' };
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, message: 'Could not reach Anthropic — check your connection.' };
    return { ok: false, message: 'The key could not be verified.' };
  }
}

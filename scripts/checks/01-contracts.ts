import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Harness } from '../lib/harness.ts';

/** Phase 0 contracts: schema shapes, migrations, the pipeline state machine, claims, replay mode, embeddings. */
export default async function contracts({ check, section }: Harness) {
  const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
  const { db, now, run } = await import('../../server/db.ts');
  const { MatchResultSchema } = await import('../../server/contracts/match.ts');
  const { EvidenceMapSchema, CriticResultSchema, ApplicationPacketSchema } = await import('../../server/contracts/writer.ts');
  const { AgentActionSchema, TraceSchema } = await import('../../server/contracts/agent.ts');
  const { ClassifiedMessageSchema } = await import('../../server/contracts/inbox.ts');
  const { LearningPlanSchema, GapReportSchema } = await import('../../server/contracts/learning.ts');
  const { ResearchBriefSchema } = await import('../../server/contracts/research.ts');
  const { CampaignConfigSchema, PIPELINE_STATES, TRANSITIONS } = await import('../../server/contracts/campaign.ts');
  const { transition, pipelineState, canTransition } = await import('../../server/campaign/pipeline.ts');
  const { claimJob, activeClaim, releaseClaim } = await import('../../server/campaign/claims.ts');
  const { structured, replayHash, TASKS, DEFAULT_MODELS } = await import('../../server/ai/claude.ts');
  const { taskCost } = await import('../../server/ai/cost.ts');
  const { embed, cosine, toBlob, fromBlob } = await import('../../server/ai/embed.ts');

  section('Contracts');
  for (const [name, schema] of Object.entries({
    MatchResultSchema,
    EvidenceMapSchema,
    CriticResultSchema,
    AgentActionSchema,
    ClassifiedMessageSchema,
    LearningPlanSchema,
    GapReportSchema,
    ResearchBriefSchema,
  })) {
    await check(`${name} converts to a structured-output format`, () => {
      assert.ok(JSON.stringify(betaZodOutputFormat(schema)).length > 50);
    });
  }
  await check('trace, packet and campaign schemas parse a minimal value', () => {
    TraceSchema.parse({ jobId: null, applicationId: null, origin: 'internal', url: 'https://x', ats: null, steps: [], outcome: 'verified', startedAt: now(), finishedAt: now() });
    ApplicationPacketSchema.parse({
      applicationId: 'a',
      jobId: 'j',
      cvPdfPath: '',
      letterPdfPath: '',
      subject: '',
      coverLetter: '',
      shortAnswers: {},
      outreach: '',
      quality: { critic: { score: 8, scores: { specificity: 8, evidence: 8, voice: 8, clarity: 8, ask: 8, aiTells: 8 }, demands: [] }, lint: { pass: true, checks: [] }, truth: { pass: true, issues: [] } },
    });
    CampaignConfigSchema.parse({
      startsAt: now(),
      endsAt: now(),
      roles: [],
      categories: ['web'],
      locations: [],
      remoteOnly: true,
      stretchLevel: 'balanced',
      minScore: 60,
      dailyCap: 10,
      companyCooldownDays: 30,
      activeHours: { tz: 'Asia/Karachi', start: '09:00', end: '18:00' },
      pacingMinutes: { min: 8, max: 25 },
      budgetUsd: 20,
      dryRunDays: 2,
      channels: { email: true, forms: true, agent: true },
      sources: {},
    });
  });
  await check('every pipeline state has a transition list', () => {
    for (const s of PIPELINE_STATES) assert.ok(Array.isArray(TRANSITIONS[s]), s);
    assert.equal(TRANSITIONS.submitted.length, 0);
  });

  section('Migrations');
  await check('v2 tables exist', () => {
    const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    for (const t of ['campaigns', 'pipeline', 'companies', 'job_embeddings', 'profile_facts', 'voice_bank', 'answer_bank', 'unknown_questions', 'learning_list', 'research_briefs', 'letter_variants', 'form_recipes', 'agent_traces', 'site_accounts', 'api_keys', 'api_audit', 'inbox_messages', 'learning_plans', 'gap_reports', 'digests', 'outcomes', 'claims']) {
      assert.ok(names.has(t), t);
    }
  });

  section('Pipeline state machine');
  const jobId = crypto.randomUUID();
  run(
    `INSERT INTO jobs (id, fingerprint, source, url, title, company, category, found_at, updated_at) VALUES (?, ?, 'test', 'https://example.com/j', 'Engineer', 'Acme', 'web', ?, ?)`,
    jobId,
    jobId,
    now(),
    now(),
  );
  await check('a job enters at found and walks the happy path', () => {
    for (const s of ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'verified', 'submitted'] as const) transition(jobId, s);
    assert.equal(pipelineState(jobId)?.state, 'submitted');
  });
  await check('submitted is terminal: nothing can re-open it', () => {
    assert.throws(() => transition(jobId, 'filling'), /cannot move/);
    assert.throws(() => transition(jobId, 'selected'), /cannot move/);
  });
  await check('re-entering the current state is a no-op', () => assert.equal(transition(jobId, 'submitted').state, 'submitted'));
  await check('illegal jumps are refused', () => {
    assert.equal(canTransition('found', 'submitted'), false);
    assert.equal(canTransition(null, 'selected'), false);
  });

  section('Claims');
  await check('one holder at a time; expiry frees the job', () => {
    assert.ok(claimJob('job-x', 'autopilot', 20));
    assert.equal(claimJob('job-x', 'external:k1', 20), null);
    releaseClaim('job-x', 'autopilot');
    assert.ok(claimJob('job-x', 'external:k1', 20));
    assert.equal(activeClaim('job-x')?.holder, 'external:k1');
  });

  section('Claude layer');
  await check('every v2 task has a default model and a cost estimate', () => {
    for (const t of TASKS) {
      assert.ok(DEFAULT_MODELS[t], t);
      assert.ok(taskCost(t).usd > 0, t);
    }
    assert.equal(DEFAULT_MODELS.match, 'claude-haiku-5-5');
    assert.equal(DEFAULT_MODELS.inbox_classify, 'claude-haiku-5-5');
    assert.equal(DEFAULT_MODELS.write_letter, 'claude-opus-5-5');
  });
  await check('replay mode fails loudly with the task and hash when a recording is missing', async () => {
    const { z } = await import('zod/v4');
    const system = [{ type: 'text' as const, text: 'selfcheck' }];
    const hash = replayHash('critic', system, 'no such recording');
    await assert.rejects(structured({ task: 'critic', system, content: 'no such recording', schema: z.object({ a: z.string() }) }), new RegExp(hash));
  });

  section('Embeddings');
  await check('similar postings embed closer than unrelated ones', async () => {
    const { vectors } = await embed(['Senior React engineer, TypeScript, remote', 'Remote TypeScript React developer (senior)', 'Warehouse forklift operator, night shift']);
    assert.ok(cosine(vectors[0], vectors[1]) > cosine(vectors[0], vectors[2]));
  });
  await check('vectors round-trip through a BLOB', async () => {
    const { vectors } = await embed(['round trip']);
    assert.deepEqual(Array.from(fromBlob(toBlob(vectors[0]))), Array.from(vectors[0]));
  });
}

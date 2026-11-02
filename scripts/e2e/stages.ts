/**
 * Every e2e stage, written against the contracts in server/contracts/. Each
 * one lights up as its owner's module merges; until then it reports pending
 * and the downstream stages run on fixture fallbacks (seeded jobs, fixture
 * packets) so they don't wait on each other.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { simpleParser } from 'mailparser';
import type { FixtureServer } from '../fixture-server.ts';
import { bus, type BusEvent } from '../../server/services/bus.ts';
import { get, now, run, setSetting } from '../../server/db.ts';
import { canTransition, pipelineState, transition } from '../../server/campaign/pipeline.ts';
import { activeClaim, claimJob, releaseClaim } from '../../server/campaign/claims.ts';
import { MatchResultSchema } from '../../server/contracts/match.ts';
import { ApplicationPacketSchema, type ApplicationPacket } from '../../server/contracts/writer.ts';
import { FillOutcomeSchema, type FillOutcome } from '../../server/contracts/forms.ts';
import { ClassifiedMessageSchema } from '../../server/contracts/inbox.ts';
import { LearningPlanSchema } from '../../server/contracts/learning.ts';
import type { CampaignConfig, PipelineState } from '../../server/contracts/campaign.ts';
import { CONNECTORS } from '../../server/sources/index.ts';
import { checkExpectations } from './expect.ts';
import { FIXTURES, ROOT, loadExpected, type FormSpec } from './manifest.ts';
import { feedResolver, installFetchReplay, loadFeedIndex } from './fetch-replay.ts';
import { advanceTo, campaignConfig, countRows, fallbackPacket, formJob, insertCampaign, insertJob, pointJobAt, rows, seedProfile, stateOf } from './seed.ts';
import { PendingError, errText, pendingReason, type Stage, type StageApi } from './runner.ts';
import { spawnTs, startServer, waitUntil, type Proc } from './procs.ts';
import { goldenCtx } from './golden.ts';

export interface E2EContext {
  fx: FixtureServer;
  sandbox: string;
  dataDir: string;
  strict: boolean;
  headful: boolean;
  /** Env every child process inherits (replay, embeddings, fixture origins, master key). */
  childEnv: Record<string, string>;
  campaignId: string;
  cfg: CampaignConfig;
  /** formId → jobId */
  jobs: Map<string, string>;
  blockerJobId: string | null;
  packets: Map<string, ApplicationPacket>;
  rehearsals: Map<string, FillOutcome>;
  submits: Map<string, FillOutcome>;
  events: BusEvent[];
  fetchReplay: boolean;
  feedMisses: string[];
  /** formIds whose job came from the scout rather than the seed fallback. */
  scouted: Set<string>;
  mailBridge: { available: boolean; delivered: number; errors: string[] };
}

type Mod = Record<string, unknown>;

/**
 * Harness self-test only (`npm run e2e -- --fakes`): stand-in modules keyed by
 * repo path (e.g. 'server/forms/index.ts'), used to prove the stage assertions
 * themselves before the real modules exist. Never used for acceptance.
 */
export const FAKES: Record<string, Mod> = {};
const imp = (p: string): Promise<Mod> => {
  const key = p.replace(/^(\.\.\/)+/, '');
  return FAKES[key] ? Promise.resolve(FAKES[key]) : (import(p) as Promise<Mod>);
};

/** An export that a pending contract request adds; null until it merges. */
async function optionalExport<T>(candidates: [string, string][]): Promise<T | null> {
  for (const [file, name] of candidates) {
    if (typeof FAKES[file]?.[name] === 'function') return FAKES[file][name] as T;
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const mod = await imp(`../../${file}`);
    if (typeof mod[name] === 'function') return mod[name] as T;
  }
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
}

/** An item's error → pending (not built / not recorded / contract hook missing) or fail. */
function itemFromError(s: StageApi, name: string, err: unknown) {
  const msg = errText(err);
  const p = pendingReason(err);
  if (p) return s.item(name, 'pending', p);
  if (/blockedbyclient|BLOCKED_BY_CLIENT/i.test(msg)) {
    return s.item(name, 'pending', 'the guarded browser refuses the loopback fixture origins (BUREAU_FIXTURE_ORIGINS, requests/A11.md §2)');
  }
  return s.item(name, 'fail', msg);
}

function forms(ctx: E2EContext, filter: (f: FormSpec) => boolean = () => true): FormSpec[] {
  return ctx.fx.manifest.forms.filter(filter);
}

/** Move a job after a fill outcome through legal transitions, tolerating a module that already moved it. */
function settle(jobId: string, outcome: FillOutcome) {
  const path: PipelineState[] =
    outcome.status === 'submitted'
      ? ['verified', 'submitted']
      : outcome.status === 'rehearsed'
        ? ['verified', 'rehearsed']
        : outcome.status === 'needs_you'
          ? ['needs_you']
          : outcome.status === 'skipped'
            ? ['skipped']
            : ['failed'];
  for (const s of path) {
    const cur = stateOf(jobId);
    if (cur === s || !cur || !canTransition(cur, s)) continue;
    transition(jobId, s, { reason: `e2e: fill outcome ${outcome.status}` });
  }
}

function ensurePdf(file: string, what: string) {
  assert.ok(fs.existsSync(file), `${what} missing at ${file}`);
  assert.equal(fs.readFileSync(file).subarray(0, 5).toString('latin1'), '%PDF-', `${what} is not a PDF`);
}

// ───────────────────────────────────────────────────────────────── stages

export const seed: Stage<E2EContext> = {
  id: 'seed',
  title: 'Seed: sandbox, fictional candidate, voice bank, answer bank, learning list',
  run: async (ctx, s) => {
    const n = seedProfile();
    assert.ok(n.voice >= 6 && n.voice <= 10, 'voice bank holds 6–10 passages');
    s.note(`profile + ${n.facts} facts, ${n.voice} voice passages, ${n.answers} answers, ${n.learning} learning items`);
    bus.on('event', (e: BusEvent) => ctx.events.push(e));
    s.note('listening to the event bus');
    ctx.campaignId = insertCampaign('E2E campaign', ctx.cfg);
    s.note(`campaign ${ctx.campaignId} created (draft)`);
  },
};

export const profile: Stage<E2EContext> = {
  id: 'profile',
  title: 'Profile (A03): master profile, answer bank, learning list',
  needs: ['seed'],
  run: async (_ctx, s) => {
    const p = await imp('../../server/profile/index.ts');
    const mp = (p.loadMasterProfile as () => import('../../server/contracts/profile.ts').MasterProfile | null)();
    assert.ok(mp, 'loadMasterProfile() returned null after seeding');
    assert.equal(mp.name, 'Rania Haroon');
    assert.ok(mp.voiceBank.length === 8, `voice bank has ${mp.voiceBank.length}`);
    assert.ok(mp.answerBank.length >= 25, `answer bank has ${mp.answerBank.length}`);
    assert.ok(mp.facts.every((f) => f.source && f.sourceRef !== undefined), 'every fact keeps its source');
    s.note('loadMasterProfile() returns the seeded candidate with sources on every fact');
    const skills = (p.learningSkills as () => string[])();
    assert.deepEqual([...skills].sort(), ['Go', 'Kubernetes'], 'only status=learning skills may reach a CV');
    s.note('learningSkills() = Go, Kubernetes (queued/done excluded)');
    const ans = await (p.answerFor as (q: string, c?: object) => Promise<{ value: string } | null>)('What is your notice period?', {});
    assert.equal(ans?.value, '2 weeks');
    const para = await (p.answerFor as (q: string, c?: object) => Promise<{ value: string } | null>)('How soon could you join us? Notice period', {});
    assert.equal(para?.value, '2 weeks', 'paraphrased notice-period question');
    s.note('answerFor() resolves exact and paraphrased questions from the bank');
    const fp = (p.styleFingerprint as () => { passages: number } | null)();
    assert.ok(fp && fp.passages === 8, 'style fingerprint computed from the voice bank');
    s.note('style fingerprint computed');
  },
};

export const campaign: Stage<E2EContext> = {
  id: 'campaign',
  title: 'Campaign (A08): create and start',
  needs: ['seed'],
  run: async (ctx, s) => {
    const c = await imp('../../server/campaign/index.ts');
    await (c.startCampaign as (id: string) => Promise<void>)(ctx.campaignId);
    const row = get<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', ctx.campaignId);
    assert.equal(row?.status, 'active');
    assert.ok(ctx.events.some((e) => e.type === 'campaign.status' && e.campaignId === ctx.campaignId && e.status === 'active'), 'campaign.status event');
    s.note('startCampaign() → active, campaign.status emitted');
    // The e2e drives each step itself; pause the scheduler so it doesn't race us.
    await (c.pauseCampaign as (id: string) => Promise<void>)(ctx.campaignId);
    assert.equal(get<{ status: string }>('SELECT status FROM campaigns WHERE id = ?', ctx.campaignId)?.status, 'paused');
    s.note('pauseCampaign() → paused (the e2e drives each step itself from here)');
    // startCampaign() kicks off a scout + match tick in the background; let it finish (offline, it finds
    // nothing) so it can't race the scout stage and make the job set, and every prompt after it, vary.
    const engine = typeof c.getEngine === 'function' ? (c.getEngine as () => { settle?: () => Promise<void> })() : null;
    if (engine?.settle) {
      await withTimeout(engine.settle(), 120_000, 'the background tick after startCampaign');
      s.note('the background tick startCampaign() started has settled');
    }
  },
};

/** Map a scouted job to a replica form by its apply URL. */
function formForUrl(ctx: E2EContext, url: string | null): FormSpec | null {
  if (!url) return null;
  const rel = url.startsWith(ctx.fx.originA) ? url.slice(ctx.fx.originA.length) : url.replace(/^https?:\/\//, '/');
  return ctx.fx.manifest.forms.find((f) => f.ats !== 'widget' && (rel.startsWith(f.route) || f.route.startsWith(rel.replace(/\/(apply|application)\/?$/, '')))) ?? null;
}

export const scout: Stage<E2EContext> = {
  id: 'scout',
  title: 'Scout (A01): fixture feeds → resolve → dedupe → ghost/scam filter',
  needs: ['seed'],
  run: async (ctx, s) => {
    ctx.fetchReplay = await installFetchReplay(
      feedResolver('e2e', { ORIGIN_A: ctx.fx.originA, ORIGIN_B: ctx.fx.originB }, { onMiss: (u) => ctx.feedMisses.push(u) }),
    );
    if (!ctx.fetchReplay) s.pending('safeFetch has no replay hook yet (requests/A11.md §1), and the e2e never goes online');
    s.note('safeFetch replay installed (e2e feed set; anything else is refused)');
    setSetting('sources', {
      enabled: Object.fromEntries(CONNECTORS.map((c) => [c.id, c.id !== 'reddit'])),
      boards: { greenhouse: ['lumenledger', 'harborpine', 'orchardrobotics', 'sentineldefense'], lever: ['northwind-labs'], ashby: ['quillstack'] },
      extraKeywords: [],
      maxAgeDays: 30,
    });
    // Registry entries for the ATS families A01 adds (its registry reads companies).
    const reg: [string, string, string, string][] = [
      ['workable', 'brightwater-health', 'Brightwater Health', 'brightwaterhealth.example.com'],
      ['smartrecruiters', 'MeridianFreight', 'Meridian Freight', 'meridianfreight.example.com'],
      ['recruitee', 'tulipandtern', 'Tulip & Tern', 'tulipandtern.example.com'],
      ['personio', 'kranich', 'Kranich Software GmbH', 'kranich.example.com'],
      ['teamtailor', 'saffronstudio', 'Saffron Studio', 'saffronstudio.example.com'],
      ['bamboohr', 'copperline', 'Copperline Payments', 'copperline.example.com'],
      ['breezy', 'pebble-analytics', 'Pebble Analytics', 'pebbleanalytics.example.com'],
      ['workday', 'atlasmutual|wd5|AtlasCareers', 'Atlas Mutual', 'atlasmutual.example.com'],
    ];
    for (const [ats, token, name, domain] of reg) {
      run('INSERT OR IGNORE INTO companies (id, name, domain, ats, ats_token, discovered_via, status) VALUES (?, ?, ?, ?, ?, ?, ?)', `e2e-${ats}`, name, domain, ats, token, 'e2e', 'active');
    }
    const sc = await imp('../../server/scout/index.ts');
    const res = await (sc.runScout as (o: object) => Promise<{ found: number; added: string[] }>)({ campaignId: ctx.campaignId });
    assert.ok(res.found > 0 && res.added.length > 0, `scout found ${res.found}, added ${res.added.length}`);
    s.note(`runScout(): found ${res.found}, added ${res.added.length}`);
    const idx = loadFeedIndex();
    const dup = rows<{ id: string }>('SELECT id FROM jobs WHERE company = ? AND title LIKE ?', idx.dedupe.company, `${idx.dedupe.title}%`);
    assert.equal(dup.length, 1, `dedupe: ${idx.dedupe.company} "${idx.dedupe.title}" from ${idx.dedupe.sources.join('/')} should be 1 job, got ${dup.length}`);
    s.note(`dedupe: the ${idx.dedupe.sources.length}-source triple collapsed to 1 job`);
    for (const id of res.added) assert.ok(pipelineState(id), `job ${id} entered the pipeline`);
    s.note('every new job entered the pipeline');
    const scam = get<{ legitimacy: string | null }>("SELECT legitimacy FROM jobs WHERE company LIKE 'GlobalTech%'");
    if (scam) assert.equal(scam.legitimacy, 'scam', 'the fee-charging posting is flagged scam');
    const stale = get<{ legitimacy: string | null; id: string }>("SELECT legitimacy, id FROM jobs WHERE company LIKE 'Fernhill%'");
    if (stale) assert.ok(stale.legitimacy === 'ghost' || stateOf(stale.id) === 'skipped', 'the 90-day-old posting is ghost/skipped');
    s.note('scam and stale postings are marked (or never inserted)');
    const resolved = rows<{ id: string; apply_url_canonical: string | null; url: string; company: string }>('SELECT id, apply_url_canonical, url, company FROM jobs');
    for (const j of resolved) {
      const f = formForUrl(ctx, j.apply_url_canonical) ?? formForUrl(ctx, j.url);
      if (f && !ctx.jobs.has(f.id)) {
        ctx.jobs.set(f.id, j.id);
        ctx.scouted.add(f.id);
      }
    }
    s.note(`${ctx.scouted.size} replica employers reached through scouting (${[...ctx.scouted].join(', ')})`);
    if (ctx.feedMisses.length) s.note(`unmatched feed URLs refused: ${ctx.feedMisses.length}`);
  },
};

/** Fallback for a pending scout, and for widget pages no feed lists: one job per form. */
export const jobs: Stage<E2EContext> = {
  id: 'jobs',
  title: 'Jobs: every fixture form has a job pointing at its replica',
  needs: ['seed'],
  run: async (ctx, s) => {
    for (const f of forms(ctx)) {
      const meta = formJob(f);
      let id = ctx.jobs.get(f.id);
      if (!id) {
        id = insertJob({ fingerprint: `e2e:${f.id}`, title: meta.title, company: meta.company, url: ctx.fx.url(f.id), ats: f.ats, campaignId: ctx.campaignId });
        ctx.jobs.set(f.id, id);
      }
      pointJobAt(id, ctx.fx.url(f.id));
      run('UPDATE pipeline SET campaign_id = COALESCE(campaign_id, ?) WHERE job_id = ?', ctx.campaignId, id);
    }
    const blocker = get<{ id: string }>("SELECT id FROM jobs WHERE company = 'Sentinel Defense Systems'");
    ctx.blockerJobId =
      blocker?.id ??
      insertJob({
        fingerprint: 'e2e:sentinel-blocker',
        title: 'Junior Software Engineer',
        company: 'Sentinel Defense Systems',
        url: `${ctx.fx.originA}/boards.greenhouse.io/sentineldefense/jobs/6600123`,
        ats: 'greenhouse',
        campaignId: ctx.campaignId,
        description:
          'Junior Software Engineer, on-site in Huntsville, AL. You must hold an active US Secret security clearance and be a US citizen; this is a legal requirement of the contract. TypeScript and Node.js experience preferred.',
      });
    s.note(`${ctx.jobs.size} form jobs (${ctx.scouted.size} scouted, ${ctx.jobs.size - ctx.scouted.size} seeded) + the clearance-blocker job`);
  },
};

export const match: Stage<E2EContext> = {
  id: 'match',
  title: 'Match (A02): screen-pass scores, stretch, blockers, selection',
  needs: ['jobs'],
  run: async (ctx, s) => {
    const m = await imp('../../server/match/index.ts');
    const ids = [...ctx.jobs.values(), ctx.blockerJobId!].filter(Boolean);
    try {
      const results = (await (m.matchJobs as (ids: string[], cfg: CampaignConfig) => Promise<unknown[]>)(ids, ctx.cfg)).map((r) => MatchResultSchema.parse(r));
      assert.ok(results.length >= ids.length - 1, `matchJobs returned ${results.length} results for ${ids.length} jobs`);
      s.note(`matchJobs(): ${results.length} MatchResults, all schema-valid`);
      const b = results.find((r) => r.jobId === ctx.blockerJobId);
      assert.ok(b, 'blocker job was assessed');
      // The posting is on-site in Huntsville, so A02's location filter skips it before
      // Claude reads the clearance; a hard-filter skip is the stronger cap. Claude's own
      // blocker judgement is covered by a02-match's offline checks.
      const hardSkip = b.decision === 'skipped' && b.reason.startsWith('filter:');
      assert.ok(hardSkip || (b.stretch.blockers.length > 0 && (b.screenPassScore <= 35 || b.decision === 'skipped')), `clearance blocker: score ${b.screenPassScore}, blockers ${b.stretch.blockers.join(';')}, reason ${b.reason}`);
      s.note(hardSkip ? `true blocker skipped before scoring (${b.reason})` : `true blocker (clearance) capped: score ${b.screenPassScore}`);
      const hp = results.find((r) => r.jobId === ctx.jobs.get('greenhouse-jobboards'));
      if (hp) {
        assert.equal(hp.inflatedPosting, true, 'Harbor & Pine "entry level, 5+ years" is recognised as inflated');
        s.note('inflated entry-level posting recognised');
      }
      const again = (await (m.matchJobs as (ids: string[], cfg: CampaignConfig) => Promise<unknown[]>)([ctx.jobs.get('greenhouse-classic')!], ctx.cfg)).map((r) => MatchResultSchema.parse(r));
      const first = results.find((r) => r.jobId === ctx.jobs.get('greenhouse-classic'));
      if (first && again[0]) assert.equal(again[0].screenPassScore, first.screenPassScore, 'same inputs, same score');
      s.note('scoring is repeatable');
      const selected = (m.selectForCampaign as (cfg: CampaignConfig, id: string, n: number) => string[])(ctx.cfg, ctx.campaignId, 100);
      assert.ok(selected.includes(ctx.jobs.get('greenhouse-classic')!), 'the strong match (Lumen Ledger) is selected');
      assert.ok(!selected.includes(ctx.blockerJobId!), 'the blocker is not selected');
      s.note(`selectForCampaign(): ${selected.length} selected`);
    } finally {
      // Whatever the matcher decided, every replica gets filled: re-queue anything else (skipped → selected is legal).
      for (const [formId, id] of ctx.jobs) {
        try {
          advanceTo(id, 'selected', `e2e: fill coverage (${formId})`);
        } catch {
          /* already past selected */
        }
      }
      if (ctx.blockerJobId && ['found', 'filtered', 'scored'].includes(stateOf(ctx.blockerJobId) ?? '')) {
        advanceTo(ctx.blockerJobId, 'skipped', 'e2e: blocker');
      }
    }
  },
};

export const write: Stage<E2EContext> = {
  id: 'write',
  title: 'Write (A04): packets pass critic ≥ 8, lint and truth lock; PDFs render',
  needs: ['jobs'],
  run: async (ctx, s) => {
    const w = await imp('../../server/writer/index.ts');
    const atsForms = forms(ctx, (f) => f.ats !== 'widget');
    let writerBuilt = true;
    for (const f of atsForms) {
      const jobId = ctx.jobs.get(f.id)!;
      if (!writerBuilt) break;
      try {
        const res = (await withTimeout((w.writeApplication as (j: string, c: string) => Promise<unknown>)(jobId, ctx.campaignId), 300_000, 'writeApplication')) as ApplicationPacket | { skipped: string };
        if ('skipped' in res) {
          s.item(f.id, 'fail', `writer skipped a fixture job: ${res.skipped}`);
          continue;
        }
        const pkt = ApplicationPacketSchema.parse(res);
        assert.ok(pkt.quality.critic.score >= 8, `critic ${pkt.quality.critic.score}`);
        assert.ok(pkt.quality.lint.pass, 'lint failed');
        assert.ok(pkt.quality.truth.pass, 'truth lock failed');
        ensurePdf(pkt.cvPdfPath, 'CV PDF');
        ensurePdf(pkt.letterPdfPath, 'letter PDF');
        const variants = countRows('letter_variants', 'application_id = ?', pkt.applicationId);
        const chosen = countRows('letter_variants', 'application_id = ? AND chosen = 1', pkt.applicationId);
        assert.ok(variants >= 3 && chosen === 1, `${variants} variants, ${chosen} chosen`);
        assert.equal(stateOf(jobId), 'written');
        ctx.packets.set(f.id, pkt);
        s.item(f.id, 'pass', `critic ${pkt.quality.critic.score}, ${variants} variants`);
      } catch (err) {
        if (pendingReason(err) && (err as Error).name === 'NotImplemented') writerBuilt = false;
        itemFromError(s, f.id, err);
      }
    }
    // Fallback packets for anything the writer didn't produce (and every widget page).
    let fallback = 0;
    for (const f of forms(ctx)) {
      if (ctx.packets.has(f.id)) continue;
      const jobId = ctx.jobs.get(f.id)!;
      advanceTo(jobId, 'written', 'e2e: fixture packet');
      ctx.packets.set(f.id, fallbackPacket(jobId, ctx.campaignId, ctx.sandbox));
      fallback++;
    }
    if (fallback) s.note(`${fallback} fixture packets stand in where the writer is pending or not exercised (widget pages)`);
  },
};

async function fill(ctx: E2EContext, f: FormSpec, submit: boolean): Promise<FillOutcome> {
  const forms = await imp('../../server/forms/index.ts');
  const jobId = ctx.jobs.get(f.id)!;
  const cur = stateOf(jobId);
  if (cur !== 'filling') advanceTo(jobId, 'written', 'e2e: queue fill');
  transition(jobId, 'filling', { reason: submit ? 'e2e: live submit' : 'e2e: rehearse' });
  const packet = ctx.packets.get(f.id)!;
  const res = await withTimeout(
    (forms.fillApplication as (p: ApplicationPacket, o: object) => Promise<unknown>)(packet, { submit, headful: ctx.headful, campaignId: ctx.campaignId, onUnknown: 'skip' }),
    f.login ? 240_000 : 120_000,
    `fillApplication(${f.id})`,
  );
  const outcome = FillOutcomeSchema.parse(res);
  settle(jobId, outcome);
  return outcome;
}

function finals(ctx: E2EContext, formId: string, sinceSeq = 0) {
  return ctx.fx.submissions({ formId, final: true }).filter((x) => x.seq > sinceSeq);
}

export const rehearse: Stage<E2EContext> = {
  id: 'rehearse',
  title: 'Fill + verify, rehearsal (A05/A06): every replica filled, verified, never submitted',
  needs: ['write'],
  run: async (ctx, s) => {
    let builtChecked = false;
    for (const f of forms(ctx)) {
      const before = ctx.fx.submissions({ formId: f.id }).at(-1)?.seq ?? 0;
      try {
        const out = await fill(ctx, f, false);
        builtChecked = true;
        ctx.rehearsals.set(f.id, out);
        assert.equal(finals(ctx, f.id, before).length, 0, 'a rehearsal posted a final submission');
        if (f.expectedOutcome === 'submitted') {
          assert.equal(out.status, 'rehearsed', `status ${out.status}: ${out.reason}`);
          assert.ok(out.verified, `not verified: ${out.reason}`);
          const okFields = out.fieldLog.filter((e) => e.ok).length;
          const ratio = out.fieldLog.length ? okFields / out.fieldLog.length : 0;
          assert.ok(ratio >= 0.95, `verified-fill ${(ratio * 100).toFixed(0)}% < 95% (${out.fieldLog.filter((e) => !e.ok).map((e) => e.label).slice(0, 4).join(', ')})`);
          assert.ok(out.shots.length >= 1 || out.shotPath, 'no step screenshots');
          s.item(f.id, 'pass', `rehearsed via ${out.via ?? '?'}; ${okFields}/${out.fieldLog.length} fields verified; ${out.shots.length} shots`);
        } else if (f.expectedOutcome === 'needs_you') {
          assert.equal(out.status, 'needs_you', `CAPTCHA page should park as needs_you, got ${out.status}`);
          s.item(f.id, 'pass', 'CAPTCHA detected → needs_you, nothing submitted');
        } else {
          assert.ok(!out.verified && out.status !== 'rehearsed', `verify trap passed verification (${out.status})`);
          s.item(f.id, 'pass', `read-back caught the trap → ${out.status}`);
        }
      } catch (err) {
        if (!builtChecked && (err as Error).name === 'NotImplemented') s.pending(errText(err));
        itemFromError(s, f.id, err);
      }
    }
  },
};

export const submit: Stage<E2EContext> = {
  id: 'submit',
  title: 'Live submit against the fixture server: exactly what was sent, once',
  needs: ['write'],
  run: async (ctx, s) => {
    const data = loadExpected();
    let firstSubmitted: FormSpec | null = null;
    let builtChecked = false;
    for (const f of forms(ctx)) {
      const before = ctx.fx.submissions({ formId: f.id }).at(-1)?.seq ?? 0;
      try {
        const out = await fill(ctx, f, true);
        builtChecked = true;
        ctx.submits.set(f.id, out);
        const got = finals(ctx, f.id, before);
        if (f.expectedOutcome !== 'submitted') {
          assert.equal(got.filter((x) => x.valid).length, 0, 'a valid submission went out');
          assert.notEqual(out.status, 'submitted');
          s.item(f.id, 'pass', `refused to submit (${out.status})`);
          continue;
        }
        assert.equal(out.status, 'submitted', `status ${out.status}: ${out.reason}`);
        assert.ok(out.verified, 'submitted without verified:true');
        assert.equal(got.length, 1, `${got.length} final submissions recorded (want exactly 1)`);
        const sub = got[0];
        assert.ok(sub.valid, `server rejected it: ${sub.errors.join('; ')}`);
        assert.ok(!sub.flags.length, `flags: ${sub.flags.join(',')}`);
        const exp = checkExpectations(f, sub, data);
        const bad = exp.filter((e) => !e.ok);
        const hard = bad.filter((e) => /^(profile:|file:)/.test(e.rule) || e.rule === 'empty');
        const ratio = (exp.length - bad.length) / Math.max(1, exp.length);
        assert.ok(!hard.length && ratio >= 0.95, `expectations ${exp.length - bad.length}/${exp.length}; wrong: ${bad.slice(0, 4).map((e) => `${e.key}=${e.got || '∅'} (${e.rule})`).join('; ')}`);
        assert.equal(stateOf(ctx.jobs.get(f.id)!), 'submitted');
        firstSubmitted ??= f;
        s.item(f.id, 'pass', `submitted; ${exp.length - bad.length}/${exp.length} expected values exact`);
      } catch (err) {
        if (!builtChecked && (err as Error).name === 'NotImplemented') s.pending(errText(err));
        itemFromError(s, f.id, err);
      }
    }
    const canaries = ctx.fx.submissions().filter((x) => x.flags.includes('injection_canary') || x.flags.includes('honeypot'));
    assert.equal(canaries.length, 0, `prompt-injection canary or honeypot reached a form: ${canaries.map((c) => c.formId).join(', ')}`);
    s.note('no injection canary or honeypot value in any submission');
    if (firstSubmitted) {
      const jobId = ctx.jobs.get(firstSubmitted.id)!;
      const before = finals(ctx, firstSubmitted.id).length;
      assert.throws(() => transition(jobId, 'filling'), /cannot move/, 'submitted must be terminal');
      try {
        const forms = await imp('../../server/forms/index.ts');
        await (forms.fillApplication as (p: ApplicationPacket, o: object) => Promise<unknown>)(ctx.packets.get(firstSubmitted.id)!, { submit: true, campaignId: ctx.campaignId });
      } catch {
        /* refusing loudly is fine */
      }
      assert.equal(finals(ctx, firstSubmitted.id).length, before, 'a second fill of a submitted job reached the employer');
      s.note(`no double submit: re-running ${firstSubmitted.id} sent nothing`);
    }
  },
};

export const inbox: Stage<E2EContext> = {
  id: 'inbox',
  title: 'Inbox (A09): drop the interview .eml, classify, link, update stage',
  needs: ['jobs'],
  run: async (ctx, s) => {
    const ingest = await optionalExport<(raw: Buffer | string) => Promise<unknown>>([
      ['server/inbox/index.ts', 'ingestRaw'],
      ['server/inbox/ingest.ts', 'ingestRaw'],
    ]);
    if (!ingest) return s.pending('server/inbox has no ingestRaw(raw) yet (requests/A11.md §3); .eml fixtures need it to enter without IMAP');
    const lumenApp = get<{ id: string }>("SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company = 'Lumen Ledger' ORDER BY a.created_at DESC");
    assert.ok(lumenApp, 'there is a Lumen Ledger application to link to');
    run("UPDATE applications SET status = 'sent', sent_at = ? WHERE id = ? AND sent_at IS NULL", now(), lumenApp.id);
    const raw = fs.readFileSync(path.join(FIXTURES, 'mail', 'interview-lumen-ledger-calendly.eml'));
    await ingest(raw);
    const msg = get<{ class: string; application_id: string | null; data: string }>("SELECT class, application_id, data FROM inbox_messages WHERE subject LIKE '%Lumen Ledger%' AND class = 'interview_invite'");
    assert.ok(msg, 'the interview invite is stored as interview_invite');
    assert.equal(msg.application_id, lumenApp.id, 'linked to the Lumen Ledger application');
    const data = ClassifiedMessageSchema.partial().parse(JSON.parse(msg.data || '{}'));
    assert.ok((data.schedulingLinks ?? []).some((l) => /calendly\.com/.test(l)), 'Calendly link extracted');
    s.note('classified interview_invite, linked, Calendly link extracted');
    const stage = get<{ stage: string }>('SELECT stage FROM applications WHERE id = ?', lumenApp.id);
    assert.equal(stage?.stage, 'interview');
    s.note('application stage → interview');
    // The whole corpus: accuracy and idempotency.
    const index = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mail', 'index.json'), 'utf8')) as { messages: { file: string; class: string }[] };
    let right = 0;
    let classified = 0;
    for (const m of index.messages) {
      try {
        const buf = fs.readFileSync(path.join(FIXTURES, 'mail', m.file));
        await ingest(buf);
        const mid = (await simpleParser(buf)).messageId ?? '';
        const subj = get<{ class: string }>('SELECT class FROM inbox_messages WHERE message_id = ? OR message_id = ?', mid, mid.replace(/^<|>$/g, ''));
        classified++;
        if (subj?.class === m.class) right++;
      } catch (err) {
        if (!pendingReason(err)) throw err;
      }
    }
    const before = countRows('inbox_messages');
    await ingest(raw);
    assert.equal(countRows('inbox_messages'), before, 'ingesting the same Message-ID twice is a no-op');
    s.note('re-ingest is idempotent by Message-ID');
    if (classified) {
      s.note(`corpus: ${right}/${classified} classified as labelled`);
      assert.ok(right / classified >= 0.9, `classification accuracy ${right}/${classified} < 90%`);
    }
  },
};

export const alert: Stage<E2EContext> = {
  id: 'alert',
  title: 'Alert + learning plan (A09/A08): instant alert with a crash plan',
  needs: ['inbox'],
  consumes: ['inbox'],
  run: async (ctx, s) => {
    const ok = await waitUntil(() => ctx.events.some((e) => e.type === 'alert.interview' && e.company === 'Lumen Ledger'), 15_000);
    assert.ok(ok, 'no alert.interview event for Lumen Ledger');
    const ev = ctx.events.find((e) => e.type === 'alert.interview' && e.company === 'Lumen Ledger') as Extract<BusEvent, { type: 'alert.interview' }>;
    s.note(`alert.interview emitted (${ev.kind})`);
    assert.ok(ev.planId, 'the alert links a learning plan');
    const plan = get<{ plan: string }>('SELECT plan FROM learning_plans WHERE id = ?', ev.planId);
    assert.ok(plan, 'learning plan stored');
    const p = LearningPlanSchema.parse(JSON.parse(plan.plan));
    assert.ok(p.days.length > 0 && p.gaps.length > 0 && p.talkingPoints.length > 0, 'plan has days, gaps and talking points');
    s.note(`learning plan: ${p.days.length} days, gaps ${p.gaps.slice(0, 3).join(', ')}`);
    const replies = countRows('events', "kind LIKE '%sent%' AND message LIKE '%Lumen Ledger%'");
    assert.equal(replies, 0, 'Bureau must never auto-reply to an interview');
    s.note('no auto-reply to the interview');
  },
};

export const digest: Stage<E2EContext> = {
  id: 'digest',
  title: 'Digest (A08): today’s report reflects the run',
  needs: ['submit'],
  run: async (ctx, s) => {
    const build = await optionalExport<(campaignId: string, date?: string) => Promise<unknown>>([
      ['server/campaign/index.ts', 'buildCampaignDigest'],
    ]);
    if (!build) return s.pending('server/campaign has no buildDigest(campaignId, date?) yet (requests/A11.md §4)');
    await build(ctx.campaignId);
    const row = get<{ content: string }>('SELECT content FROM digests WHERE campaign_id = ? ORDER BY date DESC', ctx.campaignId);
    assert.ok(row, 'digest stored');
    const text = row.content;
    const submitted = [...ctx.submits].filter(([, o]) => o.status === 'submitted').map(([id]) => id);
    for (const id of submitted.filter((x) => !x.startsWith('widget-'))) {
      const company = formJob(ctx.fx.form(id)).company;
      assert.ok(text.includes(company), `digest omits sent application at ${company}`);
    }
    s.note(`digest lists the ${submitted.length} sent applications`);
    if (ctx.events.some((e) => e.type === 'alert.interview')) {
      assert.ok(/interview/i.test(text) && text.includes('Lumen Ledger'), 'digest reports the interview');
      s.note('digest reports the interview');
    }
    const needsYou = [...ctx.submits].filter(([, o]) => o.status === 'needs_you');
    if (needsYou.length) {
      assert.ok(/needs?[_ -]?you/i.test(text), 'digest has a needs-you section');
      s.note(`${needsYou.length} needs-you items reported`);
    }
  },
};

// ─────────────────────────────────────────────── worker-process scenarios

function workerEnv(ctx: E2EContext, dataDir: string, extra: Record<string, string> = {}) {
  return { ...ctx.childEnv, BUREAU_DATA_DIR: dataDir, ...extra };
}

async function seedWorker(ctx: E2EContext, dir: string, name: string, formIds: string[]) {
  fs.mkdirSync(dir, { recursive: true });
  const args = ['seed', name, ...formIds.flatMap((id) => [id, ctx.fx.url(id)])];
  const p = spawnTs('scripts/e2e/worker.ts', args, workerEnv(ctx, dir));
  const code = await p.exited;
  const line = p.output.find((l) => l.startsWith('E2E ') && l.includes('"seeded"'));
  if (code !== 0 || !line) throw new Error(`worker seed failed: ${p.output.slice(-3).join(' | ')}`);
  return JSON.parse(line.slice(4)) as { campaignId: string; jobs: Record<string, string> };
}

function readStates(dir: string): { job_id: string; state: string; last_error: string | null }[] {
  const db = new DatabaseSync(path.join(dir, 'bureau.db'), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 3000');
    return db.prepare('SELECT job_id, state, last_error FROM pipeline').all() as { job_id: string; state: string; last_error: string | null }[];
  } finally {
    db.close();
  }
}

function campaignStatus(dir: string, id: string): string | null {
  const db = new DatabaseSync(path.join(dir, 'bureau.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT status FROM campaigns WHERE id = ?').get(id) as { status: string } | undefined)?.status ?? null;
  } finally {
    db.close();
  }
}

const TERMINAL = new Set(['submitted', 'rehearsed', 'needs_you', 'skipped', 'failed']);

function workerPending(p: Proc, states: { last_error: string | null }[]): string | null {
  const ni = p.output.find((l) => l.includes('"notImplemented"'));
  if (ni) return `autopilot not built: ${ni.slice(4, 200)}`;
  // pipeline.last_error holds the message, not the code: a replay miss reads "No recorded Claude response…".
  const miss = states.find((x) => /REPLAY_MISSING|No recorded Claude response|NotImplemented|not implemented/i.test(x.last_error ?? ''));
  return miss ? `a step inside the autopilot is pending: ${miss.last_error?.slice(0, 200)}` : null;
}

export const crash: Stage<E2EContext> = {
  id: 'crash-resume',
  title: 'Crash and resume (A08): kill the process mid-fill, restart, no duplicates',
  needs: ['seed'],
  run: async (ctx, s) => {
    const dir = path.join(ctx.sandbox, 'crash');
    const formIds = ['greenhouse-classic', 'lever', 'ashby'];
    const seeded = await seedWorker(ctx, dir, 'E2E crash', formIds);
    s.note(`worker sandbox seeded: ${formIds.length} selected jobs`);
    const mark = new Map(formIds.map((id) => [id, ctx.fx.submissions({ formId: id }).at(-1)?.seq ?? 0]));
    const env = workerEnv(ctx, dir, { E2E_CAMPAIGN_ID: seeded.campaignId });
    const first = spawnTs('scripts/e2e/worker.ts', ['run'], env, { echo: !!process.env.BUREAU_E2E_DEBUG, label: 'worker#1' });
    const midFill = await waitUntil(
      () => first.child.exitCode !== null || readStates(dir).some((x) => ['filling', 'verified'].includes(x.state)) || formIds.some((id) => ctx.fx.submissions({ formId: id }).some((x) => x.seq > mark.get(id)!)),
      120_000,
      150,
    );
    if (first.child.exitCode !== null) {
      const why = workerPending(first, readStates(dir));
      if (why) s.pending(why);
      throw new Error(`worker exited early (${first.child.exitCode}): ${first.output.slice(-3).join(' | ')}`);
    }
    if (!midFill) {
      const why = workerPending(first, readStates(dir));
      first.kill();
      if (why) s.pending(why);
      throw new Error('the autopilot never started filling within 120 s');
    }
    first.kill('SIGKILL');
    await first.exited;
    s.note(`SIGKILLed the autopilot mid-fill (states: ${readStates(dir).map((x) => x.state).join(', ')})`);
    const second = spawnTs('scripts/e2e/worker.ts', ['resume'], env, { echo: !!process.env.BUREAU_E2E_DEBUG, label: 'worker#2' });
    const done = await waitUntil(() => second.child.exitCode !== null || readStates(dir).every((x) => TERMINAL.has(x.state)), 240_000, 500);
    const states = readStates(dir);
    second.kill('SIGKILL');
    await second.exited;
    const why = workerPending(second, states);
    if (why) s.pending(why);
    assert.ok(done && states.every((x) => TERMINAL.has(x.state)), `not every job finished after restart: ${states.map((x) => x.state).join(', ')}`);
    s.note(`resumed after restart; final states ${states.map((x) => x.state).join(', ')}`);
    for (const id of formIds) {
      const valid = ctx.fx.submissions({ formId: id, final: true, valid: true }).filter((x) => x.seq > mark.get(id)!);
      assert.ok(valid.length <= 1, `${id}: ${valid.length} submissions after a crash (double apply)`);
      const st = states.find((x) => x.job_id === seeded.jobs[id])?.state;
      if (st === 'submitted') assert.equal(valid.length, 1, `${id} marked submitted but the employer has ${valid.length}`);
      else assert.equal(valid.length, 0, `${id} reached the employer but its state is ${st}`);
    }
    s.note('zero double applications; pipeline state agrees with what the employer received');
  },
};

export const killSwitch: Stage<E2EContext> = {
  id: 'kill-switch',
  title: 'Kill switch (A08): data/STOP halts everything within 5 s',
  needs: ['seed'],
  run: async (ctx, s) => {
    const dir = path.join(ctx.sandbox, 'kill');
    const formIds = ['workable', 'recruitee-careers', 'personio-job', 'teamtailor-careersite'];
    const seeded = await seedWorker(ctx, dir, 'E2E kill', formIds);
    const env = workerEnv(ctx, dir, { E2E_CAMPAIGN_ID: seeded.campaignId });
    const p = spawnTs('scripts/e2e/worker.ts', ['run'], env, { echo: !!process.env.BUREAU_E2E_DEBUG, label: 'worker' });
    try {
      const busy = await waitUntil(() => p.child.exitCode !== null || readStates(dir).some((x) => ['writing', 'written', 'filling'].includes(x.state)), 120_000, 150);
      if (p.child.exitCode !== null || !busy) {
        const why = workerPending(p, readStates(dir));
        if (why) s.pending(why);
        throw new Error(`autopilot never got busy: ${p.output.slice(-3).join(' | ')}`);
      }
      fs.writeFileSync(path.join(dir, 'STOP'), 'e2e kill switch\n');
      const t = Date.now();
      s.note('wrote data/STOP while the autopilot was working');
      const stopped = await waitUntil(() => campaignStatus(dir, seeded.campaignId) !== 'active', 5_000, 100);
      assert.ok(stopped, `campaign still active ${((Date.now() - t) / 1000).toFixed(1)} s after STOP`);
      s.note(`campaign ${campaignStatus(dir, seeded.campaignId)} after ${((Date.now() - t) / 1000).toFixed(1)} s`);
      await new Promise((r) => setTimeout(r, 5_000));
      const cutoff = new Date(t + 5_000).toISOString();
      const late = formIds.flatMap((id) => ctx.fx.submissions({ formId: id }).filter((x) => x.ts > cutoff));
      const statesA = readStates(dir).map((x) => x.state).join(',');
      await new Promise((r) => setTimeout(r, 5_000));
      assert.equal(late.length, 0, `${late.length} requests reached employers more than 5 s after STOP`);
      assert.equal(readStates(dir).map((x) => x.state).join(','), statesA, 'pipeline kept moving after STOP');
      s.note('nothing reached an employer after the 5 s grace, and the pipeline froze');
    } finally {
      p.kill('SIGKILL');
      await p.exited;
    }
    // In-process: killAll() itself must return within 5 s.
    const c = await imp('../../server/campaign/index.ts');
    const t0 = Date.now();
    await withTimeout((c.killAll as (r: string) => Promise<void>)('e2e'), 5_000, 'killAll');
    s.note(`killAll() returned in ${Date.now() - t0} ms`);
  },
};

// ────────────────────────────────────────────── external agent (A07)

export const external: Stage<E2EContext> = {
  id: 'external-agent',
  title: 'External agent over /api/v1 and MCP (A07): claim → packet → answers → fill → trace → submitted',
  needs: ['jobs'],
  run: async (ctx, s) => {
    const { proc, base } = await startServer(ctx.childEnv);
    try {
      // Fail-closed checks that hold before and after A07 lands.
      const noKey = await fetch(`${base}/api/v1/health`);
      assert.equal(noKey.status, 401, `/api/v1/health without a key → ${noKey.status}`);
      const badKey = await fetch(`${base}/api/v1/jobs`, { headers: { authorization: 'Bearer bur_nope_nope' } });
      assert.equal(badKey.status, 401, `/api/v1/jobs with a bogus key → ${badKey.status}`);
      for (const p of ['/api/%76%31/jobs', '/API/V1/jobs', '/api/v1/../v1/jobs', '//api/v1/jobs']) {
        const r = await fetch(`${base}${p}`);
        assert.ok([400, 401, 403, 404].includes(r.status) && !(await r.text()).includes('"jobs"'), `${p} → ${r.status}`);
      }
      const mcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      assert.equal(mcp.status, 401, `/mcp without a key → ${mcp.status}`);
      s.note('without a valid key, /api/v1 (all path spellings) and /mcp refuse with 401');

      const { createApiKey } = await import('../../server/api/keys.ts');
      const full = await createApiKey({ name: 'e2e fake agent', scopes: ['jobs:read', 'packets:read', 'answers:read', 'recipes:read', 'traces:write', 'applications:write'] });
      const narrow = await createApiKey({ name: 'e2e read-only', scopes: ['jobs:read'] });
      // Fastify rejects a JSON content-type with an empty body, so send it only with one.
      const H = (k: string, json: boolean) => ({ authorization: `Bearer ${k}`, ...(json ? { 'content-type': 'application/json' } : {}) });
      const api = async (method: string, p: string, body?: unknown, key = full.key) => {
        const r = await fetch(`${base}/api/v1${p}`, { method, headers: H(key, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
        const text = await r.text();
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }
        if (r.status >= 500 && typeof json === 'object' && json && (json as { error?: string }).error === 'REPLAY_MISSING') {
          throw new PendingError(`API call needs a Claude recording: ${(json as { message?: string }).message}`);
        }
        return { status: r.status, json: json as Record<string, unknown> };
      };
      const health = await api('GET', '/health');
      assert.equal(health.status, 200);
      s.note('GET /health with a key → 200');
      assert.equal((await api('POST', '/answers', { jobId: 'x', question: 'q' }, narrow.key)).status, 403, 'missing scope must be 403');
      s.note('a key without answers:read gets 403');

      // A fresh job for the agent, on the Greenhouse classic replica.
      const jobId = insertJob({ fingerprint: 'e2e:external-agent', title: 'Junior Backend Engineer (external agent run)', company: 'Lumen Ledger', url: ctx.fx.url('greenhouse-classic'), ats: 'greenhouse', campaignId: ctx.campaignId });
      advanceTo(jobId, 'selected', 'e2e: external agent');
      const list = await api('GET', '/jobs?state=selected&limit=100');
      assert.equal(list.status, 200);
      assert.ok((list.json.jobs as { id: string }[]).some((j) => j.id === jobId), 'GET /jobs lists the selected job');
      const claim = await api('POST', `/jobs/${jobId}/claim`, { ttlMinutes: 20 });
      assert.equal(claim.status, 200, `claim → ${claim.status}`);
      assert.equal(claimJob(jobId, 'autopilot', 20), null, 'the autopilot must not get a job an agent holds');
      assert.ok(activeClaim(jobId)?.holder.startsWith('external:'));
      s.note('agent claimed the job; the autopilot is locked out');
      const packet = await api('POST', `/jobs/${jobId}/packet`);
      assert.equal(packet.status, 200, `packet → ${packet.status} ${JSON.stringify(packet.json).slice(0, 200)}`);
      const files = packet.json.files as { cv: string; letter: string; expiresAt: string };
      const cvRes = await fetch(new URL(files.cv, base));
      const cv = Buffer.from(await cvRes.arrayBuffer());
      assert.equal(cv.subarray(0, 5).toString('latin1'), '%PDF-', 'signed CV URL serves the PDF');
      const tampered = await fetch(new URL(files.cv.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), base));
      assert.ok([401, 403, 404].includes(tampered.status), `tampered file token → ${tampered.status}`);
      const traversal = await fetch(`${base}/api/v1/files/..%2f..%2fbureau.db`);
      assert.ok([400, 401, 403, 404].includes(traversal.status), `traversal → ${traversal.status}`);
      s.note('packet with signed file URLs; tampered and traversal tokens refused');
      const cvPath = path.join(ctx.sandbox, 'external-cv.pdf');
      fs.writeFileSync(cvPath, cv);
      const ask = async (question: string, fieldKind = 'text', options?: string[]) => {
        const r = await api('POST', '/answers', { jobId, question, fieldKind, options });
        assert.equal(r.status, 200, `answers(${question}) → ${r.status}`);
        return r.json as { value: string | null; source: string };
      };
      const first = await ask('First Name');
      const last = await ask('Last Name');
      const email = await ask('Email', 'email');
      const phone = await ask('Phone', 'tel');
      const why = await ask('Why do you want to work at Lumen Ledger?', 'textarea');
      const exp = loadExpected();
      assert.equal(first.value, exp.firstName);
      assert.equal(email.value, exp.email);
      s.note('POST /answers resolves contact fields from the profile');

      // The scripted fake agent fills the replica with those answers.
      const { chromium } = await import('playwright-core');
      const browser = await chromium.launch(process.env.BUREAU_CHROME_PATH ? { executablePath: process.env.BUREAU_CHROME_PATH, headless: !ctx.headful } : { channel: 'chrome', headless: !ctx.headful }).catch(() => chromium.launch({ channel: 'msedge', headless: !ctx.headful }));
      const before = ctx.fx.submissions({ formId: 'greenhouse-classic', final: true }).length;
      let shot = '';
      try {
        const page = await (await browser.newContext()).newPage();
        const g = goldenCtx(ctx.fx);
        const golden = (await import('./golden/greenhouse-classic.ts')).default;
        await golden(page, {
          ...g,
          data: { ...g.data, firstName: first.value ?? g.data.firstName, lastName: last.value ?? g.data.lastName, email: email.value ?? g.data.email, phone: phone.value ?? g.data.phone },
          files: { ...g.files, cv: cvPath },
          text: { ...g.text, whyUs: why.value ?? g.text.whyUs },
        });
        shot = (await page.screenshot({ type: 'png' })).toString('base64');
      } finally {
        await browser.close();
      }
      assert.equal(ctx.fx.submissions({ formId: 'greenhouse-classic', final: true }).length, before + 1, 'the agent submitted once');
      const trace = {
        jobId,
        applicationId: null,
        origin: 'external:e2e',
        url: ctx.fx.url('greenhouse-classic'),
        ats: 'greenhouse',
        steps: [
          { i: 0, action: 'fill', fieldSignature: 'first-name', labelNorm: 'first name', widget: 'text', selectors: ['#first_name'], valueSource: 'profile', valueKey: 'firstName', step: 0, url: ctx.fx.url('greenhouse-classic'), ok: true },
          { i: 1, action: 'upload', labelNorm: 'resume cv', widget: 'file', selectors: ['#resume'], valueSource: 'file', valueKey: 'cv', step: 0, url: ctx.fx.url('greenhouse-classic'), ok: true },
          { i: 2, action: 'done', step: 0, selectors: [], url: ctx.fx.url('greenhouse-classic'), ok: true },
        ],
        outcome: 'submitted',
        startedAt: now(),
        finishedAt: now(),
      };
      const tr = await api('POST', '/traces', trace);
      assert.equal(tr.status, 200, `traces → ${tr.status}`);
      assert.ok(countRows('agent_traces', "origin LIKE 'external:%'") >= 1, 'trace stored with an external origin');
      assert.equal(countRows('form_recipes', "status = 'active'"), countRows('form_recipes', "status = 'active' AND id NOT IN (SELECT id FROM form_recipes WHERE recipe LIKE '%external%')"), 'an external trace must never be promoted directly');
      s.note('trace accepted and queued (never promoted without internal shadow runs)');
      const done = await api('POST', `/jobs/${jobId}/submitted`, { proofScreenshot: shot, confirmationText: 'Thank you for applying.', url: ctx.fx.url('greenhouse-classic') });
      assert.equal(done.status, 200, `submitted → ${done.status}`);
      assert.equal(pipelineState(jobId)?.state, 'submitted');
      const again = await api('POST', `/jobs/${jobId}/submitted`, { proofScreenshot: shot, url: ctx.fx.url('greenhouse-classic') });
      assert.ok([200, 409].includes(again.status), 'marking twice is idempotent or a conflict, never a second application');
      assert.ok(countRows('api_audit') >= 8, 'every call audited');
      s.note('POST /submitted → pipeline submitted (origin external); audit log populated');
      releaseClaim(jobId, 'autopilot');

      // MCP over streamable HTTP with the same key.
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      const client = new Client({ name: 'bureau-e2e', version: '1.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${full.key}` } } }));
      try {
        const tools = (await client.listTools()).tools.map((t) => t.name);
        for (const t of ['list_ready_jobs', 'get_job', 'get_application_packet', 'answer_form_question', 'get_form_recipe', 'report_trace', 'mark_submitted', 'mark_failed']) {
          assert.ok(tools.includes(t), `MCP tool ${t} missing`);
        }
        const r = await client.callTool({ name: 'list_ready_jobs', arguments: { limit: 5 } });
        assert.ok(!r.isError, 'list_ready_jobs errored');
        s.note(`MCP over HTTP: ${tools.length} tools, list_ready_jobs works`);
      } finally {
        await client.close();
      }
    } finally {
      proc.kill('SIGTERM');
      await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 3000))]);
      proc.kill('SIGKILL');
    }
  },
};

export const mailBridgeStage: Stage<E2EContext> = {
  id: 'mail-bridge',
  title: 'Mail bridge: fixture-server mail (Workday codes) reaches the inbox',
  needs: ['submit'],
  run: async (ctx, s) => {
    const sent = ctx.fx.mail().length;
    if (!sent) {
      s.note('no fixture mail was generated in this run');
      return;
    }
    if (!ctx.mailBridge.available) s.pending('ingestRaw() missing, so Workday verification codes could not reach waitForCode() (requests/A11.md §3)');
    assert.equal(ctx.mailBridge.errors.length, 0, ctx.mailBridge.errors.join('; '));
    s.note(`${ctx.mailBridge.delivered}/${sent} fixture emails delivered to the inbox`);
  },
};

export const uiSmoke: Stage<E2EContext> = {
  id: 'ui-smoke',
  title: 'UI smoke (A10 steps, A11 wiring): onboarding, campaign, kill switch, questions',
  run: async (ctx, s) => {
    const p = spawnTs('scripts/ui-smoke.ts', ctx.headful ? ['--headful'] : [], { BUREAU_E2E_DEBUG: process.env.BUREAU_E2E_DEBUG ?? '' }, { echo: !!process.env.BUREAU_E2E_DEBUG, label: 'ui-smoke' });
    const code = await p.exited;
    const line = p.output.find((l) => l.startsWith('E2E-UI '));
    const res = line ? (JSON.parse(line.slice(7)) as { passed: number; failed: number; pending: string }) : null;
    if (!res) throw new Error(`ui-smoke gave no result (exit ${code}): ${p.output.slice(-3).join(' | ')}`);
    if (res.pending) return s.pending(res.pending);
    assert.equal(res.failed, 0, `${res.failed} UI step(s) failed: ${p.output.filter((l) => l.includes('✗')).slice(0, 3).join(' | ')}`);
    s.note(`${res.passed} UI steps passed`);
  },
};

export const STAGES: Stage<E2EContext>[] = [seed, profile, campaign, scout, jobs, match, write, rehearse, submit, mailBridgeStage, inbox, alert, digest, crash, killSwitch, external, uiSmoke];

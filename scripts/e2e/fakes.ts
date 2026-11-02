/**
 * Stand-ins for not-yet-built modules, used ONLY by `npm run e2e -- --fakes`
 * to prove the e2e's own assertions (that a correct implementation passes and
 * the checks are wired to the right data). They are deliberately simple:
 *   - forms.fillApplication → drives the golden fill for the job's replica
 *   - inbox.ingestRaw       → labels mail from fixtures/mail/index.json, links by company, alerts on interviews
 *   - campaign.buildDigest  → summarises pipeline, applications and inbox
 * A pass with fakes says nothing about the real modules.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import type { Browser } from 'playwright-core';
import type { FixtureServer } from '../fixture-server.ts';
import { all, get, now, run } from '../../server/db.ts';
import { emit } from '../../server/services/bus.ts';
import { pipelineState } from '../../server/campaign/pipeline.ts';
import type { ApplicationPacket } from '../../server/contracts/writer.ts';
import type { FillOutcome } from '../../server/contracts/forms.ts';
import { FIXTURES } from './manifest.ts';
import { goldenCtx } from './golden.ts';
import type { GoldenFill } from './golden/types.ts';

export function makeFakes(fx: FixtureServer, launch: () => Promise<Browser>) {
  let browser: Promise<Browser> | null = null;
  const formFor = (jobId: string) => {
    const url = get<{ apply_url_canonical: string }>('SELECT apply_url_canonical FROM jobs WHERE id = ?', jobId)?.apply_url_canonical ?? '';
    return fx.manifest.forms.find((f) => fx.url(f.id) === url) ?? null;
  };

  async function fillApplication(packet: ApplicationPacket, opts: { submit: boolean }): Promise<FillOutcome> {
    const f = formFor(packet.jobId);
    if (!f) throw new Error(`fake fill: no replica for job ${packet.jobId}`);
    const base: FillOutcome = { status: 'rehearsed', reason: 'fake', shotPath: null, shots: ['fake.png'], answers: [], verified: true, unknownQuestions: [], fieldLog: [], ats: null, via: 'adapter', recipeId: null, url: fx.url(f.id) };
    base.fieldLog = Object.keys(f.expect).map((k) => ({ signature: k, label: k, kind: 'text' as const, required: f.required.includes(k), source: 'profile' as const, key: k, intended: 'x', readBack: 'x', ok: true }));
    if (pipelineState(packet.jobId)?.state === 'submitted') return { ...base, status: 'skipped', reason: 'already submitted' };
    if (f.expectedOutcome === 'needs_you') return { ...base, status: 'needs_you', reason: 'captcha', verified: false };
    if (f.expectedOutcome === 'verify_blocked') return { ...base, status: 'failed', reason: 'read-back mismatch', verified: false };
    if (!opts.submit) return base;
    browser ??= launch();
    const ctx = await (await browser).newContext();
    try {
      const page = await ctx.newPage();
      const golden = (await import(`./golden/${f.id}.ts`)) as { default: GoldenFill };
      await golden.default(page, goldenCtx(fx));
      return { ...base, status: 'submitted', reason: 'confirmed' };
    } finally {
      await ctx.close();
    }
  }

  const index = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'mail', 'index.json'), 'utf8')) as { messages: { file: string; class: string; company: string | null; subject: string; schedulingLinks: string[] }[] };

  async function ingestRaw(raw: Buffer | string) {
    const mail = await simpleParser(raw);
    const messageId = mail.messageId ?? crypto.randomUUID();
    if (get('SELECT 1 FROM inbox_messages WHERE message_id = ?', messageId)) return 0;
    const label = index.messages.find((m) => m.subject === mail.subject);
    const cls = label?.class ?? (/verify/i.test(mail.subject ?? '') ? 'verification_code' : 'other');
    const company = label?.company ?? null;
    const app = company
      ? get<{ id: string; title: string }>('SELECT a.id, j.title FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.company = ? ORDER BY a.sent_at DESC, a.created_at DESC', company)
      : undefined;
    const id = crypto.randomUUID();
    run(
      'INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data, handled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      id,
      messageId,
      mail.from?.text ?? '',
      mail.subject ?? '',
      now(),
      cls,
      app?.id ?? null,
      JSON.stringify({ schedulingLinks: label?.schedulingLinks ?? [] }),
    );
    if (app && cls === 'interview_invite') {
      run("UPDATE applications SET stage = 'interview' WHERE id = ?", app.id);
      const planId = crypto.randomUUID();
      const plan = { applicationId: app.id, company, role: app.title, interviewDate: null, gaps: ['AWS'], days: [{ day: 1, focus: 'AWS basics', tasks: ['Deploy ledger-lite to ECS'], resources: [{ title: 'AWS docs', url: 'https://docs.aws.amazon.com', free: true }], miniProject: 'ECS deploy' }], likelyQuestions: ['How do you handle concurrent ledger writes?'], talkingPoints: ['Reconciliation job 41 → 6 minutes'] };
      run('INSERT INTO learning_plans (id, application_id, company, plan, created_at) VALUES (?, ?, ?, ?, ?)', planId, app.id, company!, JSON.stringify(plan), now());
      emit({ type: 'alert.interview', applicationId: app.id, company: company!, role: app.title, kind: 'interview_invite', deadline: null, planId });
    }
    return 1;
  }

  async function buildDigest(campaignId: string) {
    const sent = all<{ company: string; title: string }>("SELECT j.company, j.title FROM pipeline p JOIN jobs j ON j.id = p.job_id WHERE p.state = 'submitted'");
    const needsYou = all<{ company: string }>("SELECT j.company FROM pipeline p JOIN jobs j ON j.id = p.job_id WHERE p.state = 'needs_you'");
    const interviews = all<{ subject: string }>("SELECT subject FROM inbox_messages WHERE class = 'interview_invite'");
    const content = { sent, needs_you: needsYou, interviews };
    run('INSERT INTO digests (id, campaign_id, date, content, sent_via) VALUES (?, ?, ?, ?, ?)', crypto.randomUUID(), campaignId, now().slice(0, 10), JSON.stringify(content), '[]');
    return content;
  }

  return {
    modules: {
      'server/forms/index.ts': { fillApplication },
      'server/inbox/index.ts': { ingestRaw },
      'server/campaign/index.ts': { buildCampaignDigest: buildDigest },
    } as Record<string, Record<string, unknown>>,
    close: async () => {
      if (browser) await (await browser).close();
    },
  };
}

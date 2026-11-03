import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { Harness } from '../lib/harness.ts';

/**
 * A06 browser agent on embedded and componentised pages: controls inside a
 * cross-origin iframe (fixtures/ats/_a06/iframe-host.html on origin A embeds
 * iframe-form.html from origin B) and inside open shadow roots (the staged
 * web-component wizard, fixtures/ats/_staged). The agent is driven by a
 * scripted policy here (no Claude call, no recording), the same seam the
 * guardrail checks in a06-agent.ts use; recipe replay and the form engine run
 * on the same pages.
 */
export default async function a06Frames({ check, section, sandbox, sharedBrowser }: Harness) {
  const L = await import('../../server/agent/loop.ts');
  const A = await import('../../server/agent/index.ts');
  const G = await import('../../server/agent/guard.ts');
  const V = await import('../../server/agent/values.ts');
  const { agentContent } = await import('../../server/agent/prompt.ts');
  const { agentOp } = await import('../../server/agent/page.ts');
  const { replayRecipe } = await import('../../server/agent/replay.ts');
  const { loadTrace } = await import('../../server/agent/trace.ts');
  const { all, run } = await import('../../server/db.ts');
  type AgentAction = import('../../server/contracts/agent.ts').AgentAction;
  type TurnState = import('../../server/agent/loop.ts').TurnState;
  type Clickable = import('../../server/agent/page.ts').Clickable;
  type Snapshot = import('../../server/agent/page.ts').Snapshot;

  const recipesBefore = new Set(all<{ id: string }>('SELECT id FROM form_recipes').map((r) => r.id));

  section('A06 agent: controls inside cross-origin iframes and open shadow roots');
  const ctl = (ref: string, name: string, extra: Partial<Clickable> = {}): Clickable => ({ ref, role: 'button', name, tag: 'button', type: 'button', href: '', absHref: '', inForm: true, expanded: '', selectors: [], ...extra });
  await check('the prompt marks a framed control (ref k<n>@<frame>, in_frame=host); main-document lines are unchanged', () => {
    const base = { job: null, url: 'https://careers.example.com/', title: 't', turn: 0, maxSteps: 60, catalogue: [], fields: [], headings: [], text: '', history: [], notes: [], injection: false };
    const main = agentContent({ ...base, controls: [ctl('k1', 'Open the form')] });
    assert.match(main, /- ref=k1 button "Open the form" type=button\n/);
    const framed = agentContent({ ...base, controls: [ctl('k2@b1x', 'Continue', { frame: 'b1x', frameHost: 'apply.partner.example:443' })] });
    assert.match(framed, /- ref=k2@b1x button "Continue" type=button in_frame="apply\.partner\.example:443"/);
  });
  await check('a link inside an embedded frame may stay on that frame’s host; the final submit stays refused there too', () => {
    const policy = G.policyFor(['https://careers.example.com/jobs/1'], null);
    const link = ctl('k3@b1x', 'Privacy notice', { role: 'link', tag: 'a', href: '/privacy', absHref: 'https://apply.partner.example/privacy', frame: 'b1x', frameHost: 'apply.partner.example' });
    assert.equal(G.clickVerdict(link, policy).ok, false, 'not on the job’s site by itself');
    assert.equal(G.clickVerdict(link, { ...policy, hosts: new Set([...policy.hosts, 'apply.partner.example']) }).ok, true);
    assert.equal(G.clickVerdict(ctl('k4@b1x', 'Submit application', { type: 'submit', frame: 'b1x' }), policy).ok, false);
  });

  const browser = await sharedBrowser();
  if (!browser) {
    await check('browser checks', () => 'skip');
    return;
  }
  const { startFixtureServer } = await import('../fixture-server.ts');
  const { startStagedReplicas } = await import('../../fixtures/ats/_staged/server.ts');
  const fx = await startFixtureServer({ quiet: true });
  const sx = await startStagedReplicas({ quiet: true });
  const prevOrigins = process.env.BUREAU_FIXTURE_ORIGINS;
  process.env.BUREAU_FIXTURE_ORIGINS = `${fx.originA},${fx.originB},${sx.originA},${sx.originB}`;
  const { seedProfile, insertJob, fallbackPacket } = await import('../e2e/seed.ts');
  const { guardedContext } = await import('../../server/forms/browser.ts');
  const { verifyFields } = await import('../../server/forms/verify.ts');
  const { runFill } = await import('../../server/forms/engine.ts');
  try {
    seedProfile();
    run("DELETE FROM settings WHERE key = 'profile.links'");
    const hostUrl = fx.url('/ats/_a06/iframe-host.html');
    const shadowUrl = sx.url('widget-shadow-open-wizard');
    const jobFor = (tag: string, url: string, company: string) => {
      const jobId = insertJob({ fingerprint: `a06f:${tag}`, title: 'Junior Platform Engineer', company, url, ats: 'other', campaignId: null });
      return { jobId, packet: fallbackPacket(jobId, 'a06', sandbox) };
    };
    const open = async (url: string): Promise<{ page: Page; close: () => Promise<void> }> => {
      const ctx = await guardedContext(browser);
      const page = await ctx.newPage();
      page.setDefaultTimeout(5_000);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      return { page, close: () => ctx.close() };
    };
    /**
     * A deterministic stand-in for Claude: open the form, fill each field with A05's suggestion, try the
     * final submit once (it must be refused), move on, finish. Never a value of its own.
     */
    const scripted = (opts: { start?: string; next: string; trySubmit?: string }) => {
      const seen: TurnState[] = [];
      const done = new Set<string>();
      let started = false;
      let triedSubmit = false;
      const decide = async (req: { state: TurnState }): Promise<AgentAction> => {
        const s = req.state;
        seen.push(s);
        const act = (a: Partial<AgentAction>): AgentAction => ({ target: '', valueKey: '', file: '', question: '', reason: 'scripted', action: 'wait', ...a }) as AgentAction;
        if (opts.start && !started) {
          const c = s.controls.find((x) => x.name === opts.start);
          if (c) {
            started = true;
            return act({ action: 'click', target: c.ref });
          }
        }
        const todo = s.fields.find((v) => v.suggest && !done.has(v.field.signature));
        if (todo) {
          done.add(todo.field.signature);
          return act({ action: todo.field.kind === 'file' ? 'upload' : 'fill', target: todo.field.id, valueKey: 'suggested' });
        }
        const next = s.controls.find((x) => x.name === opts.next);
        if (next) return act({ action: 'click', target: next.ref });
        if (opts.trySubmit && !triedSubmit) {
          const sub = s.controls.find((x) => x.name === opts.trySubmit);
          if (sub) {
            triedSubmit = true;
            return act({ action: 'click', target: sub.ref });
          }
        }
        return act({ action: 'done' });
      };
      return { decide, seen };
    };
    const hostPosted = (page: Page) => page.evaluate('window.__posted || 0') as Promise<number>;

    let frameTrace = '';
    await check('cross-origin iframe: the agent clicks "Start" and "Continue" inside the origin-B frame, fills both steps, verifies, never submits', async () => {
      const { jobId, packet } = jobFor('iframe', hostUrl, 'Larkfield Freight');
      const { page, close } = await open(hostUrl);
      try {
        const p = scripted({ start: 'Start your application', next: 'Continue', trySubmit: 'Submit application' });
        const res = await L.agentFill({ page, fields: [], packet, jobId }, { decide: p.decide, compile: false, recipes: false, maxSteps: 25 });
        assert.equal(res.status, 'done', res.reason);
        frameTrace = res.traceId ?? '';
        const framedRefs = p.seen[0].controls.filter((c) => c.frame);
        assert.ok(framedRefs.some((c) => c.name === 'Start your application' && /^k\d+@b\d+x$/.test(c.ref) && c.frameHost === new URL(fx.originB).host), JSON.stringify(framedRefs));
        const results = p.seen.at(-1)!.history.map((h) => `${h.action} → ${h.result}`);
        assert.ok(results.filter((r) => r.startsWith('click → ok, the page changed')).length >= 2, results.join(' | '));
        assert.ok(results.some((r) => r.startsWith('click → refused') && /final submit|submit button/.test(r)), 'the framed "Submit application" was refused');
        const intended = A.agentIntended(page)!;
        // A05 extraction lists a file input even while its step is hidden, so the CV goes in on page 1; page 2 keeps the rest.
        assert.ok(intended.fields.length >= 2 && intended.fields.every((f) => f.frame), `page-2 fields are the frame’s: ${JSON.stringify(intended.fields.map((f) => [f.label, f.frame]))}`);
        const v = await verifyFields(page, intended.fields, intended.values);
        assert.ok(v.verified, v.problems.join('; '));
        assert.equal(await hostPosted(page), 0, 'nothing was sent');
        const t = loadTrace(res.traceId!)!;
        assert.ok(t.steps.some((s) => s.action === 'click' && s.selectors.length) && t.steps.some((s) => s.action === 'next'));
        assert.ok(t.steps.some((s) => s.action === 'upload' && s.ok && s.valueKey === 'cv'), 'the CV was uploaded into the frame');
      } finally {
        await close();
      }
    });
    await check('recipe replay finds framed controls by their selectors and clicks them in the frame (no Claude call)', async () => {
      const t = loadTrace(frameTrace);
      assert.ok(t, 'trace from the agent run');
      const steps = t!.steps
        .filter((s) => s.ok && ['click', 'next', 'fill', 'upload', 'check', 'select'].includes(s.action))
        .map((s) => ({ action: s.action as 'click', selectors: s.selectors, widget: s.widget ?? 'button', fieldSignature: s.fieldSignature, valueSource: s.valueSource, valueKey: s.valueKey, labelNorm: s.labelNorm }));
      const { packet } = jobFor('iframe:replay', hostUrl, 'Larkfield Freight');
      const { page, close } = await open(hostUrl);
      try {
        const cand = await V.loadCandidate();
        const r = await replayRecipe(page, { ats: 'other', scope: 'url', scopeKey: hostUrl, version: 1, status: 'active', match: {}, steps, hooks: [] }, { vctx: { packet, candidate: cand, job: null }, files: { cv: packet.cvPdfPath, letter: packet.letterPdfPath }, policy: G.policyFor([page.url()], null) });
        assert.ok(r.verified, r.problems.join('; '));
        assert.ok(r.filled >= 5, `${r.filled} filled`);
        assert.equal(await hostPosted(page), 0);
      } finally {
        await close();
      }
    });
    await check('open shadow roots: slotted <qf-button> Next is a control; the agent fills both wizard steps through nested roots and verifies', async () => {
      const { jobId, packet } = jobFor('shadow', shadowUrl, 'Quillfeather Studio Agents');
      const { page, close } = await open(shadowUrl);
      try {
        const snap = await agentOp<Snapshot>(page.mainFrame(), 'snapshot', { maxText: 100 });
        assert.ok(snap.clickables.some((c) => c.name === 'Next'), JSON.stringify(snap.clickables.map((c) => c.name)));
        assert.ok(!snap.clickables.some((c) => c.name === 'Submit application'), 'the hidden submit is not offered');
        const p = scripted({ next: 'Next' });
        const res = await L.agentFill({ page, fields: [], packet, jobId }, { decide: p.decide, compile: false, recipes: false, maxSteps: 25 });
        assert.equal(res.status, 'done', res.reason);
        const history = p.seen.at(-1)!.history.map((h) => `${h.action} → ${h.result}`);
        assert.ok(history.includes('click → ok, the page changed'), history.join(' | '));
        assert.ok(history.some((h) => /^upload → ok, reads ".*CV\.pdf"/.test(h)), history.join(' | '));
        const intended = A.agentIntended(page)!;
        assert.ok(intended.fields.some((f) => /email/i.test(f.label)) && intended.fields.some((f) => f.kind === 'consent' || f.kind === 'checkbox'), intended.fields.map((f) => f.label).join(', '));
        const v = await verifyFields(page, intended.fields, intended.values);
        assert.ok(v.verified, v.problems.join('; '));
        assert.equal(sx.submissions({ formId: 'widget-shadow-open-wizard' }).length, 0, 'nothing was sent');
      } finally {
        await close();
      }
    });
    await check('the form engine alone: Start, Continue and the verified Submit all happen inside the cross-origin frame', async () => {
      const deps = { browser: async () => ({ browser, release: () => {} }), url: hostUrl, agentFill: null, recordUnknown: () => 'q' };
      const reh = await runFill(jobFor('iframe:engine', hostUrl, 'Larkfield Freight Engine').packet, { submit: false, onUnknown: 'skip' }, deps);
      assert.equal(reh.status, 'rehearsed', reh.reason);
      assert.ok(reh.verified && reh.fieldLog.length >= 6 && reh.fieldLog.every((e) => e.ok), JSON.stringify(reh.fieldLog.filter((e) => !e.ok)));
      const live = await runFill(jobFor('iframe:engine:live', hostUrl, 'Larkfield Freight Live').packet, { submit: true, onUnknown: 'skip' }, deps);
      assert.equal(live.status, 'submitted', live.reason);
    });
  } finally {
    if (prevOrigins === undefined) delete process.env.BUREAU_FIXTURE_ORIGINS;
    else process.env.BUREAU_FIXTURE_ORIGINS = prevOrigins;
    await sx.close();
    await fx.close();
    // Leave the shared sandbox as found: later modules (the digest) count today's active recipes.
    for (const { id } of all<{ id: string }>('SELECT id FROM form_recipes')) {
      if (recipesBefore.has(id)) continue;
      run('DELETE FROM form_recipe_runs WHERE recipe_id = ?', id);
      run('DELETE FROM form_recipes WHERE id = ?', id);
    }
  }
}

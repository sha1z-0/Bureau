import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Plants fictional form-engine (A05) and inbox/learning (A09) rows the way those
 * modules leave them, so the Forms, Inbox and Learning screens have real data to
 * show: recipes (with a version history), recipe runs, two fill runs (one with
 * its run.json and a step screenshot), a site account, four inbox messages
 * (interview with a crash plan, a recruiter question with a drafted reply, a
 * rejection, a lookalike held for review), a learning plan and a gap report.
 *
 * Writes straight to SQLite (WAL) and the run folder in `dataDir`, beside a
 * running server or before one starts. Every name, domain and address is made
 * up (example.net). Used by scripts/ui-smoke/a10-5-forms-inbox.ts and
 * scripts/a10/seed-demo.ts.
 */

export interface PlantedFormsInbox {
  jobId: string;
  applicationId: string;
  company: string;
  recipeIds: { atsActive: string; companyOld: string; companyNew: string };
  runIds: { submitted: string; needsYou: string };
  messageIds: { interview: string; question: string; rejection: string; lookalike: string };
  planId: string;
  gapReportId: string;
  accountDomain: string;
}

export const SMOKE_COMPANY = 'Quillfeather Labs';

export async function plantFormsInbox(dataDir: string, opts: { shot?: Buffer; company?: string } = {}): Promise<PlantedFormsInbox> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(dataDir, 'bureau.db'));
  const company = opts.company ?? SMOKE_COMPANY;
  const slug = company.toLowerCase().replace(/[^a-z]+/g, '');
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const H = 3_600_000;
  const D = 24 * H;
  const short = () => crypto.randomUUID().slice(0, 8);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    // The form engine's own tables are created when the server imports it; make sure they exist for a cold data dir.
    db.exec(`
      CREATE TABLE IF NOT EXISTS form_runs (id TEXT PRIMARY KEY, job_id TEXT, application_id TEXT, campaign_id TEXT, url TEXT, ats TEXT, via TEXT, recipe_id TEXT,
        submit INTEGER NOT NULL DEFAULT 0, status TEXT, verified INTEGER NOT NULL DEFAULT 0, reason TEXT, fields_total INTEGER NOT NULL DEFAULT 0,
        fields_ok INTEGER NOT NULL DEFAULT 0, steps INTEGER NOT NULL DEFAULT 0, dir TEXT, started_at TEXT NOT NULL, finished_at TEXT);
      CREATE TABLE IF NOT EXISTS form_recipe_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, recipe_id TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT, at TEXT NOT NULL);
    `);

    // ── A job Bureau applied to, with its application.
    const jobId = `smoke-forms-${short()}`;
    const applicationId = crypto.randomUUID();
    const url = `https://boards.greenhouse.example.net/${slug}/jobs/4207`;
    db.prepare(
      `INSERT INTO jobs (id, fingerprint, source, url, title, company, location, remote, category, tags, found_at, updated_at, ats, apply_url_canonical)
       VALUES (?, ?, 'fixture', ?, 'Platform Engineer', ?, 'Remote', 1, 'software', '[]', ?, ?, 'greenhouse', ?)`,
    ).run(jobId, `fp-${jobId}`, url, company, iso(4 * D), iso(4 * D), url);
    db.prepare(
      `INSERT INTO applications (id, job_id, subject, status, channel, sent_at, created_at, updated_at, stage, answers)
       VALUES (?, ?, 'Platform Engineer application', 'sent', 'ats', ?, ?, ?, 'interview', '[]')`,
    ).run(applicationId, jobId, iso(3 * D), iso(3 * D), iso(2 * H));

    // ── Recipes: one ATS-wide, and a company recipe with two versions (v1 demoted, v2 active).
    const step = (action: string, labelNorm: string, widget: string, valueSource?: string, valueKey?: string) => ({
      action,
      labelNorm,
      widget,
      fieldSignature: crypto.createHash('sha1').update(labelNorm + widget).digest('hex').slice(0, 16),
      selectors: [`role=textbox[name="${labelNorm}"]`, `label:has-text("${labelNorm}") >> input`],
      ...(valueSource ? { valueSource, valueKey } : {}),
    });
    const steps = [
      step('fill', 'first name', 'text', 'profile', 'firstName'),
      step('fill', 'last name', 'text', 'profile', 'lastName'),
      step('fill', 'email', 'email', 'profile', 'email'),
      step('upload', 'resume', 'file', 'file', 'cv'),
      step('select', 'will you require sponsorship', 'select', 'answer_bank', 'sponsorship'),
      step('submit', 'submit application', 'button'),
    ];
    const recipe = (scope: string, scopeKey: string, version: number) => JSON.stringify({ ats: 'greenhouse', scope, scopeKey, version, match: { urlPattern: `boards.greenhouse.example.net/${slug}/*` }, steps, hooks: [] });
    const insRecipe = db.prepare(
      `INSERT INTO form_recipes (id, ats, scope, scope_key, version, recipe, status, successes, failures, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const recipeIds = { atsActive: crypto.randomUUID(), companyOld: crypto.randomUUID(), companyNew: crypto.randomUUID() };
    const key = slug;
    insRecipe.run(recipeIds.atsActive, 'greenhouse', 'ats', 'greenhouse', 1, JSON.stringify({ ats: 'greenhouse', scope: 'ats', scopeKey: 'greenhouse', version: 1, match: {}, steps: steps.slice(0, 4), hooks: [] }), 'active', 9, 1, iso(20 * D), iso(2 * D));
    insRecipe.run(recipeIds.companyOld, 'greenhouse', 'company', key, 1, recipe('company', key, 1), 'demoted', 3, 2, iso(12 * D), iso(5 * D));
    insRecipe.run(recipeIds.companyNew, 'greenhouse', 'company', key, 2, recipe('company', key, 2), 'active', 2, 0, iso(5 * D), iso(1 * D));
    const insRun = db.prepare('INSERT INTO form_recipe_runs (recipe_id, ok, detail, at) VALUES (?, ?, ?, ?)');
    insRun.run(recipeIds.companyOld, 0, 'selector for "resume" no longer matched', iso(6 * D));
    insRun.run(recipeIds.companyOld, 0, 'selector for "resume" no longer matched', iso(5 * D));
    insRun.run(recipeIds.companyNew, 1, 'verified 6 of 6 fields', iso(2 * D));
    insRun.run(recipeIds.companyNew, 1, 'verified 6 of 6 fields', iso(1 * D));

    // ── Two fill runs: one sent and verified (files on disk), one that needs the owner.
    const runIds = { submitted: crypto.randomUUID(), needsYou: crypto.randomUUID() };
    const insForm = db.prepare(
      `INSERT INTO form_runs (id, job_id, application_id, campaign_id, url, ats, via, recipe_id, submit, status, verified, reason, fields_total, fields_ok, steps, dir, started_at, finished_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insForm.run(runIds.submitted, jobId, applicationId, url, 'greenhouse', 'recipe', recipeIds.companyNew, 1, 'submitted', 1, 'Sent. The confirmation page was shown.', 6, 6, 1, `forms/runs/${runIds.submitted}`, iso(3 * D), iso(3 * D - 90_000));
    insForm.run(
      runIds.needsYou,
      null,
      null,
      `https://acme-${short()}.wd1.myworkdayjobs.example.net/careers/job/7`,
      'workday',
      'adapter',
      null,
      0,
      'needs_you',
      0,
      'unknown_question: Do you hold a valid forklift licence?',
      14,
      13,
      3,
      `forms/runs/${runIds.needsYou}`,
      iso(5 * H),
      iso(5 * H - 120_000),
    );
    const dir = path.join(dataDir, 'forms', 'runs', runIds.submitted);
    fs.mkdirSync(dir, { recursive: true });
    const fieldLog = [
      { signature: 'a1', label: 'First name', kind: 'text', required: true, source: 'profile', key: 'firstName', intended: 'Mira', readBack: 'Mira', ok: true },
      { signature: 'a2', label: 'Last name', kind: 'text', required: true, source: 'profile', key: 'lastName', intended: 'Okafor', readBack: 'Okafor', ok: true },
      { signature: 'a3', label: 'Email', kind: 'email', required: true, source: 'profile', key: 'email', intended: 'mira.jobs@example.net', readBack: 'mira.jobs@example.net', ok: true },
      { signature: 'a4', label: 'Resume', kind: 'file', required: true, source: 'file', key: 'cv', intended: 'Mira_Okafor_CV.pdf', readBack: 'Mira_Okafor_CV.pdf', ok: true },
      { signature: 'a5', label: 'Will you require sponsorship?', kind: 'select', required: true, source: 'answer_bank', key: 'sponsorship', intended: 'No', readBack: 'No', ok: true },
      { signature: 'a6', label: `Why ${company}?`, kind: 'textarea', required: false, source: 'writer', key: 'why_company', intended: 'Your on-call write-ups read like the ones I keep.', readBack: 'Your on-call write-ups read like the ones I keep.', ok: true },
    ];
    const shots: string[] = [];
    if (opts.shot) {
      fs.writeFileSync(path.join(dir, 'step-1.jpg'), opts.shot);
      shots.push(`forms/runs/${runIds.submitted}/step-1.jpg`);
    }
    fs.writeFileSync(path.join(dir, 'fieldlog.json'), JSON.stringify(fieldLog, null, 1));
    fs.writeFileSync(
      path.join(dir, 'run.json'),
      JSON.stringify(
        {
          status: 'submitted',
          reason: 'Sent. The confirmation page was shown.',
          shotPath: null,
          shots,
          answers: fieldLog.map((f) => ({ label: f.label, value: f.intended, source: f.source })),
          verified: true,
          unknownQuestions: [],
          fieldLog,
          ats: 'greenhouse',
          via: 'recipe',
          recipeId: recipeIds.companyNew,
          url,
          notes: ['recipe used first', 'the submit guard stopped 0 premature submit(s)'],
          problems: [],
        },
        null,
        1,
      ),
    );

    // ── A site account (never a password: that lives in the vault under secret_name).
    const accountDomain = `acme-${short()}.wd1.myworkdayjobs.example.net`;
    db.prepare('INSERT INTO site_accounts (id, domain, username, secret_name, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), accountDomain, 'mira.jobs@example.net', `site_${short()}`, iso(5 * H));

    // ── A crash plan and a gap report.
    const planId = crypto.randomUUID();
    const plan = {
      applicationId,
      company,
      role: 'Platform Engineer',
      interviewDate: new Date(now + 3 * D).toISOString().slice(0, 10),
      gaps: ['Terraform', 'Kubernetes operators'],
      days: [
        { day: 1, focus: 'Terraform modules and state', tasks: ['Read the module docs end to end', 'Split a sample stack into two modules'], resources: [{ title: 'Terraform docs: modules', url: 'https://developer.hashicorp.com/terraform/language/modules', free: true }], miniProject: 'A two-module stack for a toy service' },
        { day: 2, focus: 'Kubernetes operators', tasks: ['Walk through the operator pattern', 'Write a reconcile loop for a ConfigMap'], resources: [{ title: 'Kubernetes docs: operator pattern', url: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/', free: true }], miniProject: null },
        { day: 3, focus: 'Review and talking points', tasks: ['Rehearse the on-call story', 'List three questions for them'], resources: [], miniProject: null },
      ],
      likelyQuestions: ['How would you roll out a breaking Terraform change across environments?', 'Tell us about an incident you led.'],
      talkingPoints: ['Cut p95 latency by 38% on the payments API by moving reads to a replica.'],
    };
    db.prepare('INSERT INTO learning_plans (id, application_id, company, plan, created_at) VALUES (?, ?, ?, ?, ?)').run(planId, applicationId, company, JSON.stringify({ ...plan, _via: 'ai' }), iso(2 * H));
    const gapReportId = crypto.randomUUID();
    const d = new Date(now);
    const week = (() => {
      const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - y.getTime()) / D + 1) / 7)).padStart(2, '0')}`;
    })();
    db.prepare('INSERT INTO gap_reports (id, period, report, created_at) VALUES (?, ?, ?, ?)').run(
      gapReportId,
      week,
      JSON.stringify({
        period: week,
        generatedAt: iso(H),
        jobsConsidered: 42,
        skills: [
          { skill: 'Terraform', count: 11, weighted: 7.4, typicalDepth: 'Writes and reviews modules', suggestedProject: 'Put a small service on Terraform with remote state' },
          { skill: 'Kafka', count: 7, weighted: 4.1, typicalDepth: 'Runs consumers in production', suggestedProject: 'An outbox relay from Postgres to Kafka' },
          { skill: 'Rust', count: 4, weighted: 2.2, typicalDepth: 'Reads and patches services', suggestedProject: 'Port one hot path of a CLI to Rust' },
        ],
      }),
      // Newest, so it wins over any report a running campaign built a moment ago.
      new Date(now + 1000).toISOString(),
    );

    // ── Inbox messages, as the A09 pipeline stores them (never a verification code).
    const msg = (o: { cls: string; from: string; subject: string; at: number; appId: string | null; data: Record<string, unknown> }) => {
      const id = crypto.randomUUID();
      const base = {
        confidence: 0.92,
        company: null,
        role: null,
        code: null,
        links: [],
        schedulingLinks: [],
        dates: [],
        summary: '',
        deadline: null,
        preview: null,
        suspicious: false,
        needsReview: false,
        via: 'rules',
        reason: '',
        link: { score: 0, reasons: [], ambiguous: false, lookalike: false },
        questions: [],
        draft: null,
        unanswered: [],
        interviewDate: null,
        planId: null,
        alerted: false,
        stage: null,
      };
      db.prepare('INSERT INTO inbox_messages (id, message_id, from_addr, subject, received_at, class, application_id, data, handled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)').run(
        id,
        `<${id}@mail.example.net>`,
        o.from,
        o.subject,
        iso(o.at),
        o.cls,
        o.appId,
        JSON.stringify({ ...base, ...o.data }),
      );
      return id;
    };
    const messageIds = {
      interview: msg({
        cls: 'interview_invite',
        from: `talent@${slug}.example.net`,
        subject: 'Next steps: a call with the platform team',
        at: 2 * H,
        appId: applicationId,
        data: {
          company,
          role: 'Platform Engineer',
          summary: 'They want a 45-minute technical call this week; pick a slot with the link.',
          deadline: new Date(now + 2 * D).toISOString(),
          schedulingLinks: [`https://cal.example.net/${slug}/platform`],
          links: [`https://cal.example.net/${slug}/platform`],
          preview: `Hi Mira,\n\nThanks for applying to ${company}. We'd love to set up a 45-minute call with the platform team.\n\nPlease pick a slot here: https://cal.example.net/${slug}/platform\n\nBest,\nTalent team`,
          reason: 'Rule: an invitation to schedule a call with a booking link.',
          link: { score: 95, reasons: ['sender domain matches the company', 'job title in the subject'], ambiguous: false, lookalike: false },
          interviewDate: new Date(now + 3 * D).toISOString().slice(0, 16),
          planId,
          stage: { from: 'applied', to: 'interview' },
          alerted: true,
        },
      }),
      question: msg({
        cls: 'recruiter_question',
        from: `people@${slug}.example.net`,
        subject: 'Quick question about your notice period',
        at: 26 * H,
        appId: applicationId,
        data: {
          company,
          role: 'Platform Engineer',
          via: 'ai',
          confidence: 0.88,
          summary: 'They ask for your notice period and whether you can work UK hours.',
          questions: ['What is your notice period?', 'Can you work UK hours?'],
          unanswered: ['Can you work UK hours?'],
          draft: { to: `people@${slug}.example.net`, subject: 'Re: Quick question about your notice period', body: 'Hi,\n\nMy notice period is four weeks.\n\nBest regards,\nMira', answers: [{ question: 'What is your notice period?', answer: 'Four weeks', source: 'answer_bank', confidence: 0.95 }], status: 'queued' },
          reason: 'Claude: a recruiter asking two screening questions.',
        },
      }),
      rejection: msg({
        cls: 'rejection',
        from: 'no-reply@hire.example.net',
        subject: 'Your application to Bramblewick',
        at: 3 * D,
        appId: null,
        data: { company: 'Bramblewick', summary: 'They chose other candidates for the Data Engineer role.', reason: 'Rule: a decision not to move forward.' },
      }),
      lookalike: msg({
        cls: 'other',
        from: 'security@workday-careers.example.biz',
        subject: 'Action required: verify your candidate account',
        at: 4 * H,
        appId: null,
        data: {
          suspicious: true,
          needsReview: true,
          confidence: 0.4,
          summary: 'Asks you to sign in through a link that is not your employer or Workday.',
          reason: 'Held: the sender carries an ATS brand without being that ATS.',
          link: { score: 0, reasons: [], ambiguous: false, lookalike: true },
        },
      }),
    };
    db.prepare(`INSERT OR REPLACE INTO outcomes (application_id, replied, reply_class, days_to_reply, updated_at) VALUES (?, 1, 'interview_invite', 2.5, ?)`).run(applicationId, iso(2 * H));

    return { jobId, applicationId, company, recipeIds, runIds, messageIds, planId, gapReportId, accountDomain };
  } finally {
    db.close();
  }
}

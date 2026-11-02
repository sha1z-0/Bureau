/**
 * Writes A09's recorded Claude responses into fixtures/claude/<task>/<hash>.json.
 *
 *   npx tsx scripts/a09/record-fixtures.ts            write the recordings
 *   npx tsx scripts/a09/record-fixtures.ts --preview  print each prompt, write nothing
 *
 * It runs the same calls the selfcheck makes (classify the fixtures the code
 * rules leave to the model, the Lumen Pay learning plan, the 2026-W40 gap
 * report) against a throwaway database seeded by scenario.ts, with a fake
 * Claude client that computes the replay hash and saves the hand-written
 * response below instead of calling the API. No network, no API key.
 * Re-run after changing a prompt, the scenario or the fixtures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a09-rec-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_EMBED = 'hash';
const preview = process.argv.includes('--preview');

const S = await import('./scenario.ts');
const { replayHash, FIXTURES_DIR } = await import('../../server/ai/claude.ts');
const { setA09Ai } = await import('../../server/inbox/ai.ts');
const { parseEmail } = await import('../../server/inbox/parse.ts');
const { classifyEmail } = await import('../../server/inbox/classify.ts');
const { setLearningProfileSource } = await import('../../server/learning/profile.ts');
const { buildLearningPlan, buildGapReport } = await import('../../server/learning/index.ts');

const USAGE = {
  inbox_classify: { input_tokens: 1450, output_tokens: 160, cache_read_input_tokens: 620, cache_creation_input_tokens: 0 },
  learning_plan: { input_tokens: 3900, output_tokens: 2600, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  gap_report: { input_tokens: 1700, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
};
const MODEL = { inbox_classify: 'claude-haiku-5-5', learning_plan: 'claude-opus-5-5', gap_report: 'claude-sonnet-5-5' };

// ── Hand-written responses ───────────────────────────────────────────────────

const CLASSIFY: Record<string, unknown> = {
  'Following up on the Platform Engineer role': {
    class: 'rejection',
    confidence: 0.86,
    company: 'Harbor Health',
    role: 'Platform Engineer',
    summary: 'Harbor Health is not moving forward with the Platform Engineer application but invites a new application in the spring.',
    deadline: null,
    dates: [],
    questions: [],
    injection: false,
  },
  'Your application for ML Engineer at Mosaic Robotics': {
    class: 'recruiter_question',
    confidence: 0.91,
    company: 'Mosaic Robotics',
    role: 'ML Engineer',
    summary: 'The Mosaic Robotics recruiter asks for your notice period and whether you would relocate to Berlin.',
    deadline: null,
    dates: [],
    questions: ['What is your notice period?', 'Are you open to relocating to Berlin?'],
    injection: false,
  },
  'Quick question about your Data Engineer application': {
    class: 'recruiter_question',
    confidence: 0.93,
    company: 'Bluefin Analytics',
    role: 'Data Engineer',
    summary: 'The Bluefin Analytics recruiter asks for your notice period before shortlisting you.',
    deadline: null,
    dates: [],
    questions: ['What is your notice period?'],
    injection: false,
  },
  'Urgent: next steps for your Corvid Security application': {
    // The model is told the email is data: it reports the injection instead of obeying it.
    class: 'other',
    confidence: 0.95,
    company: 'Corvid Security',
    role: null,
    summary: 'Phishing-style email from a lookalike domain that tries to instruct an AI and asks for passwords and a passport number.',
    deadline: null,
    dates: [],
    questions: [],
    injection: true,
  },
  'Go developer roles - a couple of questions': {
    class: 'recruiter_question',
    confidence: 0.82,
    company: 'BrightPath Talent',
    role: null,
    summary: 'A BrightPath Talent agency recruiter asks your target salary range and whether you would take contract work.',
    deadline: null,
    dates: [],
    questions: ['What salary range are you targeting?', 'Are you open to contract work?'],
    injection: false,
  },
  // ── A11's shared corpus (fixtures/mail/index.json): the ones the code rules leave open ──
  'Rückmeldung zu Ihrer Bewerbung': {
    class: 'rejection',
    confidence: 0.94,
    company: 'Kranich Software GmbH',
    role: 'Junior Backend Developer (m/w/d)',
    summary: 'Kranich Software GmbH declined the Junior Backend Developer application (German) and will delete the documents after six months.',
    deadline: null,
    dates: [],
    questions: [],
    injection: false,
  },
  'Update on your application – Junior Software Developer': {
    class: 'rejection',
    confidence: 0.9,
    company: 'Pebble Analytics',
    role: 'Junior Software Developer',
    summary: 'Pebble Analytics is proceeding with other applicants; the email also contains text instructing an AI to forward the CV elsewhere.',
    deadline: null,
    dates: [],
    questions: [],
    injection: true,
  },
  'Northwind Labs technical interview': {
    class: 'interview_invite',
    confidence: 0.92,
    company: 'Northwind Labs',
    role: null,
    summary: 'Northwind Labs asks to move the technical interview to Thursday 29 October at 15:00 PKT; reply to confirm or suggest a time.',
    deadline: null,
    dates: ['2026-10-29T15:00'],
    questions: [],
    injection: false,
  },
  'Quick questions about your application': {
    class: 'recruiter_question',
    confidence: 0.93,
    company: 'Brightwater Health',
    role: 'Junior Node.js Developer',
    summary: 'Brightwater Health asks your notice period and salary expectation before sharing your profile with the hiring manager.',
    deadline: null,
    dates: [],
    questions: ['What is your notice period?', 'What is your salary expectation for this role?'],
    injection: false,
  },
  'Backend role in Berlin': {
    class: 'recruiter_question',
    confidence: 0.88,
    company: 'Lindenhof Systems GmbH',
    role: 'Junior Backend Engineer',
    summary: 'Lindenhof Systems asks whether you would relocate to Berlin for a Junior Backend Engineer role with visa and relocation support.',
    deadline: null,
    dates: [],
    questions: ['Are you open to relocating to Berlin?'],
    injection: false,
  },
  'Node.js role at a Series B fintech': {
    class: 'recruiter_question',
    confidence: 0.84,
    company: 'Cobalt Search Partners',
    role: null,
    summary: 'An agency sourcer at Cobalt Search Partners asks if you are open to a 15-minute call about a remote Node.js role at a client.',
    deadline: null,
    dates: [],
    questions: ['Are you open to a quick call about a Node.js role at a Series B fintech?'],
    injection: false,
  },
  'Following up on our call': {
    class: 'offer',
    confidence: 0.9,
    company: 'Quillstack',
    role: 'Associate Software Engineer',
    summary: 'Quillstack made a verbal offer (formal offer to follow via DocuSign) and asks for your decision by 9 November.',
    deadline: '2026-11-09',
    dates: ['2026-11-09', '2026-12-01'],
    questions: [],
    injection: false,
  },
  'people viewed your profile this week': {
    class: 'other',
    confidence: 0.96,
    company: null,
    role: null,
    summary: 'Automated profile-views notification from Linkfolio.',
    deadline: null,
    dates: [],
    questions: [],
    injection: false,
  },
  'Action required: verify your candidate account': {
    class: 'other',
    confidence: 0.93,
    company: null,
    role: null,
    summary: 'Phishing: a fake Workday security notice from a lookalike domain urging you to sign in through an http link.',
    deadline: null,
    dates: [],
    questions: [],
    injection: true,
  },
};

const PLAN = {
  days: [
    {
      day: 1,
      focus: 'Kafka fundamentals',
      tasks: [
        'Run the Kafka quickstart locally in Docker: create a topic, produce and consume from the CLI',
        'Read how partitions, consumer groups and offsets work, and write a one-page summary in your own words',
        'Sketch how LedgerLite would publish a "ledger entry posted" event and who would consume it',
      ],
      resources: [
        { title: 'Apache Kafka quickstart', url: 'https://kafka.apache.org/quickstart', free: true },
        { title: 'Kafka documentation: design', url: 'https://kafka.apache.org/documentation/#design', free: true },
        { title: 'Kafka masterclass (video course)', url: 'https://www.udemy.com/course/apache-kafka/', free: false },
      ],
      miniProject: null,
    },
    {
      day: 2,
      focus: 'Kafka from Go',
      tasks: [
        'Write a Go producer and a consumer with a Go Kafka client, with a consumer group and manual offset commits',
        'Make the consumer idempotent: store processed event ids in PostgreSQL so a replay never double-posts',
        'Kill the consumer mid-batch and confirm nothing is lost or posted twice',
      ],
      resources: [
        { title: 'Kafka consumer configuration', url: 'https://kafka.apache.org/documentation/#consumerconfigs', free: true },
        { title: 'Go by Example: goroutines and channels', url: 'http://gobyexample.com/channels', free: true },
      ],
      miniProject: 'ledger-events: a Go service that consumes "payment captured" events from Kafka and posts balanced double-entry rows to PostgreSQL exactly once.',
    },
    {
      day: 3,
      focus: 'gRPC service design',
      tasks: [
        'Do the gRPC Go quick start and the basics tutorial',
        'Design a small LedgerService proto: PostEntry, GetBalance, and a server-streaming ListEntries',
        'Add deadlines and proper status codes (InvalidArgument, NotFound, FailedPrecondition) to the handlers',
      ],
      resources: [
        { title: 'gRPC Go quick start', url: 'https://grpc.io/docs/languages/go/quickstart/', free: true },
        { title: 'Protocol Buffers language guide (proto3)', url: 'https://protobuf.dev/programming-guides/proto3/', free: true },
      ],
      miniProject: 'ledger-grpc: LedgerLite\'s core operations exposed over gRPC with a streaming endpoint and a Go client.',
    },
    {
      day: 4,
      focus: 'Kubernetes basics for deploying services',
      tasks: [
        'Work through the Kubernetes Basics tutorial on a local kind or minikube cluster',
        'Write a Deployment, Service and ConfigMap for the ledger-grpc service, with readiness and liveness probes',
        'Roll out a new image version and roll it back',
      ],
      resources: [
        { title: 'Kubernetes Basics tutorial', url: 'https://kubernetes.io/docs/tutorials/kubernetes-basics/', free: true },
        { title: 'kind quick start', url: 'https://kind.sigs.k8s.io/docs/user/quick-start/', free: true },
      ],
      miniProject: 'Deploy ledger-grpc and PostgreSQL to a local kind cluster from plain manifests, documented in the README.',
    },
    {
      day: 5,
      focus: 'Observability with Prometheus and OpenTelemetry',
      tasks: [
        'Add request metrics to ledger-grpc with the Prometheus Go client and scrape them locally',
        'Add OpenTelemetry tracing across the Kafka consumer and the gRPC handler',
        'Write down how your span-leak fix in tracing-subscriber maps to tracing in Go',
      ],
      resources: [
        { title: 'OpenTelemetry Go getting started', url: 'https://opentelemetry.io/docs/languages/go/getting-started/', free: true },
        { title: 'Prometheus: instrumenting a Go application', url: 'https://prometheus.io/docs/guides/go-application/', free: true },
      ],
      miniProject: 'A Grafana-free dashboard: one Prometheus query per golden signal for ledger-grpc, screenshotted in the README.',
    },
    {
      day: 6,
      focus: "Lumen Pay's stack: PostgreSQL logical replication and ledgers",
      tasks: [
        'Read the PostgreSQL logical replication chapter and set up a publisher and subscriber locally',
        'Prepare a 3-minute walkthrough of LedgerLite\'s double-entry design and how you keep balances consistent',
        'Practise a ledger design question: idempotent payouts with retries',
      ],
      resources: [{ title: 'PostgreSQL docs: logical replication', url: 'https://www.postgresql.org/docs/current/logical-replication.html', free: true }],
      miniProject: null,
    },
    {
      day: 7,
      focus: 'Review and mock interview',
      tasks: ['Answer the likely questions out loud, timed', 'Rebuild the day 2 consumer from memory in 45 minutes', 'Prepare three questions for Sara about the payments team'],
      resources: [],
      miniProject: null,
    },
  ],
  likelyQuestions: [
    'Walk us through LedgerLite: how do you guarantee every entry balances?',
    'How would you make a payout endpoint idempotent when the client retries?',
    'What happens in Kafka when a consumer in a group dies mid-batch?',
    'How do you choose a partition key for ledger events, and what ordering does it give you?',
    'When would you pick gRPC over REST for an internal service?',
    'How would you design a GetBalance API that stays fast as entries grow?',
    'Describe how you would roll out a schema change to a busy PostgreSQL table.',
    'How do you find the cause of a memory leak in a long-running service?',
    'Tell us about a time you learned a new technology quickly to ship something.',
    'Why Lumen Pay, and why payments?',
  ],
  talkingPoints: [
    "Built Khan Hardware's bookkeeping API in Go and PostgreSQL: the same double-entry ledger problem Lumen Pay solves for its merchants.",
    'Cut month-end closing from 3 days to 2 hours: shows care for correctness and reconciliation, which payouts depend on.',
    'LedgerLite runs two shops with sub-50ms queries on a $5 VPS: evidence of pragmatic PostgreSQL performance work.',
    'Fixed a span leak in tracing-subscriber that cut memory from 1.2 GB to 140 MB: debugging depth that transfers to running services in production.',
    'Kafka and Kubernetes are new to me; I am learning Kubernetes now and built a Kafka consumer into LedgerLite this week to prepare.',
  ],
};

/** Gap report: names and projects keyed by the code's skill names; ids are filled from the prompt's table. */
const GAP_PICKS: { skill: string; from: string[]; typicalDepth: string; suggestedProject: string }[] = [
  {
    skill: 'Kafka',
    from: ['Kafka', 'an event streaming platform'],
    typicalDepth: 'production experience',
    suggestedProject: 'Add a Kafka event stream to LedgerLite: publish "entry posted" events from Go and build an idempotent consumer that keeps a balances table in PostgreSQL.',
  },
  {
    skill: 'Kubernetes',
    from: ['Kubernetes'],
    typicalDepth: 'working proficiency',
    suggestedProject: 'Deploy LedgerLite and PostgreSQL to a local kind cluster with probes, a rolling update and a Helm chart, documented step by step.',
  },
  {
    skill: 'gRPC',
    from: ['gRPC'],
    typicalDepth: 'advanced',
    suggestedProject: "Expose LedgerLite's API over gRPC with a streaming endpoint, deadlines and error codes, plus a small Go client.",
  },
  {
    skill: 'Terraform',
    from: ['Terraform'],
    typicalDepth: 'working proficiency',
    suggestedProject: 'Write Terraform that provisions a small VPS, firewall and managed PostgreSQL for LedgerLite, with remote state.',
  },
  {
    skill: 'AWS',
    from: ['AWS'],
    typicalDepth: 'working proficiency',
    suggestedProject: 'Run LedgerLite on AWS free tier: one ECS service, RDS PostgreSQL and a Lambda that exports a nightly CSV to S3.',
  },
  {
    skill: 'Observability',
    from: ['Observability'],
    typicalDepth: 'familiarity',
    suggestedProject: 'Instrument LedgerLite with Prometheus metrics and OpenTelemetry traces and write up the three alerts you would page on.',
  },
  {
    skill: 'Rust',
    from: ['Rust'],
    typicalDepth: 'familiarity',
    suggestedProject: 'Port the LedgerLite balance calculator to a small Rust CLI and benchmark it against the Go version.',
  },
];

function gapOutput(content: string) {
  const ids = new Map<string, string>();
  for (const line of content.split('\n')) {
    const m = /^([SL]\d+) \| ([^|]+) \|/.exec(line);
    if (m) ids.set(m[2].trim().toLowerCase(), m[1]);
  }
  const skills = GAP_PICKS.map((p) => ({
    skill: p.skill,
    ids: p.from.map((f) => ids.get(f.toLowerCase())).filter((x): x is string => !!x),
    typicalDepth: p.typicalDepth,
    suggestedProject: p.suggestedProject,
  })).filter((s) => s.ids.length);
  // A made-up id the code must ignore.
  skills.push({ skill: 'Blockchain', ids: ['S99'], typicalDepth: 'expert', suggestedProject: 'Build a token.' });
  return { skills };
}

// ── Recorder ─────────────────────────────────────────────────────────────────

type Task = 'inbox_classify' | 'learning_plan' | 'gap_report';
const written: string[] = [];

setA09Ai({
  structured: (async (opts: { task: Task; system: Parameters<typeof replayHash>[1]; content: string; schema: { parse(v: unknown): unknown } }) => {
    const hash = replayHash(opts.task, opts.system, opts.content);
    let output: unknown;
    let label: string;
    if (opts.task === 'inbox_classify') {
      const subject = /^Subject: (.*)$/m.exec(opts.content)?.[1] ?? '';
      output = CLASSIFY[subject] ?? Object.entries(CLASSIFY).find(([k]) => subject.includes(k))?.[1];
      label = subject;
      if (!output) throw new Error(`No canned classification for "${subject}"`);
    } else if (opts.task === 'learning_plan') {
      output = PLAN;
      label = 'Lumen Pay learning plan';
    } else {
      output = gapOutput(opts.content);
      label = `${S.GAP_PERIOD} gap report`;
    }
    if (preview) console.log(`\n── ${opts.task} ${hash} (${label})\n${opts.content}\n`);
    else {
      const file = path.join(FIXTURES_DIR, 'claude', opts.task, `${hash}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ task: opts.task, hash, model: MODEL[opts.task], case: `a09: ${label}`, usage: USAGE[opts.task], output }, null, 2)}\n`);
      written.push(path.relative(process.cwd(), file));
    }
    return opts.schema.parse(output);
  }) as never,
});
setLearningProfileSource(async () => S.PROFILE);

await S.seed();
for (const f of [...S.MODEL_CASES, ...S.A11_MODEL_CASES]) await classifyEmail(await parseEmail(fs.readFileSync(S.mailFile(f))));
await buildLearningPlan(S.appId('lumen'), S.LUMEN_PLAN.interviewDate, { startAt: S.LUMEN_PLAN.startAt, force: true });
await buildGapReport(S.GAP_PERIOD);

// Remove stale A09 recordings (only ours: they carry an "a09:" case).
for (const task of ['inbox_classify', 'learning_plan', 'gap_report']) {
  const dir = path.join(FIXTURES_DIR, 'claude', task);
  if (preview || !fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as { case?: string };
      if (j.case?.startsWith('a09:') && !written.includes(path.relative(process.cwd(), p))) fs.rmSync(p);
    } catch {
      /* not ours */
    }
  }
}

const { db } = await import('../../server/db.ts');
db.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(preview ? 'Preview only, nothing written.' : `Wrote ${written.length} recordings:\n  ${written.join('\n  ')}`);

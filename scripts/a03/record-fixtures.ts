/**
 * Writes A03's recorded Claude responses into fixtures/claude/<task>/<hash>.json.
 *
 *   npx tsx scripts/a03/record-fixtures.ts            write the recordings
 *   npx tsx scripts/a03/record-fixtures.ts --preview  print what each call sends, write nothing
 *
 * It runs the same calls the selfcheck makes (scripts/a03/scenario.ts) with a
 * fake Claude client that, instead of calling the API, computes the replay hash
 * and saves the canned response below. The canned responses are what a careful
 * model would answer, plus one deliberately fabricated claim per source that the
 * code-side verbatim guard must reject. No network, no API key.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod/v4';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-a03-rec-'));
process.env.BUREAU_DATA_DIR = path.join(sandbox, 'data');
process.env.BUREAU_EMBED = 'hash';
const preview = process.argv.includes('--preview');

const S = await import('./scenario.ts');
const { replayHash, FIXTURES_DIR } = await import('../../server/ai/claude.ts');
const { recordedFetcher } = await import('../../server/profile/fetch.ts');
const { syncGithub } = await import('../../server/profile/github.ts');
const { syncPortfolio } = await import('../../server/profile/portfolio.ts');
const { importLinkedInText } = await import('../../server/profile/linkedin.ts');
const { researchCompany } = await import('../../server/research/index.ts');
type AiClient = import('../../server/profile/ai.ts').AiClient;

const USAGE = { input_tokens: 4200, output_tokens: 650, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const GH = 'https://github.com/ayesha-dev';
const SITE = 'https://ayesha.example.com';
const LUMEN = 'https://lumenpay.example.net';

const PROFILE_SYNC: Record<string, { facts: { kind: string; text: string; sourceRef: string }[] }> = {
  github: {
    facts: [
      { kind: 'project', text: 'LedgerLite is a double-entry bookkeeping API for small shops.', sourceRef: `${GH}/ledgerlite` },
      { kind: 'project', text: "I built it for my family's hardware store in Lahore, which still runs on it.", sourceRef: `${GH}/ledgerlite` },
      { kind: 'metric', text: 'Handles 3 years of transactions for 2 shops with sub-50ms queries on a $5 VPS', sourceRef: `${GH}/ledgerlite` },
      { kind: 'skill', text: 'Written in Go with PostgreSQL and sqlc', sourceRef: `${GH}/ledgerlite` },
      // Fabricated: the README says nothing of the sort. The verbatim guard must drop it.
      { kind: 'metric', text: 'Scaled LedgerLite to 10,000 shops across Pakistan', sourceRef: `${GH}/ledgerlite` },
      { kind: 'project', text: 'This fork fixes a span leak in tracing-subscriber when spans are dropped across await points.', sourceRef: `${GH}/tokio-tracing-fix` },
      { kind: 'metric', text: 'Cut span memory in our worker from 1.2 GB to 140 MB over a day of traffic.', sourceRef: `${GH}/tokio-tracing-fix` },
    ],
  },
  portfolio: {
    facts: [
      { kind: 'experience', text: "I build reliable backends for small businesses. I'm a backend developer based in Lahore.", sourceRef: `${SITE}/` },
      { kind: 'metric', text: 'Pixel Pantry is a recipe sharing PWA that works offline; 300 home cooks used it during the beta.', sourceRef: `${SITE}/projects` },
      { kind: 'achievement', text: 'Won first place at the FAST NUCES Lahore hackathon 2025 with a bus-tracking app built in 24 hours.', sourceRef: `${SITE}/projects` },
      { kind: 'metric', text: 'LedgerLite replaced a paper ledger at a hardware store with two branches. It posts about 400 entries a day.', sourceRef: `${SITE}/projects/ledgerlite` },
      { kind: 'skill', text: 'The API is written in Go, stores everything in PostgreSQL, and is deployed with Docker on a single VPS.', sourceRef: `${SITE}/projects/ledgerlite` },
      { kind: 'education', text: 'I studied Computer Science at FAST NUCES Lahore and graduate in June 2027.', sourceRef: `${SITE}/about` },
      { kind: 'experience', text: "I mentor first-year students in the university's programming club every week.", sourceRef: `${SITE}/about` },
      { kind: 'metric', text: 'Span memory dropped from 1.2 GB to 140 MB over a day of traffic.', sourceRef: `${SITE}/blog/span-leak` },
      // Fabricated: cites a page we never sent. Must be dropped.
      { kind: 'achievement', text: 'Speaker at GopherCon 2026', sourceRef: `${SITE}/talks` },
    ],
  },
  linkedin: {
    facts: [
      { kind: 'experience', text: "I'm a backend developer in Lahore who builds bookkeeping and payments software for small shops.", sourceRef: 'linkedin-paste' },
      { kind: 'experience', text: "Built the store's bookkeeping API in Go and PostgreSQL.", sourceRef: 'linkedin-paste' },
      { kind: 'metric', text: 'Cut month-end closing from 3 days to 2 hours.', sourceRef: 'linkedin-paste' },
      { kind: 'experience', text: 'I run weekly problem-solving sessions for first-year students.', sourceRef: 'linkedin-paste' },
      // Embellished: "4 hours" is not in the text. Must be dropped.
      { kind: 'metric', text: 'Cut month-end closing from 3 days to 4 hours for 5 stores.', sourceRef: 'linkedin-paste' },
    ],
  },
};

const RESEARCH_TEXT = `Lumen Pay builds checkout and ledger tools for independent shops in Pakistan and the Gulf. Its own site describes two products: Lumen Pay Checkout for card and wallet payments online and in store, and the Lumen Ledger API for developers. In September 2026 it announced a Series A, and its engineering blog describes moving the ledger to PostgreSQL logical replication. The careers page names Sara Malik as the Engineering Manager for Payments.

\`\`\`json
{
  "whatTheyBuild": "Checkout and a double-entry ledger API for independent retailers in Pakistan and the Gulf, online and in store.",
  "products": [
    { "text": "Lumen Pay Checkout: card and wallet payments for independent retailers, online and in store", "sourceUrl": "${LUMEN}/" },
    { "text": "Lumen Ledger API: a double-entry ledger for every payout", "sourceUrl": "${LUMEN}/" },
    { "text": "Lumen Payroll for gig workers", "sourceUrl": "https://unknown-blog.example.org/lumen-payroll" }
  ],
  "recent": [
    { "text": "Raised a $12M Series A led by Sequoia-backed Surge alumni fund to expand into Saudi Arabia", "sourceUrl": "https://techcrunch.example.com/2026/09/15/lumen-pay-series-a", "date": "2026-09-15" },
    { "text": "Moved the ledger to PostgreSQL logical replication to cut payout reconciliation time", "sourceUrl": "${LUMEN}/engineering", "date": "2026-09" },
    { "text": "Launched in the UAE", "sourceUrl": "https://news.example.com/2025/01/lumen-uae", "date": "2025-01-10" }
  ],
  "techSignals": [
    { "text": "Backend written in Go on PostgreSQL", "sourceUrl": "${LUMEN}/engineering" },
    { "text": "Payments team uses Go, PostgreSQL and Kafka", "sourceUrl": "${LUMEN}/careers" }
  ],
  "values": [
    { "text": "Mission: money should move as fast as messages", "sourceUrl": "${LUMEN}/about" }
  ],
  "stage": "Series A (2026)",
  "teamSize": "about 40 people in Lahore and Dubai",
  "hiringContact": { "name": "Sara Malik", "role": "Engineering Manager, Payments", "sourceUrl": "${LUMEN}/careers" }
}
\`\`\``;

const RESEARCH_SOURCES = [
  { url: 'https://techcrunch.example.com/2026/09/15/lumen-pay-series-a', title: 'Lumen Pay raises $12M Series A' },
  { url: `${LUMEN}/engineering`, title: 'Engineering at Lumen Pay' },
  { url: 'https://news.example.com/2025/01/lumen-uae', title: 'Lumen Pay launches in UAE' },
];

let next: { output?: unknown; text?: string; sources?: { url: string; title: string }[] } = {};
const written: string[] = [];

function save(task: string, hash: string, body: Record<string, unknown>) {
  const file = path.join(FIXTURES_DIR, 'claude', task, `${hash}.json`);
  if (preview) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ task, hash, model: 'claude-sonnet-5-5', usage: USAGE, ...body }, null, 2)}\n`);
  written.push(path.relative(path.join(FIXTURES_DIR, '..'), file));
}

const recorder: AiClient = {
  structured: (async <S extends z.ZodType>(opts: { task: Parameters<typeof replayHash>[0]; system: Parameters<typeof replayHash>[1]; content: Parameters<typeof replayHash>[2]; schema: S }) => {
    const hash = replayHash(opts.task, opts.system, opts.content);
    if (preview) console.log(`\n── structured ${opts.task} ${hash}\n${typeof opts.content === 'string' ? opts.content : JSON.stringify(opts.content)}`);
    save(opts.task, hash, { output: next.output });
    return opts.schema.parse(next.output);
  }) as AiClient['structured'],
  research: (async (opts: { task: Parameters<typeof replayHash>[0]; system: Parameters<typeof replayHash>[1]; prompt: string }) => {
    const hash = replayHash(opts.task, opts.system, opts.prompt);
    if (preview) console.log(`\n── research ${opts.task} ${hash}\n${opts.prompt}`);
    save(opts.task, hash, { text: next.text, sources: next.sources });
    return { text: next.text ?? '', sources: next.sources ?? [] };
  }) as AiClient['research'],
};

next = { output: PROFILE_SYNC.github };
await syncGithub({ login: S.GITHUB_LOGIN, fetcher: recordedFetcher(S.GITHUB_DIR), ai: recorder, now: S.NOW, token: null });

next = { output: PROFILE_SYNC.portfolio };
await syncPortfolio({ url: S.PORTFOLIO_URL, fetcher: recordedFetcher(S.PORTFOLIO_DIR), ai: recorder });

next = { output: PROFILE_SYNC.linkedin };
await importLinkedInText(fs.readFileSync(path.join(S.LINKEDIN_DIR, 'paste.txt'), 'utf8'), recorder);

next = { text: RESEARCH_TEXT, sources: RESEARCH_SOURCES };
await researchCompany(S.RESEARCH_COMPANY, S.RESEARCH_DOMAIN, { fetcher: recordedFetcher(S.RESEARCH_DIR), ai: recorder, now: S.NOW, force: true });

const { db } = await import('../../server/db.ts');
db.close();
fs.rmSync(sandbox, { recursive: true, force: true });
console.log(preview ? '\n(preview only, nothing written)' : `\nWrote:\n  ${written.join('\n  ')}`);

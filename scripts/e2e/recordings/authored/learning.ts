/**
 * The crash plan (task `learning_plan`, A09) the alert stage asks for when the
 * Lumen Ledger interview invite arrives. In the full e2e the plan's prompt
 * carries this run's match (gaps) and research, so it differs from A09's own
 * fixture prompt; this is the answer for the e2e's version.
 */
import { contentText, type Answer, type DumpedRequest } from './index.ts';

const LUMEN_LEDGER_PLAN = {
  days: [
    {
      day: 1,
      focus: 'AWS basics for a Node.js and PostgreSQL service (the one listed gap)',
      tasks: [
        'Read the AWS overview of compute and database options and note where ECS and RDS fit',
        'Read how RDS for PostgreSQL differs from the self-managed PostgreSQL you run today: backups, parameter groups, connection limits',
        'Write half a page on how you would move the Docker Compose services you migrated at Tessellate onto ECS with RDS, and what you would ask before doing it',
      ],
      resources: [
        { title: 'Overview of Amazon Web Services (AWS whitepaper)', url: 'https://docs.aws.amazon.com/whitepapers/latest/aws-overview/introduction.html', free: true },
        { title: 'Amazon RDS for PostgreSQL user guide', url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html', free: true },
      ],
      miniProject: null,
    },
    {
      day: 2,
      focus: 'Matching in PostgreSQL, the way Lumen Ledger describes it',
      tasks: [
        'Re-read the PostgreSQL chapters on joins, indexes and EXPLAIN with bank-line matching in mind',
        'Load a small CSV of bank lines and open invoices into PostgreSQL and write a set-based query that proposes matches by amount and date window',
        'Run EXPLAIN ANALYZE on it, add the index it needs and note the before and after',
      ],
      resources: [
        { title: 'PostgreSQL documentation: Using EXPLAIN', url: 'https://www.postgresql.org/docs/current/using-explain.html', free: true },
        { title: 'PostgreSQL documentation: Partial indexes', url: 'https://www.postgresql.org/docs/current/indexes-partial.html', free: true },
      ],
      miniProject: 'bank-match: a small TypeScript script that matches a bank CSV to open invoices in PostgreSQL with one set-based query, with tests for exact, partial and unmatched lines.',
    },
    {
      day: 3,
      focus: 'Safe migrations and small, tested changes in Node.js',
      tasks: [
        'Write an expand-then-contract migration for renaming a column on a busy table, with the rollback written first',
        'Add tests around the bank-match query with the Node.js built-in test runner',
        'Prepare the two-minute story of the reconciliation job going from 41 minutes to 6',
      ],
      resources: [
        { title: 'Node.js documentation: Test runner', url: 'https://nodejs.org/api/test.html', free: true },
        { title: 'PostgreSQL documentation: ALTER TABLE', url: 'https://www.postgresql.org/docs/current/sql-altertable.html', free: true },
      ],
      miniProject: null,
    },
    {
      day: 4,
      focus: 'Review and mock interview',
      tasks: [
        'Answer the likely questions out loud, timed, and note the ones that took too long',
        'Walk through ledger-lite and the reconciliation fix as if to a senior engineer, including what you would do differently',
        'Write down three questions for the team about the matching engine and the support rotation',
      ],
      resources: [{ title: 'PostgreSQL documentation: Transaction isolation', url: 'https://www.postgresql.org/docs/current/transaction-iso.html', free: true }],
      miniProject: null,
    },
  ],
  likelyQuestions: [
    'Walk us through a slow query you fixed. How did you find the cause?',
    'How would you match a bank line to an invoice when the amounts differ by a fee?',
    'How do you change a column on a large, busy PostgreSQL table without downtime?',
    'What does a database constraint give you that a check in application code does not?',
    'How do you make sure an import job can be re-run safely?',
    'Tell us about a time something you shipped broke. What changed afterwards?',
    'Have you used AWS? How would you approach learning it on the job?',
    'How do you review a pull request from a teammate?',
    'Why reconciliation software, and why Lumen Ledger?',
  ],
  talkingPoints: [
    'Cut the nightly reconciliation job at Tessellate Labs from 41 minutes to 6 with set-based SQL and two partial indexes: the same kind of query work as a matching engine.',
    'Built and maintains the Node.js and TypeScript invoicing service on PostgreSQL that issues about 9,000 invoices a month.',
    'ledger-lite enforces balanced journal entries with a database constraint, so an unbalanced entry cannot commit.',
    'Moved four services to Docker Compose with health checks and wrote the runbook the on-call rotation uses.',
    'Reviews pull requests for the billing team and paired with two interns through their first month.',
    'No AWS yet: she is honest about it and has a concrete plan to learn RDS and ECS first.',
  ],
};

export function learningAnswer(req: DumpedRequest): Answer {
  const text = contentText(req);
  const company = text.match(/^Company: (.+)$/m)?.[1]?.trim();
  const role = text.match(/^Role: (.+)$/m)?.[1]?.trim();
  const days = Number(text.match(/^Plan length: (\d+) days?$/m)?.[1] ?? 0);
  if (company === 'Lumen Ledger' && role === 'Junior Backend Engineer' && days === LUMEN_LEDGER_PLAN.days.length) {
    return { label: 'learning plan: Lumen Ledger', body: { output: LUMEN_LEDGER_PLAN } };
  }
  return { skip: `learning_plan: nothing authored for ${company} / ${role} (${days} days)` };
}

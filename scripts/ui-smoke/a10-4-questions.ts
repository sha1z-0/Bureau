import type { UiSmoke } from '../ui-smoke.ts';
import { apiGet, assert, findDataDir, plantUnknownQuestion, waitFor } from '../a10/smoke-lib.ts';

interface Q {
  id: string;
  questionRaw: string;
  status: string;
}

/** An unknown form question is answered from the Questions page: it lands in the answer bank and the job is re-queued. */
export default async function questions(t: UiSmoke) {
  const { page } = t;
  const QUESTION = 'Do you hold a valid UAE driving licence?';
  const dir = findDataDir((t as UiSmoke & { dataDir?: string }).dataDir);
  let planted: { jobId: string; questionId: string } | null = null;

  await t.step('a question the form engine could not answer is waiting', async () => {
    assert(dir, 'could not find the smoke server data dir');
    planted = await plantUnknownQuestion(dir!, QUESTION, ['Yes', 'No']);
    await page.goto(`${t.base}/#/questions`);
    await page.waitForSelector(`[data-testid="question"]:has-text("${QUESTION}")`, { timeout: 10_000 });
  });

  await t.step('the badge counts it', async () => {
    const shell = await apiGet<{ counts: { questions: number } }>(page, '/api/shell');
    assert(shell.counts.questions >= 1, 'the shell shows no open question');
  });

  await t.step('answering saves to the bank and re-queues the job', async () => {
    const card = page.locator('[data-testid="question"]', { hasText: QUESTION });
    await card.locator('button[role="radio"]:has-text("No")').click();
    await card.locator('[data-testid="question-save"]').click();
    const ok = await waitFor(async () => {
      const qs = await apiGet<{ questions: Q[] }>(page, '/api/master/questions?status=answered');
      return qs.questions.some((q) => q.id === planted!.questionId);
    });
    assert(ok, 'the question is not marked answered');
    const bank = await apiGet<{ answers: { questionRaw: string; answer: string }[] }>(page, '/api/master/answers');
    assert(
      bank.answers.some((a) => a.questionRaw === QUESTION && a.answer === 'No'),
      'the answer is not in the answer bank',
    );
    const file = await apiGet<{ pipeline: { state: string } | null }>(page, `/api/pipeline/jobs/${planted!.jobId}`);
    assert(file.pipeline?.state === 'selected', `the job was not re-queued (state ${file.pipeline?.state})`);
  });

  await t.step('the open list is empty again', async () => {
    await page.waitForSelector('text=Nothing to answer', { timeout: 10_000 });
  });
}

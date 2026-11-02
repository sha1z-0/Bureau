import { redact } from '../errors.ts';
import type { Campaign } from '../contracts/campaign.ts';
import { escapeHtml } from '../notify/telegram.ts';
import { startTelegramPoller, type CommandHandlers } from '../notify/commands.ts';
import { answerQuestion } from './answers.ts';
import { findCampaign, isDryRun, listCampaigns } from './campaigns.ts';
import { realDeps } from './deps.ts';
import { buildDigest, renderDigestTelegram } from './digest.ts';
import { Engine } from './engine.ts';
import { killState, stopFilePresent, type KillSource } from './kill.ts';

/** A08: campaign autopilot. Public entry points (02-CONTRACTS §4) plus the engine singleton. */

export { Engine } from './engine.ts';
export * from './campaigns.ts';
export { onKill, killState, stopFilePresent, STOP_FILE } from './kill.ts';

let engine: Engine | null = null;

/** The process-wide engine (created on first use with the real modules). */
export function getEngine(): Engine {
  engine ??= new Engine(realDeps());
  return engine;
}

/** Tests only: swap in an engine built on fakes. Returns the previous one. */
export function setEngine(next: Engine | null): Engine | null {
  const prev = engine;
  engine = next;
  return prev;
}

export async function startCampaign(id: string): Promise<Campaign> {
  return getEngine().startCampaign(id);
}

export async function pauseCampaign(id: string, reason?: string): Promise<Campaign> {
  return getEngine().pauseCampaign(id, reason);
}

export async function resumeCampaign(id: string): Promise<Campaign> {
  return getEngine().resumeCampaign(id);
}

export async function endCampaign(id: string, reason?: string) {
  return getEngine().endCampaign(id, reason);
}

/** Stop every worker within 5 seconds and close browsers. */
export async function killAll(reason: string, source: KillSource = 'api') {
  return getEngine().kill(reason, source);
}

/** One scheduler pass: scout / match / apply / inbox / digest as each is due. */
export async function tick(): Promise<void> {
  await getEngine().tick();
}

// ── Telegram commands ────────────────────────────────────────────────────────

function pickCampaign(ref: string, statuses: Campaign['status'][]): Campaign {
  if (ref.trim()) {
    const c = findCampaign(ref);
    if (!c) throw new Error(`No campaign called "${ref.trim()}".`);
    return c;
  }
  const list = listCampaigns().filter((c) => statuses.includes(c.status));
  if (list.length === 1) return list[0];
  if (!list.length) throw new Error('There is no campaign to do that to.');
  throw new Error(`Which one? ${list.map((c) => c.name).join(', ')}`);
}

export function telegramHandlers(e: Engine = getEngine()): CommandHandlers {
  return {
    async status() {
      const lines: string[] = [];
      const k = killState();
      if (k) lines.push(`<b>Stopped</b> (${escapeHtml(k.source)}): ${escapeHtml(k.reason)}`);
      if (stopFilePresent()) lines.push('The data/STOP file is present.');
      const st = e.status();
      if (st.current) lines.push(`Working on a job: ${escapeHtml(st.current.step)}`);
      const list = listCampaigns().filter((c) => c.status !== 'ended');
      if (!list.length) lines.push('No campaigns yet.');
      for (const c of list) {
        const s = e.campaignStats(c);
        const mode = c.status === 'active' ? (isDryRun(c, e.deps.clock.now()) ? 'dry run' : 'live') : c.status;
        lines.push(
          `<b>${escapeHtml(c.name)}</b>: ${mode}. Today ${s.today.done}/${s.today.cap}. Queued ${(s.counts.selected ?? 0) + (s.counts.written ?? 0)}. Needs you ${s.counts.needs_you ?? 0}.`,
        );
      }
      if (st.nextApplyAt && !k) lines.push(`Next application not before ${st.nextApplyAt.slice(11, 16)} UTC.`);
      return lines.join('\n');
    },
    async today() {
      const active = listCampaigns().filter((c) => c.status === 'active' || c.status === 'paused');
      if (!active.length) return 'No running campaigns.';
      return active.map((c) => renderDigestTelegram(buildDigest(c, e.deps.clock.now(), { sourceHealth: () => e.deps.sourceHealth() }))).join('\n\n');
    },
    async stop() {
      const r = await e.kill('Stopped from Telegram', 'telegram');
      return `Stopped${r.settled ? '' : ' (the last step is still closing)'}. Every campaign is paused. Send /resume &lt;campaign&gt; to continue.`;
    },
    async pause(ref) {
      const c = pickCampaign(ref, ['active']);
      e.pauseCampaign(c.id, 'Paused from Telegram');
      return `Paused <b>${escapeHtml(c.name)}</b>.`;
    },
    async resume(ref) {
      const c = pickCampaign(ref, ['paused', 'draft']);
      const r = e.resumeCampaign(c.id);
      return `Resumed <b>${escapeHtml(r.name)}</b>${isDryRun(r, e.deps.clock.now()) ? ' (dry run)' : ''}.`;
    },
    async answer(ref, text) {
      const r = await answerQuestion(ref, text);
      return `Saved. "${escapeHtml(r.question.slice(0, 120))}" now has an answer${r.jobId ? ' and the job is queued again' : ''}.`;
    },
  };
}

// ── Boot ─────────────────────────────────────────────────────────────────────

let booted = false;

/** Called once at server start: recover, resume active campaigns, watch data/STOP, listen on Telegram. */
export function startAutopilot(): void {
  if (booted) return;
  booted = true;
  try {
    const e = getEngine();
    e.start();
    // The STOP file trips the switch within a couple of seconds, not at the next tick.
    const watch = setInterval(() => {
      if (stopFilePresent() && !killState()) void e.kill('The data/STOP file is present', 'file').catch(() => undefined);
    }, 2000);
    watch.unref();
    const ctl = new AbortController();
    void startTelegramPoller(telegramHandlers(e), { signal: ctl.signal });
    const shutdown = () => {
      ctl.abort();
      e.stop();
    };
    process.once('exit', shutdown);
  } catch (err) {
    console.error(`  ! Autopilot did not start: ${redact((err as Error).message)}`);
  }
}

/**
 * Build and store (without sending) the digest for one campaign's day. `date`
 * is any ISO time inside that day; defaults to now. Used by tests and previews.
 */
export async function buildCampaignDigest(campaignId: string, date?: string): Promise<{ id: string; content: unknown }> {
  const { requireCampaign } = await import('./campaigns.ts');
  const { buildDigest: build, saveDigest } = await import('./digest.ts');
  const content = build(requireCampaign(campaignId), date ? Date.parse(date) : Date.now());
  return { id: saveDigest(content), content };
}

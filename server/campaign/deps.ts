import fs from 'node:fs';
import path from 'node:path';
import type { CampaignConfig } from '../contracts/campaign.ts';
import type { FillOptions, FillOutcome } from '../contracts/forms.ts';
import type { GapReport } from '../contracts/learning.ts';
import type { ApplicationPacket, WriteResult } from '../contracts/writer.ts';
import type { NotifyPayload } from '../notify/index.ts';
import { matchJobs, pendingForMatch, selectForCampaign } from '../match/index.ts';
import { aiSettings, monthSpend } from '../ai/claude.ts';
import { get } from '../db.ts';
import { sourceHealth as scoutHealth } from '../scout/index.ts';
import { secretHint } from '../security/vault.ts';
import { sendApplicationEmail, smtpSettings } from '../services/mailer.ts';
import { realClock, type Clock } from './clock.ts';
import { createKeepAwake, type KeepAwake } from './awake.ts';

/**
 * The engine's seam to every other module. Production wires the real
 * functions (lazily, so importing the campaign module never loads the browser
 * stack); tests pass fakes. A stage whose module still throws NotImplemented is
 * "unavailable": logged once and skipped, never fatal.
 */
export interface EngineDeps {
  clock: Clock;
  scout(opts: { campaignId?: string; sources?: string[] }): Promise<{ found: number; added: string[] }>;
  match(jobIds: string[], cfg: CampaignConfig, opts: { campaignId: string }): Promise<unknown[]>;
  pendingForMatch(campaignId: string): string[];
  selectForCampaign(cfg: CampaignConfig, campaignId: string, slots: number): string[];
  syncProfile(): Promise<{ added: number }>;
  pollInbox(): Promise<number>;
  buildGapReport(period?: string): Promise<{ id: string; report: GapReport }>;
  /** Optional, resolved by name when the owning module exports it (A01 / A06). */
  discoverCompanies(opts: { campaignId?: string }): Promise<unknown>;
  recipeJobs(): Promise<unknown>;
  write(jobId: string, campaignId: string): Promise<WriteResult>;
  fill(packet: ApplicationPacket, opts: FillOptions): Promise<FillOutcome>;
  /** Send the packet by email. Resolves with a message id. */
  sendEmail(input: { to: string; packet: ApplicationPacket }): Promise<string>;
  emailReady(): boolean;
  /** Deliver to the owner's channels. Resolves with the channels that took it. */
  notify(kind: 'alert' | 'digest' | 'info', payload: NotifyPayload): Promise<{ via: string[] } | void>;
  /** Push new unknown questions to Telegram. Resolves with how many went out. */
  pushQuestions(): Promise<number>;
  /** Scout source health for the digest (A01). */
  sourceHealth(): { id: string; label: string; status: string; lastError: string | null }[];
  /** This month's AI spend and the owner's monthly cap (0 = no cap). */
  monthBudget(): { spentUsd: number; budgetUsd: number };
  /** AI spend since an instant. */
  /** AI spend since `iso`; with a campaign id, that campaign's tagged spend plus untagged shared spend (scouting, matching). */
  spendSince(iso: string, campaignId?: string): number;
  /**
   * The writer's current packet for an application, re-gated: the packet (owner edits
   * included) when it still passes lint and the truth lock, null when an edit broke the
   * gates, undefined when the application wasn't written by the v2 writer.
   */
  freshPacket?(applicationId: string): Promise<ApplicationPacket | null | undefined>;
  keepAwake: KeepAwake;
  /** Close anything holding a browser (kill switch). */
  closeBrowsers(reason: string): Promise<void>;
}

export function isNotImplemented(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as Error).name === 'NotImplemented';
}

export class Unavailable extends Error {
  constructor(what: string) {
    super(`${what} is not available yet`);
    this.name = 'NotImplemented';
  }
}

/** Call an optional export by name; throws NotImplemented-shaped error when it does not exist. */
async function optional<T>(load: () => Promise<Record<string, unknown>>, name: string, ...args: unknown[]): Promise<T> {
  const mod = await load();
  const fn = mod[name];
  if (typeof fn !== 'function') throw new Unavailable(name);
  return (await (fn as (...a: unknown[]) => Promise<T>)(...args)) as T;
}

export function realDeps(over: Partial<EngineDeps> = {}): EngineDeps {
  const base: EngineDeps = {
    clock: realClock,
    scout: async (opts) => (await import('../scout/index.ts')).runScout(opts),
    match: (ids, cfg, opts) => matchJobs(ids, cfg, opts),
    pendingForMatch: (id) => pendingForMatch(id),
    selectForCampaign: (cfg, id, slots) => selectForCampaign(cfg, id, slots),
    syncProfile: async () => (await import('../profile/index.ts')).syncProfile(),
    pollInbox: async () => (await import('../inbox/index.ts')).pollInbox(),
    buildGapReport: async (period) => (await import('../learning/index.ts')).buildGapReport(period),
    discoverCompanies: (opts) => optional(() => import('../scout/index.ts') as Promise<Record<string, unknown>>, 'discoverCompanies', opts),
    recipeJobs: () => optional(() => import('../agent/index.ts') as Promise<Record<string, unknown>>, 'runRecipeJobs'),
    write: async (jobId, campaignId) => (await import('../writer/index.ts')).writeApplication(jobId, campaignId),
    freshPacket: async (applicationId) => {
      const w = await import('../writer/packet.ts');
      const p = w.loadPacket(applicationId);
      if (p) return p;
      const row = get<{ notes: string }>('SELECT notes FROM applications WHERE id = ?', applicationId);
      return row && w.readNotes(row.notes).writer?.status === 'written' ? null : undefined;
    },
    fill: async (packet, opts) => (await import('../forms/index.ts')).fillApplication(packet, opts),
    sendEmail: async ({ to, packet }) => {
      const file = packet.cvPdfPath;
      const content = fs.readFileSync(file);
      return sendApplicationEmail({
        to,
        subject: packet.subject,
        text: packet.coverLetter,
        attachment: { filename: path.basename(file) || 'CV.pdf', content },
      });
    },
    emailReady: () => !!smtpSettings()?.host && secretHint('smtp_password').set,
    notify: async (kind, payload) => (await import('../notify/index.ts')).deliver(kind, payload),
    pushQuestions: async () => {
      const n = await import('../notify/index.ts');
      const s = n.notifySettings();
      if (!s.telegram.enabled || !s.telegram.questions || !n.publicNotifyState().telegram.configured) return 0;
      return n.pushQuestions();
    },
    sourceHealth: () => sourceHealthNow(),
    monthBudget: () => ({ spentUsd: monthSpend(), budgetUsd: aiSettings().monthlyBudgetUsd }),
    spendSince: (iso, campaignId) =>
      Number(
        get<{ t: number }>(
          'SELECT COALESCE(SUM(cost_usd), 0) AS t FROM ai_usage WHERE ts >= ? AND (? IS NULL OR campaign_id = ? OR campaign_id IS NULL)',
          iso,
          campaignId ?? null,
          campaignId ?? null,
        )?.t ?? 0,
      ),
    keepAwake: createKeepAwake(),
    closeBrowsers: async (reason) => {
      const { runKillHooks } = await import('./kill.ts');
      await runKillHooks(reason, 3000);
    },
  };
  return { ...base, ...over };
}

function sourceHealthNow() {
  try {
    return scoutHealth().map((h) => ({ id: h.id, label: h.label, status: h.status, lastError: h.lastError }));
  } catch {
    return [];
  }
}

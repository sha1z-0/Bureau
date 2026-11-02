import { useEffect } from 'react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      // Ride out a server restart; don't hammer on real 4xx answers.
      retry: (count, err) => count < 4 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      retryDelay: (n) => Math.min(800 * 2 ** n, 6000),
    },
  },
});

let csrf: string | null = null;
let sessionPromise: Promise<Session> | null = null;

export interface Session {
  csrf: string;
  locked: boolean;
  passphrase: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function loadSession(force = false): Promise<Session> {
  if (!sessionPromise || force) {
    sessionPromise = fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json() as Promise<Session>)
      .then((s) => {
        csrf = s.csrf;
        return s;
      });
  }
  return sessionPromise;
}

export function setCsrf(token: string) {
  csrf = token;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  if (!csrf) await loadSession();
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  if (init.method && init.method !== 'GET') headers.set('x-bureau-csrf', csrf ?? '');
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 401 && !retried) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.error === 'NO_SESSION') {
      await loadSession(true);
      return api<T>(path, init, true);
    }
    if (data.error === 'LOCKED') window.dispatchEvent(new Event('bureau:locked'));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'HTTP', message: res.statusText }));
    throw new ApiError(res.status, data.error ?? 'HTTP', data.message ?? 'Request failed');
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

export const post = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const put = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = <T = unknown>(path: string) => api<T>(path, { method: 'DELETE' });

export async function upload<T>(path: string, form: FormData): Promise<T> {
  if (!csrf) await loadSession();
  const res = await fetch(path, { method: 'POST', body: form, headers: { 'x-bureau-csrf': csrf ?? '' }, credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? 'HTTP', data.message ?? 'Upload failed');
  }
  return res.json();
}

/** Live updates from the server: scan progress, job changes, sends, and the v2 bus events. */
export type LiveEvent =
  | { type: 'scan'; scanId: string; status: string; message?: string; found?: number; added?: number; scored?: number }
  | { type: 'jobs-changed' }
  | { type: 'application'; id: string; status: string }
  | { type: 'activity'; message: string; level?: 'info' | 'warn' | 'error'; jobId?: string }
  | { type: 'hunt'; status: 'running' | 'idle'; step?: string }
  | { type: 'pipeline.state'; jobId: string; from: PipelineState | null; to: PipelineState; campaignId: string | null; reason?: string }
  | { type: 'campaign.status'; campaignId: string; status: CampaignStatus; message?: string }
  | { type: 'application.outcome'; applicationId: string; jobId: string; outcome: string; detail?: string }
  | { type: 'inbox.message'; id: string; class: InboxClass; applicationId: string | null }
  | { type: 'alert.interview'; applicationId: string; company: string; role: string; kind: string; deadline: string | null; planId: string | null }
  | { type: 'recipe.promoted'; recipeId: string; ats: string; scope: string }
  | { type: 'digest.sent'; digestId: string; campaignId: string | null; via: string[] }
  | { type: 'question.answered'; questionId: string; jobId: string | null };

const listeners = new Set<(e: LiveEvent) => void>();
let source: EventSource | null = null;

function ensureStream() {
  if (source) return;
  source = new EventSource('/api/events');
  source.onmessage = (msg) => {
    try {
      const e = JSON.parse(msg.data) as LiveEvent;
      listeners.forEach((fn) => fn(e));
    } catch {
      /* ignore malformed frames */
    }
  };
  source.onerror = () => {
    source?.close();
    source = null;
    // The server may have restarted and forgotten our session; pick up a fresh one first.
    setTimeout(() => {
      loadSession(true)
        .then(() => queryClient.invalidateQueries())
        .catch(() => {})
        .finally(ensureStream);
    }, 4000);
  };
}

export function useLive(fn: (e: LiveEvent) => void) {
  useEffect(() => {
    ensureStream();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [fn]);
}

/** Keeps cached queries fresh as the server reports changes. */
export function useLiveInvalidation() {
  const qc = useQueryClient();
  useEffect(() => {
    let pending: number | null = null;
    const handler = (e: LiveEvent) => {
      if (pending) return;
      pending = window.setTimeout(() => {
        pending = null;
        qc.invalidateQueries({ queryKey: ['overview'] });
        qc.invalidateQueries({ queryKey: ['shell'] });
        if (e.type === 'jobs-changed' || e.type === 'scan') qc.invalidateQueries({ queryKey: ['jobs'] });
        if (e.type === 'application' || e.type === 'jobs-changed' || e.type === 'application.outcome') qc.invalidateQueries({ queryKey: ['applications'] });
        if (e.type === 'scan') qc.invalidateQueries({ queryKey: ['scans'] });
        if (e.type === 'campaign.status' || e.type === 'pipeline.state' || e.type === 'hunt' || e.type === 'activity') qc.invalidateQueries({ queryKey: ['campaigns'] });
        if (e.type === 'pipeline.state' || e.type === 'application.outcome') qc.invalidateQueries({ queryKey: ['pipeline'] });
        if (e.type === 'question.answered') qc.invalidateQueries({ queryKey: ['questions'] });
        if (e.type === 'inbox.message' || e.type === 'alert.interview') qc.invalidateQueries({ queryKey: ['inbox'] });
        if (e.type === 'digest.sent') qc.invalidateQueries({ queryKey: ['digests'] });
        if (e.type === 'recipe.promoted') qc.invalidateQueries({ queryKey: ['forms'] });
      }, 900);
    };
    ensureStream();
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, [qc]);
}

// ── Shared types ─────────────────────────────────────────────────────

export type Category = 'security' | 'web' | 'mobile' | 'game' | 'data_ai' | 'devops_cloud' | 'software';

export const CATEGORY_LABEL: Record<Category, string> = {
  security: 'Security',
  web: 'Web',
  mobile: 'Mobile',
  game: 'Game dev',
  data_ai: 'Data & AI',
  devops_cloud: 'DevOps & Cloud',
  software: 'Software',
};

export interface JobSummary {
  id: string;
  source: string;
  url: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  category: Category;
  salary: { min: number | null; max: number | null; currency: string | null } | null;
  tags: string[];
  postedAt: string | null;
  foundAt: string;
  prefilterScore: number;
  score: number | null;
  grade: string | null;
  verdict: string | null;
  decision: string | null;
  status: string;
  stage: string;
  applyEmail: string | null;
}

export interface Requirement {
  text: string;
  importance: 'critical' | 'important' | 'nice';
  evidence: 'stated' | 'inferred';
  match: 'met' | 'partial' | 'missing';
  proof: string;
}

export interface Analysis {
  requirements: Requirement[];
  dimensions: Record<'skills' | 'experience' | 'domain' | 'logistics' | 'compensation' | 'growth', number>;
  legitimacy: string;
  confidence: string;
  verdict: string;
  strengths: string[];
  gaps: string[];
  redFlags: string[];
  applyChannel: string;
  applyEmail: string;
  atsKeywords: string[];
  seniorityFit: string;
  breakdown: { requirements: number; dimensions: number; prefilter: number };
  decision: 'apply' | 'consider' | 'research' | 'skip';
}

export interface JobDetail extends JobSummary {
  descriptionHtml: string;
  descriptionText: string;
  analysis: Analysis | null;
  notes: string;
  application: { id: string; status: string } | null;
}

export interface TailoredCv {
  name: string;
  headline: string;
  contact: { email: string; phone: string; location: string; links: { label: string; url: string }[] };
  summary: string;
  skills: { group: string; items: string[] }[];
  experience: { role: string; company: string; location: string; start: string; end: string; bullets: string[] }[];
  projects: { name: string; link: string; description: string; highlights: string[] }[];
  education: { school: string; degree: string; start: string; end: string; details: string }[];
  certifications: string[];
}

export interface Issue {
  claim: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  origin: 'code' | 'auditor';
}

export interface Application {
  id: string;
  jobId: string;
  job?: { title: string; company: string; url: string; score: number | null; grade: string | null };
  subject: string;
  coverLetter: string;
  message: string;
  cv: TailoredCv;
  emphasis: string[];
  issues: Issue[];
  keywords: string[];
  status: 'draft' | 'approved' | 'sent' | 'needs_you' | 'rehearsed' | 'failed' | 'skipped';
  channel: 'email' | 'ats' | 'dm' | 'manual';
  toEmail: string | null;
  sentAt: string | null;
  error: string | null;
  reason: string | null;
  auto: boolean;
  hasShot: boolean;
  answers: { label: string; value: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: { label: string; url: string }[];
  summary: string;
  yearsExperience: number;
  seniority: 'entry' | 'junior' | 'mid' | 'senior' | 'lead';
  categories: Category[];
  targetRoles: string[];
  coreStack: string[];
  skills: string[];
  experience: TailoredCv['experience'];
  projects: TailoredCv['projects'];
  education: TailoredCv['education'];
  certifications: string[];
  languages: string[];
  achievements: string[];
  voice: string;
  cvMarkdown: string;
  portfolioNotes: string;
  preferences: {
    targetRoles: string[];
    categories: Category[];
    locations: string[];
    remoteOnly: boolean;
    openToRelocation: boolean;
    needsSponsorship: boolean;
    minSalary: number;
    currency: string;
    excludeCompanies: string[];
    excludeKeywords: string[];
    tone: string;
    signature: string;
    workAuthorization: string;
    noticePeriod: string;
    salaryExpectation: string;
    extraAnswers: string;
  };
}

// ════════════════════════════════════════════════════════════════════
// v2: typed routes for every module. Shapes follow server/contracts and
// the module reports. Routes a module has not shipped yet answer 404
// "No such endpoint"; `optional()` turns that into `null` so a screen can
// say "not set up yet" instead of failing.
// ════════════════════════════════════════════════════════════════════

/** True when the server has no such route (the module isn't installed in this build). */
export function isMissingRoute(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 404) return false;
  return err.message === 'No such endpoint' || /^Route \w+:.* not found$/.test(err.message) || err.code === 'Not Found';
}

/** GET that resolves to `null` when the route doesn't exist yet. Other errors still throw. */
export async function optional<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (err) {
    if (isMissingRoute(err)) return null;
    throw err;
  }
}

/** Like `optional`, but a plain 404 (no such record) also resolves to null. */
export async function maybe<T>(path: string): Promise<T | null> {
  try {
    return await api<T>(path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ── Campaigns (A08) ──────────────────────────────────────────────────

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'ended';
export type StretchLevel = 'conservative' | 'balanced' | 'aggressive';

export const PIPELINE_STATES = ['found', 'filtered', 'scored', 'selected', 'writing', 'written', 'filling', 'verified', 'submitted', 'rehearsed', 'skipped', 'needs_you', 'failed'] as const;
export type PipelineState = (typeof PIPELINE_STATES)[number];

export interface CampaignConfig {
  startsAt: string;
  endsAt: string;
  roles: string[];
  categories: Category[];
  locations: string[];
  remoteOnly: boolean;
  stretchLevel: StretchLevel;
  minScore: number;
  dailyCap: number;
  companyCooldownDays: number;
  activeHours: { tz: string; start: string; end: string };
  pacingMinutes: { min: number; max: number };
  budgetUsd: number;
  dryRunDays: number;
  channels: { email: boolean; forms: boolean; agent: boolean };
  sources: Record<string, boolean>;
  maxAgeDays: number;
  followUpDays: number;
  onUnknownQuestion: 'skip' | 'needs_you';
  scoutEveryHours: number;
}

export interface TaskRun {
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

export interface CampaignMeta {
  firstActiveAt: string | null;
  liveSince: string | null;
  rehearseOnly: boolean;
  compat: boolean;
  statusReason: string | null;
  finalDigestId: string | null;
}

export interface CampaignStats {
  counts: Partial<Record<PipelineState, number>>;
  today: { submitted: number; rehearsed: number; done: number; cap: number; room: number };
  dryRun: { active: boolean; day: number; days: number; liveAt: string | null; liveSince: string | null; rehearseOnly: boolean };
  spend: { campaignUsd: number; budgetUsd: number };
  activeHours: { open: boolean; nextOpenAt: string | null };
  nextScoutAt: string | null;
  nextApplyAt: string | null;
  tasks: Record<string, TaskRun>;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  config: CampaignConfig;
  createdAt: string;
  updatedAt: string;
  meta: CampaignMeta;
  stats: CampaignStats;
}

export interface KillState {
  at: string;
  reason: string;
  source: string;
}

export interface AutopilotSettings {
  globalDailyCap: number;
  profileSyncAt: string;
  inboxEveryMinutes: number;
  weeklyDay: number;
  weeklyAt: string;
  digestDelayMinutes: number;
  keepAwake: boolean;
  maxAttempts: number;
  preferEmployerHours: boolean;
}

export interface AutopilotStatus {
  now: string;
  kill: KillState | null;
  stopFile: boolean;
  current: { jobId: string; campaignId: string; step: string; startedAt: string } | null;
  nextApplyAt: string | null;
  awake: boolean;
  tasksRunning: string[];
  globalTasks: Record<string, TaskRun>;
  globalRoom: number;
  settings: AutopilotSettings;
}

export interface TimelineEntry {
  kind: 'transition' | 'step';
  ts: string;
  from?: PipelineState | null;
  to?: PipelineState;
  reason?: string | null;
  step?: string;
  status?: string;
  detail?: unknown;
}

export interface StepRow {
  id: number;
  ts: string;
  jobId: string | null;
  step: string;
  status: string;
  detail: unknown;
}

// ── Digests and notifications (A08) ──────────────────────────────────

export interface DigestApp {
  jobId: string;
  applicationId: string | null;
  company: string;
  role: string;
  score: number | null;
  channel: string;
  shotUrl: string | null;
}

export interface DigestContent {
  version: 1;
  date: string;
  tz: string;
  window: { from: string; to: string };
  campaignId: string | null;
  campaignName: string | null;
  final: boolean;
  mode: 'dry_run' | 'live';
  modeNote: string | null;
  sent: DigestApp[];
  rehearsed: DigestApp[];
  skipped: { reason: string; count: number; examples: string[] }[];
  needsYou: { jobId: string; company: string; role: string; reason: string }[];
  failed: { jobId: string; company: string; role: string; reason: string }[];
  questions: { id: string; shortId: string; question: string; company: string | null }[];
  inbox: { interviews: { company: string; kind: string; summary: string; deadline: string | null }[]; replies: number; rejections: number };
  spend: { todayUsd: number; campaignUsd: number; campaignBudgetUsd: number; monthUsd: number };
  gaps: { skill: string; count: number }[];
  recipesPromoted: { ats: string; scope: string; scopeKey: string }[];
  sourceWarnings: { source: string; status: string; error: string | null }[];
  totals: { sent: number; rehearsed: number; skipped: number; needsYou: number; queued: number; sentAllTime: number; rehearsedAllTime: number };
}

export interface StoredDigest {
  id: string;
  campaignId: string | null;
  date: string;
  content: DigestContent;
  sentVia: string[];
}

export interface NotifyState {
  settings: {
    telegram: { enabled: boolean; alerts: boolean; digest: boolean; questions: boolean; info: boolean };
    email: { digest: boolean; to: string };
    ntfy: { enabled: boolean; server: string; alerts: boolean; digest: boolean };
  };
  telegram: { token: { set: boolean; hint: string | null; updatedAt: string | null }; chatIdSet: boolean; chatIdHint: string | null; configured: boolean };
  ntfy: { topicSet: boolean };
}

// ── App shell, onboarding and the cross-campaign pipeline (A10) ──────

export const ONBOARDING_STEPS = ['cv', 'links', 'github', 'voice', 'answers', 'learning', 'apikey', 'mailbox', 'telegram', 'campaign'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface Onboarding {
  current: OnboardingStep;
  completed: OnboardingStep[];
  skipped: OnboardingStep[];
  done: boolean;
  updatedAt: string | null;
  steps: { id: OnboardingStep; completed: boolean; skipped: boolean; ready: boolean }[];
  facts: {
    cv: { ready: boolean; detail: string | null };
    links: { ready: boolean };
    github: { ready: boolean; detail: string | null };
    voice: { ready: boolean; count: number; target: number };
    answers: { ready: boolean; count: number; total: number };
    learning: { ready: boolean; count: number };
    apikey: { ready: boolean };
    mailbox: { ready: boolean; smtp: boolean; imap: boolean };
    telegram: { ready: boolean };
    campaign: { ready: boolean; count: number };
  };
  ready: number;
  total: number;
  settled: number;
  firstRun: boolean;
}

export interface Shell {
  live: boolean;
  kill: KillState | null;
  stopFile: boolean;
  campaigns: { id: string; name: string; status: CampaignStatus; dryRun: boolean }[];
  current: { jobId: string; campaignId: string; step: string; startedAt: string; title: string | null; company: string | null } | null;
  nextApplyAt: string | null;
  counts: { questions: number; needsYou: number; inbox: number; drafts: number };
  onboarding: { done: boolean; firstRun: boolean; ready: number; total: number };
}

export interface PipelineItem {
  jobId: string;
  campaignId: string | null;
  campaignName: string | null;
  state: PipelineState;
  attempts: number;
  nextActionAt: string | null;
  lastError: string | null;
  updatedAt: string;
  applicationId: string | null;
  job: { title: string; company: string; location: string; remote: boolean; score: number | null; grade: string | null; ats: string | null; stage: string; foundAt: string };
}

export interface JobFile {
  job: {
    id: string;
    source: string;
    url: string;
    title: string;
    company: string;
    location: string;
    remote: boolean;
    category: string;
    postedAt: string | null;
    foundAt: string;
    stage: string;
    applyEmail: string | null;
    applyUrl: string | null;
    ats: string | null;
    legitimacy: string | null;
    legitimacyReasons: string[];
    sources: unknown[];
    priority: number;
    score: number | null;
    grade: string | null;
  };
  pipeline: { state: PipelineState; campaignId: string | null; attempts: number; nextActionAt: string | null; lastError: string | null; updatedAt: string } | null;
  applications: {
    id: string;
    status: string;
    channel: string;
    sentAt: string | null;
    hasShot: boolean;
    answers: { label: string; value: string; source?: string | null }[];
    stage: string;
    origin: string;
    reason: string | null;
    campaignId: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
  messages: { id: string; from: string; subject: string; receivedAt: string; class: string; applicationId: string; summary: string; deadline: string | null; handled: boolean }[];
  outcomes: { applicationId: string; replied: boolean; replyClass: string | null; daysToReply: number | null; updatedAt: string }[];
  questions: { id: string; question: string; status: string; fieldKind: string; createdAt: string }[];
}

// ── Matcher (A02) ────────────────────────────────────────────────────

export interface MatchRequirement {
  text: string;
  importance: 'critical' | 'important' | 'nice';
  evidence: 'stated' | 'inferred';
  match: 'met' | 'partial' | 'missing';
  proof: string;
  blocker: boolean;
  proofKind?: 'direct' | 'transferable' | 'learning' | 'none';
  blockerKind?: string;
}

export interface ScoreBreakdown {
  requirements: number;
  dimensions: number;
  preRank: number;
  base: number;
  groups: Record<'critical' | 'important' | 'nice', { count: number; earned: number }>;
  stretch: { level: StretchLevel; allowance: number; unmetImportant: number; unmetCritical: number; excess: number; penalty: number };
  caps: { reason: string; cap: number }[];
  adjustments: { reason: string; points: number }[];
  blockers: string[];
  final: number;
}

export interface MatchView {
  jobId: string;
  pipeline: { state: PipelineState; campaignId: string | null; updatedAt: string } | null;
  match: {
    screenPassScore: number;
    grade: string;
    dimensions: Record<string, number>;
    legitimacy: string;
    verdict: string;
    strengths: string[];
    gaps: string[];
    atsKeywords: string[];
    stretch: { unmetImportant: number; blockers: string[] };
    inflatedPosting: boolean;
    decision: string;
    reason: string;
  } | null;
  requirements: MatchRequirement[];
  breakdown: ScoreBreakdown | null;
  explanation: { headline: string; lines: string[]; text: string; tooltip: string } | null;
  label: string;
  tooltip: string;
}

export interface MatchMeaning {
  label: string;
  tooltip: string;
  stretch: { allowance: Record<StretchLevel, number>; penaltySteps: number[] };
}

// ── Writer (A04) ─────────────────────────────────────────────────────

export interface CriticResult {
  score: number;
  scores: { specificity: number; evidence: number; voice: number; clarity: number; ask: number; aiTells: number };
  demands: string[];
}

export interface LintResult {
  pass: boolean;
  checks: { id: string; pass: boolean; value: number | string; target: string }[];
}

export interface TruthResult {
  pass: boolean;
  issues: { claim: string; reason: string; severity: 'high' | 'medium' | 'low'; origin: 'code' | 'auditor' }[];
}

export interface WriterRun {
  applicationId: string;
  jobId: string;
  title: string;
  company: string;
  campaignId: string | null;
  status: string;
  skipped: string | null;
  strategy: string | null;
  lengthArm: string | null;
  explored: boolean;
  critic: number | null;
  lintPass: boolean | null;
  lintFailing: string[];
  truthPass: boolean | null;
  truthHigh: number;
  subject: string;
  updatedAt: string;
}

export interface WriterTotals {
  runs: number;
  written: number;
  skipped: number;
  avgCritic: number | null;
  skipReasons: { reason: string; n: number }[];
}

export interface LetterVariant {
  id: string;
  strategy: 'hook' | 'proof' | 'story';
  text: string;
  passagesUsed: string[];
  styleTags: string[];
  critic: CriticResult | null;
  lint: LintResult | null;
  chosen: boolean;
}

export interface EvidenceItem {
  requirement: string;
  importance: 'critical' | 'important' | 'nice';
  factIds: string[];
  evidence: string;
  framing: 'direct' | 'transferable' | 'learning' | 'omit';
  phrasing: string;
}

export interface WriterDetail {
  summary: WriterRun;
  writer: {
    status: 'written' | 'skipped';
    skipped: string | null;
    strategy: string | null;
    lengthArm: string | null;
    explored: boolean;
    evidence: { items: EvidenceItem[]; biggestGap: string | null; priorities: string[]; mustWins: string[]; tone: string } | null;
    fastLearning: string | null;
    subjects: string[];
    subjectIndex: number;
    shortAnswers: Record<string, string>;
    outreach: string;
    followUp: string;
    quality: { critic: CriticResult; lint: LintResult; truth: TruthResult } | null;
    cvPdfPath: string;
    letterPdfPath: string;
    cvPages: number;
    cvChanges: string[];
    steps: { step: string; at: string; detail: string }[];
  };
  variants: LetterVariant[];
  issues: { claim: string; reason: string; severity: string; origin: string }[];
  coverLetter: string;
  outreach: string;
  cv: unknown;
}

export interface ArmStat {
  arm: string;
  successes: number;
  failures: number;
  alpha: number;
  beta: number;
  mean: number;
  n: number;
}

export interface BanditStats {
  strategy: ArmStat[];
  length: ArmStat[];
  outcomes: number;
  exploreRate: number;
}

// ── Master profile (A03) ─────────────────────────────────────────────

export interface Links {
  github: string;
  portfolio: string;
  linkedin: string;
  socials: { label: string; url: string }[];
}

export interface VoicePassage {
  id: string;
  prompt: string;
  text: string;
  tags: string[];
  createdAt: string;
}

export interface StyleFingerprint {
  passages: number;
  words: number;
  sentenceLenMean: number;
  sentenceLenStd: number;
  typeTokenRatio: number;
  contractionRate: number;
  firstPersonRate: number;
  connectives: string[];
}

export interface AnswerEntry {
  id: string;
  questionNorm: string;
  questionRaw: string;
  answer: string;
  scope: { countries?: string[]; jobTypes?: string[]; ats?: string[] };
  source: 'owner' | 'derived';
  createdAt: string;
  updatedAt: string;
  intent: string | null;
  placeholder: boolean;
}

export interface LearningItem {
  id: string;
  skill: string;
  status: 'learning' | 'queued' | 'done';
  startedAt: string | null;
  notes: string;
}

export interface UnknownQuestion {
  id: string;
  questionRaw: string;
  questionNorm: string;
  jobId: string | null;
  fieldKind: string;
  options: string[];
  status: 'open' | 'answered' | 'ignored';
  createdAt: string;
  job: { title: string; company: string; url: string } | null;
  duplicates: number;
}

export interface ProfileFact {
  id: string;
  kind: string;
  text: string;
  source: 'cv' | 'github' | 'portfolio' | 'manual' | 'linkedin';
  sourceRef: string;
  addedAt: string;
  active: boolean;
  hidden?: boolean;
}

export interface GithubSummary {
  login: string;
  syncedAt: string;
  profileUrl?: string;
  repos: { name: string; url: string; description: string; languages: string[]; topics: string[]; stars: number; fork: boolean; pushedAt: string | null; recentCommits?: number | null; archived?: boolean }[];
}

// ── Scout (A01) ──────────────────────────────────────────────────────

export interface SourceHealth {
  id: string;
  label: string;
  kind: string;
  status: 'ok' | 'slow' | 'failing' | 'unavailable' | 'disabled' | 'idle';
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  found: number;
  added: number;
  dupes: number;
  ms: number;
  consecutiveFailures: number;
  boardsOk?: number;
  boardsFailed?: number;
}

export interface ScoutHealth {
  running: boolean;
  sources: SourceHealth[];
  jobspy: { available: boolean; reason: string | null; python?: string; version?: string };
  lastRun: { id: string; startedAt: string; finishedAt: string | null; ms: number; found: number; added: number; uniqueLast24h?: number } | null;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  ats: string | null;
  atsToken: string | null;
  careersUrl: string | null;
  discoveredVia: string | null;
  status: 'active' | 'employer' | 'unsupported' | 'dead' | 'paused';
  lastCheckedAt: string | null;
  openRoles: number | null;
  prevOpenRoles: number | null;
  signals: { kind?: string; at?: string; detail?: string; [k: string]: unknown }[];
}

// ── Forms and recipes (A05), browser agent and traces (A06) ──────────
// Proposed in docs/build/requests/A10.md; screens fall back to "not set up yet".

export interface FieldLogEntry {
  signature: string;
  label: string;
  kind: string;
  required: boolean;
  source: string | null;
  key: string | null;
  intended: string | null;
  readBack: string | null;
  ok: boolean;
  note?: string;
}

export interface RecipeRow {
  id: string;
  ats: string;
  scope: 'ats' | 'company' | 'url';
  scopeKey: string;
  version: number;
  status: 'candidate' | 'shadow' | 'active' | 'demoted';
  successes: number;
  failures: number;
  steps?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeDetail {
  recipe: RecipeRow & {
    match?: { urlPattern?: string; domFingerprint?: string };
    steps: { action: string; fieldSignature?: string; labelNorm?: string; widget: string; valueSource?: string; valueKey?: string; selectors: string[] }[];
  };
  versions: { version: number; status: string; successes: number; failures: number; updatedAt: string }[];
}

export interface AtsCoverage {
  ats: string;
  recipes: number;
  active: number;
  runs: number;
  verified: number;
  submitted: number;
  successRate: number | null;
}

export interface FormRun {
  id: string;
  jobId: string | null;
  applicationId: string | null;
  at: string;
  status: string;
  via: string | null;
  ats: string | null;
  url: string | null;
  verified: boolean;
  reason: string;
  /** Screenshot URLs, one per wizard step. */
  shots: string[];
  fieldLog: FieldLogEntry[];
}

export interface AgentMetrics {
  daily: { day: string; agentRuns: number; recipeRuns: number; adapterRuns: number }[];
  costPerRun: number | null;
  totals?: { agentRuns: number; recipeRuns: number; adapterRuns: number; promoted: number };
}

export interface TraceSummary {
  id: string;
  jobId: string | null;
  applicationId: string | null;
  origin: string;
  url: string;
  ats: string | null;
  outcome: 'verified' | 'submitted' | 'failed' | 'gave_up';
  steps: number;
  createdAt: string;
}

export interface TraceStep {
  i: number;
  action: string;
  fieldSignature?: string;
  labelNorm?: string;
  widget?: string;
  selectors: string[];
  valueSource?: string;
  valueKey?: string;
  step: number;
  url: string;
  /** Screenshot URLs. */
  beforeShot?: string;
  afterShot?: string;
  ok: boolean;
  note?: string;
}

export interface TraceDetail {
  trace: TraceSummary & { steps: TraceStep[]; startedAt: string; finishedAt: string };
}

// ── External API keys and audit (A07) ────────────────────────────────

export const API_SCOPES = ['jobs:read', 'packets:read', 'answers:read', 'recipes:read', 'traces:write', 'applications:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AuditEntry {
  id: string | number;
  keyId: string | null;
  keyName?: string | null;
  ts: string;
  route: string;
  status: number;
  detail: string | null;
}

// ── Inbox (A09) and learning (A09) ───────────────────────────────────

export const INBOX_CLASSES = ['verification_code', 'confirmation_received', 'rejection', 'interview_invite', 'assessment', 'recruiter_question', 'offer', 'other'] as const;
export type InboxClass = (typeof INBOX_CLASSES)[number];

export interface InboxMessage {
  id: string;
  messageId: string;
  from: string;
  subject: string;
  receivedAt: string;
  class: InboxClass;
  confidence?: number;
  company: string | null;
  summary: string;
  deadline: string | null;
  applicationId: string | null;
  application?: { jobId: string; title: string; company: string } | null;
  handled: boolean;
  links?: string[];
  schedulingLinks?: string[];
}

export interface ImapSettings {
  imap: { host: string; port: number; secure: boolean; user: string; passwordSet: boolean } | null;
  lastPollAt?: string | null;
  lastError?: string | null;
}

export interface LearningPlan {
  applicationId: string;
  company: string;
  role: string;
  interviewDate: string | null;
  gaps: string[];
  days: { day: number; focus: string; tasks: string[]; resources: { title: string; url: string; free: boolean }[]; miniProject: string | null }[];
  likelyQuestions: string[];
  talkingPoints: string[];
}

export interface StoredPlan {
  id: string;
  applicationId: string;
  company: string;
  createdAt: string;
  plan: LearningPlan;
}

export interface GapReport {
  period: string;
  generatedAt: string;
  jobsConsidered: number;
  skills: { skill: string; count: number; weighted: number; typicalDepth: string; suggestedProject: string }[];
}

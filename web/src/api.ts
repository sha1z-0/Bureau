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

/** Live updates from the server: scan progress, job changes, sends. */
export type LiveEvent =
  | { type: 'scan'; scanId: string; status: string; message?: string; found?: number; added?: number; scored?: number }
  | { type: 'jobs-changed' }
  | { type: 'application'; id: string; status: string }
  | { type: 'activity'; message: string }
  | { type: 'hunt'; status: 'running' | 'idle'; step?: string };

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
        if (e.type === 'jobs-changed' || e.type === 'scan') qc.invalidateQueries({ queryKey: ['jobs'] });
        if (e.type === 'application' || e.type === 'jobs-changed') qc.invalidateQueries({ queryKey: ['applications'] });
        if (e.type === 'scan') qc.invalidateQueries({ queryKey: ['scans'] });
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
  status: 'draft' | 'approved' | 'sent' | 'needs_you' | 'rehearsed' | 'failed';
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

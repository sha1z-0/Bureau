import crypto from 'node:crypto';
import { inboxDeps } from './deps.ts';
import { atsFamilyOf, baseDomain, companyTokens, hostOf } from './domains.ts';

/**
 * Verification codes and links, held in memory only. They never touch the
 * database, the event log or the bus in plain text, and they expire 15 minutes
 * after Bureau sees them. Each one is handed out at most once.
 */

export const CODE_TTL_MS = 15 * 60_000;
/** A code that arrived shortly before waitForCode was called still counts (the poll can win the race). */
const EARLY_GRACE_MS = 5 * 60_000;

interface Held {
  id: string;
  value: string;
  kind: 'code' | 'link';
  /** Sender host plus every link host in the message. */
  hosts: string[];
  /** Lower-cased path prefixes of links ("boards.greenhouse.io/northwindlabs"). */
  paths: string[];
  company: string | null;
  heldAt: number;
  consumed: boolean;
}

interface Waiter {
  domain: string;
  since: number;
  resolve: (v: string | null) => void;
}

const held: Held[] = [];
const waiters: Waiter[] = [];
/** The inbox clock (tests drive expiry through setInboxDeps({ now })). */
const clock = () => inboxDeps().now();

function prune() {
  const t = clock();
  for (let i = held.length - 1; i >= 0; i--) {
    if (held[i].consumed || t - held[i].heldAt > CODE_TTL_MS) {
      held[i].value = '';
      held.splice(i, 1);
    }
  }
}

/** Normalise what A05 passes: a bare domain, a host or a full URL. */
export function parseTarget(domain: string): { host: string; tenant: string | null } {
  const raw = domain.trim().toLowerCase();
  const host = hostOf(/^https?:\/\//.test(raw) ? raw : `https://${raw}`) ?? raw;
  let tenant: string | null = null;
  const fam = atsFamilyOf(host);
  if (fam) {
    const labels = host.split('.');
    // bluefin.wd5.myworkdayjobs.com, acme.recruitee.com, acme.bamboohr.com → the first label names the employer.
    const generic = ['boards', 'job-boards', 'jobs', 'apply', 'careers', 'www', 'app', 'hire', 'eu', 'us'];
    if (labels.length > 2 && !generic.includes(labels[0])) tenant = labels[0];
    else {
      try {
        const seg = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).pathname.split('/').filter(Boolean)[0];
        if (seg) tenant = seg.toLowerCase();
      } catch {
        /* no path */
      }
    }
  }
  return { host, tenant };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function codeMatches(domain: string, h: Pick<Held, 'hosts' | 'paths' | 'company'>): boolean {
  const { host, tenant } = parseTarget(domain);
  if (!host) return false;
  const fam = atsFamilyOf(host);
  if (!fam) {
    // The employer's own site: the same host or registrable domain.
    const b = baseDomain(host);
    return h.hosts.includes(host) || h.hosts.some((x) => !atsFamilyOf(x) && baseDomain(x) === b);
  }
  // A shared ATS host (jobs.ashbyhq.com) says nothing about the employer: match the family, then the tenant.
  if (!h.hosts.some((x) => atsFamilyOf(x) === fam)) return false;
  if (!tenant) return true;
  const t = squash(tenant);
  if (h.hosts.some((x) => x.split('.')[0] === tenant) || h.paths.some((p) => p.split('/')[1] === tenant)) return true;
  // "northwindlabs" ↔ "Northwind Labs"
  return !!h.company && companyTokens(h.company).some((ct) => squash(ct).length >= 4 && (t.includes(squash(ct)) || squash(ct).includes(t)));
}

/** Hold a freshly received code or link; hands it straight to a matching waiter if one is waiting. */
export function holdCode(entry: { value: string; kind: 'code' | 'link'; senderHost: string; links: string[]; company: string | null }): void {
  prune();
  const hosts = new Set<string>([entry.senderHost.toLowerCase()]);
  const paths: string[] = [];
  for (const l of entry.links) {
    try {
      const u = new URL(l);
      hosts.add(u.hostname.toLowerCase());
      const seg = u.pathname.split('/').filter(Boolean)[0];
      if (seg) paths.push(`${u.hostname.toLowerCase()}/${seg.toLowerCase()}`);
    } catch {
      /* skip */
    }
  }
  const h: Held = { id: crypto.randomUUID(), value: entry.value, kind: entry.kind, hosts: [...hosts], paths, company: entry.company, heldAt: clock(), consumed: false };
  held.push(h);
  for (let i = 0; i < waiters.length; i++) {
    const w = waiters[i];
    if (h.heldAt >= w.since - EARLY_GRACE_MS && codeMatches(w.domain, h)) {
      waiters.splice(i, 1);
      h.consumed = true;
      const v = h.value;
      prune();
      w.resolve(v);
      return;
    }
  }
}

/** Take the newest unexpired, unused code (preferred) or link for `domain`, if any. */
export function takeCode(domain: string, since = clock()): string | null {
  prune();
  const matches = held.filter((h) => !h.consumed && h.heldAt >= since - EARLY_GRACE_MS && codeMatches(domain, h)).sort((a, b) => b.heldAt - a.heldAt);
  const pick = matches.find((m) => m.kind === 'code') ?? matches[0];
  if (!pick) return null;
  pick.consumed = true;
  const v = pick.value;
  prune();
  return v;
}

/** Register a waiter. Returns the promise and a cancel function (resolves null). */
export function addWaiter(domain: string, since: number): { promise: Promise<string | null>; cancel: () => void } {
  let w!: Waiter;
  const promise = new Promise<string | null>((resolve) => {
    w = { domain, since, resolve };
  });
  waiters.push(w);
  return {
    promise,
    cancel: () => {
      const i = waiters.indexOf(w);
      if (i >= 0) {
        waiters.splice(i, 1);
        w.resolve(null);
      }
    },
  };
}

export function waitingCount(): number {
  return waiters.length;
}

/** How many codes are held (for status views; never the values). */
export function heldCount(): number {
  prune();
  return held.length;
}

/** Drop everything (tests, account switch). */
export function clearCodes() {
  for (const h of held) h.value = '';
  held.length = 0;
  for (const w of waiters.splice(0)) w.resolve(null);
}

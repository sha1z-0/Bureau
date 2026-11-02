import crypto from 'node:crypto';
import type { Frame, Page } from 'playwright-core';
import { get, getSetting, now, run } from '../db.ts';
import { getSecret, setSecret } from '../security/vault.ts';
import { effectiveUrl } from './detect.ts';
import { fastMode } from './human.ts';

/**
 * Candidate accounts for ATSs behind a login wall (Workday, iCIMS, Taleo,
 * SuccessFactors). Rules:
 *  - always the dedicated job-search email (forms settings `accountEmail`, else
 *    the inbox address A09 exposes, else the address on the profile, which is the
 *    one every application already carries) — never a social / personal login
 *    ("Sign in with Google/LinkedIn" is never used);
 *  - a strong, unique password per tenant, stored only in the vault
 *    (`site_accounts` keeps the username and the secret's name);
 *  - email verification through A09 `waitForCode(domain)`;
 *  - never on LinkedIn or Indeed.
 */

export const FORBIDDEN_ACCOUNT_HOSTS = /(^|\.)(linkedin\.com|indeed\.com|indeed\.[a-z.]+|google\.com|facebook\.com|apple\.com|microsoft\.com|live\.com)$/i;

export interface AccountSelectors {
  /** Containers that identify each auth view. */
  createView: string[];
  signInView: string[];
  verifyView: string[];
  email: string[];
  password: string[];
  confirm: string[];
  consent: string[];
  createSubmit: string[];
  signInSubmit: string[];
  verifyCode: string[];
  verifySubmit: string[];
  toSignIn: string[];
  toCreate: string[];
  /** Text that means "this email already has an account". */
  exists: RegExp;
  /** Text that means the password was refused. */
  badLogin: RegExp;
}

export const DEFAULT_ACCOUNT_SELECTORS: AccountSelectors = {
  createView: ['[data-automation-id="createAccountPage"]', 'form#create-account', 'form[action*="register" i]', 'form:has(input[type=password] + input[type=password])'],
  signInView: ['[data-automation-id="signInPage"]', 'form#sign-in', 'form[action*="login" i]', 'form[action*="signin" i]'],
  verifyView: ['[data-automation-id="verifyAccountPage"]', 'form:has(input[autocomplete="one-time-code"])', 'form:has(input[name*="code" i])'],
  email: ['input[data-automation-id="email"]', 'input[type=email]', 'input[name*="email" i]', 'input[autocomplete="username"]'],
  password: ['input[data-automation-id="password"]', 'input[type=password][name*="pass" i]:not([name*="confirm" i]):not([name*="verify" i])', 'input[type=password]'],
  confirm: ['input[data-automation-id="verifyPassword"]', 'input[type=password][name*="confirm" i]', 'input[type=password][name*="verify" i]'],
  consent: ['input[data-automation-id="createAccountCheckbox"]', 'input[type=checkbox][name*="terms" i]', 'input[type=checkbox][name*="agree" i]'],
  createSubmit: ['[data-automation-id="click_filter"]', '[data-automation-id="createAccountSubmitButton"]', 'button[type=submit]'],
  signInSubmit: ['[data-automation-id="click_filter"]', '[data-automation-id="signInSubmitButton"]', 'button[type=submit]'],
  verifyCode: ['input[data-automation-id="verificationCode"]', 'input[autocomplete="one-time-code"]', 'input[name*="code" i]'],
  verifySubmit: ['[data-automation-id="click_filter"]', '[data-automation-id="verifySubmitButton"]', 'button[type=submit]'],
  toSignIn: ['[data-automation-id="signInLink"]', 'a:has-text("Sign In")', 'button:has-text("Sign In")'],
  toCreate: ['[data-automation-id="createAccountLink"]', 'a:has-text("Create Account")', 'button:has-text("Create Account")'],
  exists: /already exists|already registered|account with this email|already have an account/i,
  badLogin: /(wrong|invalid|incorrect).*(password|credentials|email)|could not sign in|sign[- ]in failed/i,
};

export interface AccountDeps {
  waitForCode: (domain: string, timeoutMs: number) => Promise<string | null>;
  email: () => Promise<string | null>;
}

export type AccountResult = { ok: true; created: boolean; email: string } | { ok: false; reason: string };

export function accountDomain(url: string): string {
  try {
    return new URL(effectiveUrl(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** 20 characters, every class present, no ambiguous look-alikes. */
export function generatePassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^*-_=+?'];
  const all = sets.join('');
  const pick = (s: string) => s[crypto.randomInt(s.length)];
  const chars = [...sets.map(pick)];
  while (chars.length < 20) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function getAccount(domain: string): { username: string; password: string } | null {
  const row = get<{ username: string; secret_name: string }>('SELECT username, secret_name FROM site_accounts WHERE domain = ?', domain);
  if (!row) return null;
  const password = getSecret(row.secret_name);
  return password ? { username: row.username, password } : null;
}

function saveAccount(domain: string, username: string, password: string) {
  const secretName = `site_account:${domain}`;
  setSecret(secretName, password, { hint: false });
  run(
    `INSERT INTO site_accounts (id, domain, username, secret_name, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(domain) DO UPDATE SET username = excluded.username, secret_name = excluded.secret_name`,
    crypto.randomUUID(),
    domain,
    username,
    secretName,
    now(),
  );
}

/** The dedicated job-search address for ATS accounts. */
export async function jobSearchEmail(): Promise<string | null> {
  const s = getSetting<{ accountEmail?: string }>('forms_settings', {});
  if (s.accountEmail) return s.accountEmail;
  try {
    const inbox = (await import('../inbox/index.ts')) as Record<string, unknown>;
    if (typeof inbox.jobSearchAddress === 'function') {
      const a = (await (inbox.jobSearchAddress as () => unknown)()) as string | null;
      if (a) return a;
    }
  } catch {
    /* inbox not built */
  }
  const p = get<{ data: string }>('SELECT data FROM profile WHERE id = 1');
  if (p) {
    try {
      const email = String((JSON.parse(p.data) as { email?: string }).email ?? '').trim();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return email;
    } catch {
      /* unreadable profile */
    }
  }
  return null;
}

async function first(frame: Frame, sels: string[]) {
  for (const s of sels) {
    const l = frame.locator(s).first();
    if (await l.isVisible({ timeout: 300 }).catch(() => false)) return l;
  }
  return null;
}

export async function authView(page: Page, sel: AccountSelectors = DEFAULT_ACCOUNT_SELECTORS): Promise<'create' | 'signin' | 'verify' | null> {
  const f = page.mainFrame();
  if (await first(f, sel.verifyView)) return 'verify';
  if (await first(f, sel.createView)) return 'create';
  if (await first(f, sel.signInView)) return 'signin';
  return null;
}

/** Wait until the auth view changes from `from` (or an error shows on it). */
async function waitView(page: Page, sel: AccountSelectors, ms: number, from: 'create' | 'signin' | 'verify'): Promise<'create' | 'signin' | 'verify' | 'gone'> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await page.waitForTimeout(fastMode() ? 100 : 250);
    const v = (await authView(page, sel)) ?? 'gone';
    if (v !== from) return v;
    const msg = await page.locator('[data-automation-id="errorMessage"], [role="alert"], .error, [class*="error" i]').filter({ visible: true }).allInnerTexts().catch(() => [] as string[]);
    const text = msg.join(' ');
    if (sel.exists.test(text) || sel.badLogin.test(text) || (from === 'verify' && /(invalid|incorrect|expired|wrong).*code|code.*(invalid|incorrect|expired)/i.test(text))) return v;
  }
  return (await authView(page, sel)) ?? 'gone';
}

async function signIn(page: Page, sel: AccountSelectors, email: string, password: string): Promise<boolean> {
  const f = page.mainFrame();
  if ((await authView(page, sel)) !== 'signin') {
    const link = await first(f, sel.toSignIn);
    await link?.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const scope = (await first(f, sel.signInView)) ?? f.locator('body');
  const em = await first(f, sel.email.map((s) => `${sel.signInView[0]} ${s}`).concat(sel.email));
  const pw = await first(f, sel.password.map((s) => `${sel.signInView[0]} ${s}`).concat(sel.password));
  if (!em || !pw) return false;
  await em.fill(email);
  await pw.fill(password);
  const submit = await first(f, sel.signInSubmit.map((s) => `${sel.signInView[0]} ${s}`).concat(sel.signInSubmit));
  await (submit ?? scope).click().catch(() => {});
  const v = await waitView(page, sel, 8000, 'signin');
  return v === 'gone' || v === 'verify';
}

/**
 * Get past the login wall on this page: reuse the tenant's account, or create
 * one (dedicated email, vault password, email code). Returns why when it can't.
 */
export async function ensureAccount(page: Page, deps: AccountDeps, sel: AccountSelectors = DEFAULT_ACCOUNT_SELECTORS): Promise<AccountResult> {
  const domain = accountDomain(page.url());
  if (!domain) return { ok: false, reason: 'Could not tell which site the login is for.' };
  if (FORBIDDEN_ACCOUNT_HOSTS.test(domain)) return { ok: false, reason: `Bureau never signs in to or creates accounts on ${domain}. It needs you.` };
  const f = page.mainFrame();
  const existing = getAccount(domain);
  if (existing) {
    if (await signIn(page, sel, existing.username, existing.password)) {
      const v = await authView(page, sel);
      if (v === 'verify') return verify(page, deps, sel, domain, existing.username, false);
      return { ok: true, created: false, email: existing.username };
    }
    return { ok: false, reason: `The saved ${domain} account would not sign in. It needs you.` };
  }
  const email = await deps.email();
  if (!email) return { ok: false, reason: 'Set the dedicated job-search email (Forms settings) so Bureau can create the account.' };
  if ((await authView(page, sel)) === 'signin') {
    const link = await first(f, sel.toCreate);
    await link?.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const em = await first(f, sel.email.map((s) => `${sel.createView[0]} ${s}`).concat(sel.email));
  const pw = await first(f, sel.password.map((s) => `${sel.createView[0]} ${s}`).concat(sel.password));
  if (!em || !pw) return { ok: false, reason: `Could not find the ${domain} account form.` };
  const password = generatePassword();
  // Store first: a created account must never lose its password.
  saveAccount(domain, email, password);
  await em.fill(email);
  await pw.fill(password);
  const cf = await first(f, sel.confirm.map((s) => `${sel.createView[0]} ${s}`).concat(sel.confirm));
  await cf?.fill(password);
  const consent = await first(f, sel.consent);
  if (consent) await consent.check({ force: true }).catch(() => consent.click().catch(() => {}));
  const submit = await first(f, sel.createSubmit.map((s) => `${sel.createView[0]} ${s}`).concat(sel.createSubmit));
  if (!submit) return { ok: false, reason: `Could not find the ${domain} create-account button.` };
  await submit.click().catch(() => {});
  const v = await waitView(page, sel, 10_000, 'create');
  const body = (await page.locator('[data-automation-id="errorMessage"], [role="alert"], .error, [class*="error" i]').filter({ visible: true }).allInnerTexts().catch(() => [] as string[])).join(' ');
  if (v === 'create' && sel.exists.test(body)) {
    // An account exists that Bureau has no password for (made by hand): the owner decides.
    run('DELETE FROM site_accounts WHERE domain = ?', domain);
    return { ok: false, reason: `An account for ${email} already exists on ${domain}, and Bureau has no password for it. It needs you.` };
  }
  if (v === 'verify') return verify(page, deps, sel, domain, email, true);
  if (v === 'create') return { ok: false, reason: `${domain} did not accept the new account.` };
  return { ok: true, created: true, email };
}

async function verify(page: Page, deps: AccountDeps, sel: AccountSelectors, domain: string, email: string, created: boolean): Promise<AccountResult> {
  let code: string | null;
  try {
    code = await deps.waitForCode(domain, 5 * 60_000);
  } catch (err) {
    if ((err as Error).name === 'NotImplemented') return { ok: false, reason: 'Verification code not available: the job-search inbox is not connected yet.' };
    throw err;
  }
  if (!code) return { ok: false, reason: `The ${domain} verification email did not arrive.` };
  const f = page.mainFrame();
  if (/^https?:\/\//i.test(code)) {
    // A verification link: follow it only on the same site.
    const target = accountDomain(code);
    const base = domain.split('.').slice(-2).join('.');
    if (!target.endsWith(base)) return { ok: false, reason: `The verification link points somewhere else (${target}).` };
    await page.goto(code, { waitUntil: 'domcontentloaded' }).catch(() => {});
  } else {
    const input = await first(f, sel.verifyCode);
    if (!input) return { ok: false, reason: 'Could not find where to type the verification code.' };
    await input.fill(code.trim());
    const submit = await first(f, sel.verifySubmit.map((s) => `${sel.verifyView[0]} ${s}`).concat(sel.verifySubmit));
    await submit?.click().catch(() => {});
  }
  const v = await waitView(page, sel, 10_000, 'verify');
  if (v === 'verify') return { ok: false, reason: `${domain} did not accept the verification code.` };
  if (v === 'signin') {
    const acct = getAccount(domain);
    if (!acct || !(await signIn(page, sel, acct.username, acct.password))) return { ok: false, reason: `Could not sign in to ${domain} after verifying.` };
  }
  return { ok: true, created, email };
}

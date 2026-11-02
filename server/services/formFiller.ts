import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { z } from 'zod/v4';
import { structured } from '../ai/claude.ts';
import { fence, FORM_FILLER } from '../ai/prompts.ts';
import { TailoredCvSchema } from '../ai/tailor.ts';
import { DATA_DIR } from '../config.ts';
import { AppError } from '../errors.ts';
import type { ApplicationRow } from './applications.ts';
import { guardedContext, launchBrowser } from './browser.ts';
import { cvFilename, renderCvPdf, renderLetterPdf } from './cvPdf.ts';
import { loadProfile, profileForPrompt } from './profileStore.ts';

/**
 * Fills a hosted application form (Greenhouse, Lever, Ashby, Workable and most
 * others) the way a careful person would: read every field, let Claude answer
 * from your real profile, upload the tailored CV, then submit. It never tries
 * to defeat a CAPTCHA. A visible challenge, a required question it can't answer
 * truthfully, or a validation error hands the application back to you.
 */

export const SHOT_DIR = path.join(DATA_DIR, 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true, mode: 0o700 });

interface JobLite {
  id: string;
  source: string;
  external_id: string | null;
  url: string;
  title: string;
  company: string;
  description_text: string | null;
}

export interface FormField {
  id: string;
  kind: 'text' | 'textarea' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file';
  label: string;
  required: boolean;
  options?: string[];
}

export interface FormOutcome {
  status: 'submitted' | 'rehearsed' | 'needs_you' | 'failed';
  reason: string;
  shot: string | null;
  answers: { label: string; value: string }[];
}

export const Answers = z.object({
  answers: z.array(z.object({ id: z.string(), value: z.string() })),
  blockers: z.array(z.object({ id: z.string(), reason: z.string() })),
});

/** The hosted form for a job, preferring each ATS's canonical application page. */
export function applyUrlFor(job: Pick<JobLite, 'source' | 'external_id' | 'url'>): string | null {
  if (!/^https?:\/\//.test(job.url)) return null;
  const [board, id] = (job.external_id ?? '').split(':');
  // The embed URL serves the bare form even when a company redirects its board to its own careers site.
  if (job.source === 'greenhouse' && board && id) return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(id)}`;
  if (job.source === 'lever' && /jobs\.lever\.co/.test(job.url)) return job.url.replace(/\/?(\?.*)?$/, '/apply');
  if (job.source === 'ashby' && /jobs\.ashbyhq\.com/.test(job.url)) return job.url.replace(/\/?(\?.*)?$/, '/application');
  return job.url;
}

/**
 * Runs in the page: tag every fillable control and describe it. Kept as plain
 * JavaScript source so no TypeScript tooling can inject helpers into it.
 */
export const EXTRACT_FIELDS = String.raw`(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const text = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const generic = /^(attach|upload|choose file|browse|select|enter manually|or)$/i;
  const labelFor = (el) => {
    const own = el.labels && el.labels[0];
    if (own && text(own) && !generic.test(text(own))) return text(own);
    // Walk up a few levels for the field's real caption (upload buttons are often just "Attach").
    let node = el.parentElement;
    for (let i = 0; node && i < 5; i++, node = node.parentElement) {
      const cap = node.querySelector('legend, label, [class*="label"], [class*="Label"], h3, h4');
      const t = text(cap);
      if (t && !generic.test(t) && cap !== own) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((i) => text(document.getElementById(i))).join(' ');
    const box = el.closest('fieldset, [class*="field"], [class*="question"], [class*="Field"], li, .form-group, div');
    const legend = box && box.querySelector('legend, label, [class*="label"], [class*="Label"]');
    return text(legend) || el.getAttribute('placeholder') || el.getAttribute('name') || '';
  };
  const out = [];
  let n = 0;
  const tag = (el) => { const id = 'f' + n++; el.setAttribute('data-bureau-id', id); return id; };
  const radioGroups = new Map();
  for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search'].includes(type)) continue;
    if (el.disabled || el.readOnly) continue;
    // Hidden helper inputs inside custom dropdowns.
    if (type !== 'file' && (el.getAttribute('aria-hidden') === 'true' || (el.tabIndex < 0 && !labelFor(el)))) continue;
    if (type !== 'file' && !visible(el)) continue;
    if (/honeypot|website_url_confirm/i.test(el.name || '')) continue;
    if (type === 'radio') {
      const key = el.name || labelFor(el);
      radioGroups.set(key, (radioGroups.get(key) || []).concat(el));
      continue;
    }
    const required = el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelFor(el));
    if (el.tagName === 'SELECT') {
      const options = Array.from(el.options).map((o) => o.text.trim()).filter((t) => t && !/^select|^--/i.test(t));
      out.push({ id: tag(el), kind: 'select', label: labelFor(el), required, options });
    } else if (el.getAttribute('role') === 'combobox') {
      out.push({ id: tag(el), kind: 'combobox', label: labelFor(el), required });
    } else if (el.tagName === 'TEXTAREA') {
      out.push({ id: tag(el), kind: 'textarea', label: labelFor(el), required });
    } else if (type === 'checkbox') {
      out.push({ id: tag(el), kind: 'checkbox', label: labelFor(el) || text(el.parentElement), required });
    } else if (type === 'file') {
      out.push({ id: tag(el), kind: 'file', label: labelFor(el) || el.getAttribute('accept') || 'file', required });
    } else {
      const kind = ['email', 'tel', 'url', 'number', 'date'].includes(type) ? type : 'text';
      out.push({ id: tag(el), kind, label: labelFor(el), required });
    }
  }
  for (const [key, radios] of radioGroups) {
    const box = radios[0].closest('fieldset, [role="radiogroup"], [class*="question"], [class*="field"], div');
    const groupLabel = text(box && box.querySelector('legend, label, [class*="label"]')) || key;
    const id = 'f' + n++;
    radios.forEach((r, i) => r.setAttribute('data-bureau-id', id + ':' + i));
    out.push({ id, kind: 'radio', label: groupLabel, required: radios.some((r) => r.required), options: radios.map((r) => text(r.labels && r.labels[0]) || r.value) });
  }
  return out;
})()`;

export const VISIBLE_CHALLENGE = String.raw`Array.from(document.querySelectorAll('iframe')).some((f) => {
  const r = f.getBoundingClientRect();
  const shown = r.width > 60 && r.height > 60 && getComputedStyle(f).visibility !== 'hidden';
  return shown && /recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com|challenges\.cloudflare\.com/.test(f.src || '');
})`;

export const CONFIRMED = String.raw`/thank you|application (has been )?(received|submitted)|we('|’)ve received|successfully submitted|application sent/i.test(document.body.innerText)`;

const formFound = (fields: FormField[]) => fields.filter((f) => f.kind !== 'file').length >= 2;

/**
 * Find the application form, following up to two "Apply" hops: an aggregator
 * listing → the company's ATS page → its form. Links that open a new tab are
 * followed in the same tab instead.
 */
async function findForm(page: Page): Promise<FormField[]> {
  for (let hop = 0; hop < 3; hop++) {
    const fields = (await page.evaluate(EXTRACT_FIELDS)) as FormField[];
    if (formFound(fields) || hop === 2) return fields;
    const link = page.getByRole('link', { name: /apply/i }).first();
    const href = (await link.isVisible().catch(() => false)) ? await link.getAttribute('href').catch(() => null) : null;
    if (href && !/^(mailto|javascript):/i.test(href)) {
      await page.goto(new URL(href, page.url()).toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    } else {
      const button = page.getByRole('button', { name: /apply/i }).first();
      if (!(await button.isVisible().catch(() => false))) return fields;
      await button.click().catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    await page.waitForTimeout(2500);
  }
  return [];
}

async function visibleChallenge(page: Page): Promise<boolean> {
  return Boolean(await page.evaluate(VISIBLE_CHALLENGE));
}

function pick(options: string[] | undefined, value: string): string | null {
  if (!options?.length) return null;
  const v = value.trim().toLowerCase();
  return options.find((o) => o.toLowerCase() === v) ?? options.find((o) => o.toLowerCase().includes(v) || v.includes(o.toLowerCase())) ?? null;
}

export async function fillField(page: Page, field: FormField, value: string, files: { cv: Buffer; cvName: string; letter: Buffer; letterName: string }) {
  const el = page.locator(`[data-bureau-id="${field.id}"]`).first();
  switch (field.kind) {
    case 'file': {
      const wantsLetter = value === 'COVER_LETTER' || /cover/i.test(field.label);
      if (value === 'SKIP' || value === '') return;
      await el.setInputFiles({ name: wantsLetter ? files.letterName : files.cvName, mimeType: 'application/pdf', buffer: wantsLetter ? files.letter : files.cv });
      return;
    }
    case 'checkbox':
      if (value === 'true') await el.check({ force: true });
      return;
    case 'select': {
      const opt = pick(field.options, value);
      if (opt) await el.selectOption({ label: opt });
      return;
    }
    case 'radio': {
      const idx = field.options?.indexOf(pick(field.options, value) ?? '') ?? -1;
      if (idx >= 0) await page.locator(`[data-bureau-id="${field.id}:${idx}"]`).check({ force: true });
      return;
    }
    case 'combobox': {
      await el.click();
      await el.fill(value);
      await page.waitForTimeout(900);
      const option = page.getByRole('option', { name: new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
      if (await option.isVisible().catch(() => false)) await option.click();
      else await el.press('Enter');
      return;
    }
    default:
      await el.fill(value);
  }
}

async function snapshot(page: Page, appId: string): Promise<string | null> {
  const file = path.join(SHOT_DIR, `${appId}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    return path.basename(file);
  } catch {
    return null;
  }
}

/**
 * Fill (and, when `submit` is true, send) the application form for a job.
 * With `headful`, the browser is left open on the filled form for you to finish.
 */
export async function applyViaForm(app: ApplicationRow, job: JobLite, opts: { submit: boolean; headful?: boolean; browser?: Browser }): Promise<FormOutcome> {
  const url = applyUrlFor(job);
  if (!url) return { status: 'needs_you', reason: 'No application page for this role.', shot: null, answers: [] };
  const profile = loadProfile();
  if (!profile) throw new AppError(412, 'NO_PROFILE', 'Upload your CV first.');
  const cv = TailoredCvSchema.parse(JSON.parse(app.cv));
  const files = {
    cv: await renderCvPdf(cv),
    cvName: cvFilename(cv.name),
    letter: await renderLetterPdf(cv.name, app.cover_letter),
    letterName: cvFilename(cv.name).replace(/-CV\.pdf$/, '-Cover-Letter.pdf'),
  };

  const ownBrowser = !opts.browser || opts.headful;
  const browser = opts.headful ? await launchBrowser(false) : (opts.browser ?? (await launchBrowser(true)));
  const ctx = await guardedContext(browser);
  const page = await ctx.newPage();
  let keepOpen = false;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(2500);
    const fields = await findForm(page);
    if (!formFound(fields)) {
      return { status: 'needs_you', reason: 'Could not find an application form on the page.', shot: await snapshot(page, app.id), answers: [] };
    }

    const p = profile.preferences;
    const ask = await structured({
      task: 'apply',
      system: [
        { type: 'text', text: FORM_FILLER },
        { type: 'text', text: profileForPrompt(profile), cache_control: { type: 'ephemeral' } },
      ],
      content: `Role: ${fence(job.title)} at ${fence(job.company)}
Candidate details for forms:
- Full name: ${profile.name} | Email: ${profile.email} | Phone: ${profile.phone} | Location: ${profile.location}
- Links: ${profile.links.map((l) => `${l.label}: ${l.url}`).join(' · ')}
- Work authorisation: ${p.workAuthorization || '(not given)'} | Needs sponsorship: ${p.needsSponsorship} | Open to relocation: ${p.openToRelocation}
- Notice period / start: ${p.noticePeriod || '(not given)'} | Salary expectation: ${p.salaryExpectation || (p.minSalary ? `${p.minSalary} ${p.currency}` : '(not given)')}
- Other standing answers: ${p.extraAnswers || '(none)'}

<tailored>
SUBJECT: ${app.subject}
COVER LETTER:
${app.cover_letter}
</tailored>

<form_fields>
${fence(JSON.stringify(fields, null, 1))}
</form_fields>`,
      schema: Answers,
      maxTokens: 12000,
    });

    const answers: FormOutcome['answers'] = [];
    for (const a of ask.answers) {
      const field = fields.find((f) => f.id === a.id);
      if (!field || a.value === '') continue;
      try {
        await fillField(page, field, a.value, files);
        answers.push({ label: field.label, value: field.kind === 'file' ? (a.value === 'COVER_LETTER' ? files.letterName : files.cvName) : a.value });
      } catch {
        answers.push({ label: field.label, value: `${a.value} (could not be entered)` });
      }
    }

    const blockers = ask.blockers
      .map((b) => ({ ...b, field: fields.find((f) => f.id === b.id) }))
      .filter((b) => b.field?.required);
    if (blockers.length) {
      keepOpen = !!opts.headful;
      return {
        status: 'needs_you',
        reason: `Needs your answer: ${blockers.map((b) => `“${b.field!.label}” (${b.reason})`).join('; ')}`,
        shot: await snapshot(page, app.id),
        answers,
      };
    }
    if (await visibleChallenge(page)) {
      keepOpen = !!opts.headful;
      return { status: 'needs_you', reason: 'This form has a CAPTCHA, so it needs your click. Everything else is filled in.', shot: await snapshot(page, app.id), answers };
    }
    if (!opts.submit) {
      keepOpen = !!opts.headful;
      return { status: opts.headful ? 'needs_you' : 'rehearsed', reason: opts.headful ? 'Filled in. Review it and press submit in the browser window.' : 'Rehearsal: form filled but not submitted.', shot: await snapshot(page, app.id), answers };
    }

    const submit = page
      .locator('button[type="submit"], input[type="submit"]')
      .or(page.getByRole('button', { name: /submit|send application|apply/i }))
      .last();
    await submit.click({ timeout: 10_000 });
    const verdict = await Promise.race([
      page.waitForFunction(CONFIRMED, null, { timeout: 20_000 }).then(() => 'ok' as const),
      page.waitForURL(/confirm|thank|success|submitted/i, { timeout: 20_000 }).then(() => 'ok' as const),
    ]).catch(() => 'unknown' as const);
    const shot = await snapshot(page, app.id);
    if (verdict === 'ok') return { status: 'submitted', reason: 'Submitted through the company form.', shot, answers };
    if (await visibleChallenge(page)) return { status: 'needs_you', reason: 'A CAPTCHA appeared on submit. It needs your click.', shot, answers };
    const errors = await page
      .locator('[role="alert"], .error, [class*="error"], [aria-invalid="true"]')
      .allInnerTexts()
      .then((t) => t.map((s) => s.trim()).filter(Boolean).slice(0, 3).join(' · '))
      .catch(() => '');
    return { status: 'needs_you', reason: errors ? `The form reported: ${errors.slice(0, 300)}` : 'Submitted, but no confirmation appeared. Please check.', shot, answers };
  } catch (err) {
    return { status: 'failed', reason: (err as Error).message.split('\n')[0].slice(0, 300), shot: await snapshot(page, app.id).catch(() => null), answers: [] };
  } finally {
    if (!keepOpen) {
      await ctx.close().catch(() => {});
      if (ownBrowser) await browser.close().catch(() => {});
    }
  }
}

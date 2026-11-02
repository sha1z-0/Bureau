import type { Page } from 'playwright-core';
import type { AtsFamily } from '../contracts/job.ts';
import type { FieldValue, FillOptions, FillOutcome, FormField, VerifyResult } from '../contracts/forms.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { detectAts as detect } from './detect.ts';
import { runFill } from './engine.ts';
import { extractFields as extract } from './extract.ts';
import { fillField } from './handlers/index.ts';
import { mapFields as map } from './map.ts';
import { verifyForm as verify } from './verify.ts';

/** A05 — fills any application form, verifies, submits. Never submits unless verified. */

export async function fillApplication(packet: ApplicationPacket, opts: FillOptions): Promise<FillOutcome> {
  return runFill(packet, opts);
}

export function detectAts(url: string, html?: string): AtsFamily | null {
  return detect(url, html);
}

/** Every field on the current step, across shadow roots and same-origin frames. */
export async function extractFields(page: Page): Promise<FormField[]> {
  return extract(page);
}

/** Map fields to values: synonyms → answer bank → writer. Low-confidence required fields come back with confidence < 0.7. */
export async function mapFields(fields: FormField[], packet: ApplicationPacket): Promise<FieldValue[]> {
  return map(fields, packet);
}

/** Fill one field with the right widget handler and read it back. */
export async function fillOne(page: Page, field: FormField, value: FieldValue, files: { cv: string; letter: string }): Promise<{ ok: boolean; readBack: string }> {
  const r = await fillField(page, field, value, files);
  return { ok: r.ok, readBack: r.readBack };
}

export async function verifyForm(page: Page, fields: FormField[], intended: FieldValue[]): Promise<VerifyResult> {
  return verify(page, fields, intended);
}

// Wider surface for A06 (agent), A07 (API), A10 (UI) and tests.
export { runFill, submitVerified, UnverifiedSubmitError, alreadySubmitted, applyUrlFor, type EngineDeps } from './engine.ts';
export { extractStep, formPresent } from './extract.ts';
export { mapFieldsWith, type MappedValue } from './map.ts';
export { verifyFields } from './verify.ts';
export { SYNONYMS, matchSynonym, synonymCount } from './synonyms.ts';
export { ADAPTERS, adapterFor } from './adapters/index.ts';
export { guardedContext, launchBrowser, browserAvailable, allowFixtureOrigins, urlAllowed } from './browser.ts';
export { labelNorm, signatureOf } from './normalize.ts';

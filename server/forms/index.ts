import type { Page } from 'playwright-core';
import type { AtsFamily } from '../contracts/job.ts';
import type { FieldValue, FillOptions, FillOutcome, FormField, VerifyResult } from '../contracts/forms.ts';
import type { ApplicationPacket } from '../contracts/writer.ts';
import { NotImplemented } from '../contracts/stub.ts';

/** A05 — fills any application form, verifies, submits. Never submits unless verified. */

export async function fillApplication(packet: ApplicationPacket, opts: FillOptions): Promise<FillOutcome> {
  void packet;
  void opts;
  throw new NotImplemented('A05', 'fillApplication');
}

export function detectAts(url: string, html?: string): AtsFamily | null {
  void url;
  void html;
  throw new NotImplemented('A05', 'detectAts');
}

/** Every field on the current step, across shadow roots and same-origin frames. */
export async function extractFields(page: Page): Promise<FormField[]> {
  void page;
  throw new NotImplemented('A05', 'extractFields');
}

/** Map fields to values: synonyms → answer bank → writer. Low-confidence required fields come back with confidence < 0.7. */
export async function mapFields(fields: FormField[], packet: ApplicationPacket): Promise<FieldValue[]> {
  void fields;
  void packet;
  throw new NotImplemented('A05', 'mapFields');
}

/** Fill one field with the right widget handler and read it back. */
export async function fillOne(page: Page, field: FormField, value: FieldValue, files: { cv: string; letter: string }): Promise<{ ok: boolean; readBack: string }> {
  void page;
  void field;
  void value;
  void files;
  throw new NotImplemented('A05', 'fillOne');
}

export async function verifyForm(page: Page, fields: FormField[], intended: FieldValue[]): Promise<VerifyResult> {
  void page;
  void fields;
  void intended;
  throw new NotImplemented('A05', 'verifyForm');
}

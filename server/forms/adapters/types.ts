import type { Page } from 'playwright-core';
import type { AtsFamily } from '../../contracts/job.ts';
import type { AccountSelectors } from '../accounts.ts';
import type { ExtractedField, StepExtract } from '../extract.ts';

/**
 * An ATS adapter encodes one applicant-tracking system's flow, quirks and
 * confirmation signals. The engine does the filling (extract → map → handlers →
 * read-back → verify); an adapter tells it how to reach the form, how the wizard
 * moves, what to ignore, and how to know it worked.
 */
export interface AdapterRun {
  page: Page;
  step: number;
  note: (msg: string) => void;
  /** Profile counts for repeating sections. */
  entries: { work: number; education: number };
}

export interface Adapter {
  ats: AtsFamily;
  name: string;
  /** Rewrite a posting URL to the form itself (e.g. Lever `/apply`). */
  applyUrl?: (url: string) => string;
  /** Get from the posting to the form (click Apply, choose manual apply, open a modal). */
  openForm?: (page: Page, run: AdapterRun) => Promise<void>;
  /** Candidate-account flow (Workday, iCIMS…). */
  account?: { selectors?: Partial<AccountSelectors>; needed: (page: Page) => Promise<boolean> };
  /** Buttons that move the wizard on, tried before generic detection. */
  next?: string[];
  /** The final submit button(s), tried before generic detection. */
  submit?: string[];
  /** Confirmation signals after submit. */
  confirm: { text?: RegExp; selectors?: string[]; url?: RegExp };
  /** Labels to leave alone (sign-in widgets, search boxes, "use my last application"). */
  ignore?: RegExp[];
  /** Page error texts that are not validation errors (static legends, help text styled as errors). */
  ignoreErrors?: RegExp;
  /** Hook before each wizard step is filled (parse correction, deleting bogus entries…). */
  beforeStep?: (page: Page, run: AdapterRun, ex: StepExtract) => Promise<void>;
  /** Field tweaks the generic extractor can't know (e.g. which file input is the CV). */
  fixField?: (f: ExtractedField) => ExtractedField | null;
  /** Is the current page the last one (review / submit)? */
  isFinal?: (page: Page, ex: StepExtract) => Promise<boolean>;
  /** Milliseconds to wait after Next for the step to change. */
  stepWaitMs?: number;
}

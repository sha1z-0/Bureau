import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v4';

/**
 * The fixture-form manifest (fixtures/ats/manifest.json). It is the single
 * description of every local ATS replica: where it is served, what a correct
 * submission must contain, and what the form engine is expected to send.
 * The fixture server, the golden fills in selfcheck and the e2e runner all
 * read it, so a form is added in exactly one place.
 */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'fixtures');
export const ATS_DIR = path.join(FIXTURES, 'ats');

/**
 * What a submitted key must hold, checked by `checkExpectations()`:
 *  - `profile:<key>`  equals fixtures/profile/expected.json[key] (normalised: case, spaces, punctuation in phones/URLs)
 *  - `answer:<key>`   equals expected.json.answers[key]
 *  - `oneOf:a|b|c`    one of the listed values (normalised)
 *  - `file:cv` / `file:letter`  a PDF upload was recorded under this key
 *  - `nonempty`       any non-empty value
 *  - `empty`          absent or empty (honeypots, optional fields that must stay blank)
 *  - `decline`        an EEO/self-ID "decline to answer" style value
 *  - `true` / `false` a checkbox that is (not) checked: any of on/true/yes/1 vs. absent/false/no/0
 *  - `contains:<s>`   contains the substring (normalised)
 *  - `=<literal>`     equals the literal (normalised)
 */
export const ExpectRule = z.string().regex(/^(profile:\w+|answer:\w+|oneOf:.+|file:(cv|letter)|nonempty|empty|decline|true|false|contains:.+|=.*)$/);

export const FormSpecSchema = z.object({
  /** Stable id, also the submit path segment: POST /__submit/<id>. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** ATS family as in server/contracts/job.ts, or "widget" for torture pages. */
  ats: z.string(),
  title: z.string(),
  /** Served path on the fixture server. Mirrors the real ATS URL shape (host as first segment). */
  route: z.string().startsWith('/'),
  /** File under fixtures/ats/ that the route serves. */
  file: z.string(),
  /** More pages this replica needs (iframe documents, wizard pages, account screens). Served on both origins. */
  extraRoutes: z.array(z.object({ route: z.string().startsWith('/'), file: z.string() })).default([]),
  /** Which origin the entry page lives on. "b" is the second, cross-origin server. */
  origin: z.enum(['a', 'b']).default('a'),
  /** Confirmation page served at /__confirm/<id> after a valid submit, and the text that proves it. */
  confirmationFile: z.string().optional(),
  confirmationText: z.string(),
  /** Number of wizard steps before the final submit (1 = single page). */
  steps: z.number().int().min(1).default(1),
  /** Submission keys (field names or file field names) the server requires to be non-empty. */
  required: z.array(z.string()),
  /** Field names that must stay empty (bot traps). */
  honeypots: z.array(z.string()).default([]),
  /** Submission key → rule (see ExpectRule). Used to assert exactly what was sent. */
  expect: z.record(z.string(), ExpectRule),
  /** The server refuses the submission unless this field carries a token only a human click produces. */
  captcha: z.boolean().default(false),
  /** Workday-style account wall before the form. */
  login: z.boolean().default(false),
  /** Expected terminal outcome for an automated filler: submitted, or needs_you (CAPTCHA), or verify_blocked. */
  expectedOutcome: z.enum(['submitted', 'needs_you', 'verify_blocked']).default('submitted'),
  /** The widgets and quirks this replica reproduces (documentation and coverage reporting). */
  quirks: z.array(z.string()).default([]),
  /** Where the real structure was studied (public pages only). */
  reference: z.string().default(''),
});
export type FormSpec = z.infer<typeof FormSpecSchema>;

export const ManifestSchema = z.object({
  /** Strings planted by prompt-injection fixtures. Any submission containing one is flagged. */
  canaries: z.array(z.string()),
  forms: z.array(FormSpecSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const FragmentSchema = z.object({ forms: z.array(FormSpecSchema) });

/** fixtures/ats/manifest.json (canaries) merged with every fixtures/ats/<dir>/manifest.json (forms). */
export function loadManifest(): Manifest {
  const raw = JSON.parse(fs.readFileSync(path.join(ATS_DIR, 'manifest.json'), 'utf8')) as unknown;
  const m = ManifestSchema.parse(raw);
  for (const dir of fs.readdirSync(ATS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const file = path.join(ATS_DIR, dir, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    const frag = FragmentSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!frag.success) throw new Error(`fixtures/ats/${dir}/manifest.json: ${frag.error.message}`);
    m.forms.push(...frag.data.forms);
  }
  const ids = new Set<string>();
  for (const f of m.forms) {
    if (ids.has(f.id)) throw new Error(`Duplicate fixture form id ${f.id}`);
    ids.add(f.id);
  }
  return m;
}

/** The fictional candidate's flat values that fixture forms expect (fixtures/profile/expected.json). */
export const ExpectedDataSchema = z
  .object({
    firstName: z.string(),
    lastName: z.string(),
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    answers: z.record(z.string(), z.string()),
  })
  .catchall(z.unknown());
export type ExpectedData = z.infer<typeof ExpectedDataSchema>;

export function loadExpected(): ExpectedData {
  return ExpectedDataSchema.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'profile', 'expected.json'), 'utf8')));
}

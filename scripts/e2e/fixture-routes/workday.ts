/**
 * Server side of the Workday candidate-experience replica (fixtures/ats/workday).
 *
 * Mirrors the shape of Workday's own endpoints under the tenant host segment:
 *   /atlasmutual.wd5.myworkdayjobs.com/wday/authgwy/atlasmutual/...   account + session
 *   /atlasmutual.wd5.myworkdayjobs.com/wday/cxs/atlasmutual/AtlasCareers/...  job JSON, attachments,
 *                                                                     resume parse, drafts, applications
 *
 * Accounts live in ctx.state (shared by both origins, cleared by reset()), so a
 * second application by the same candidate must sign in to the existing account.
 * Creating an account sends a real verification email (6-digit code) through
 * ctx.addMail; verifying or signing in sets the `fx_session` cookie that the
 * generic /__submit recorder copies into Submission.session.
 *
 * Like Workday, every state-changing call must echo the CALYPSO_CSRF_TOKEN
 * cookie in an X-CALYPSO-CSRF-TOKEN header (the SPA does this; a raw POST does not).
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FixtureRouteContext } from '../../fixture-server.ts';

const HOST = '/atlasmutual.wd5.myworkdayjobs.com';
const AUTH = `${HOST}/wday/authgwy/atlasmutual`;
const CXS = `${HOST}/wday/cxs/atlasmutual/AtlasCareers`;
const SITE = `${HOST}/en-US/AtlasCareers`;
const JOB_PATH = 'Remote---Pakistan/Associate-Software-Engineer_R-104233';
const REQ_ID = 'R-104233';
const SENDER = '"Atlas Mutual" <atlasmutual@myworkday.com>';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_UPLOAD = 5 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  txt: 'text/plain',
};

interface Account {
  email: string;
  salt: string;
  hash: string;
  verified: boolean;
  code: string;
  codeIssued: number;
  attempts: number;
  createdAt: string;
}
interface Session {
  id: string;
  email: string;
  createdAt: string;
}
interface Attachment {
  id: string;
  owner: string;
  fileName: string;
  contentType: string;
  size: number;
  sha256: string;
  data: Buffer;
  uploadedAt: string;
}
interface Draft {
  jobReqId: string;
  updatedAt: string;
  data: unknown;
}
interface Application {
  jobReqId: string;
  jobTitle: string;
  status: string;
  submittedOn: string;
  snapshot: unknown;
}

function bag<T>(ctx: FixtureRouteContext, key: string): Map<string, T> {
  let m = ctx.state.get(`workday:${key}`) as Map<string, T> | undefined;
  if (!m) {
    m = new Map<string, T>();
    ctx.state.set(`workday:${key}`, m);
  }
  return m;
}

function cookies(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function appendCookie(reply: FastifyReply, cookie: string) {
  const cur = reply.getHeader('set-cookie');
  const list = cur === undefined ? [] : Array.isArray(cur) ? cur.map(String) : [String(cur)];
  reply.header('set-cookie', [...list, cookie]);
}

const hashPassword = (salt: string, pw: string) => crypto.scryptSync(pw, salt, 32).toString('hex');
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(3, user.length - 1))}@${domain}`;
}

/** Workday's candidate password policy, with its error wording. */
export function passwordErrors(pw: string, email: string): string[] {
  const errs: string[] = [];
  if (pw.length < 8) errs.push('Password must contain at least 8 characters.');
  if (!/[A-Z]/.test(pw)) errs.push('Password must contain an uppercase alpha character.');
  if (!/[a-z]/.test(pw)) errs.push('Password must contain a lowercase alpha character.');
  if (!/[0-9]/.test(pw)) errs.push('Password must contain a numeric character.');
  if (!/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(pw)) errs.push('Password must contain a special character.');
  const user = email.split('@')[0];
  if (user.length >= 3 && pw.toLowerCase().includes(user.toLowerCase())) errs.push('Password cannot contain your email address.');
  return errs;
}

/**
 * The "parsed" resume. Workday's parser reads Rania's CV and makes the
 * mistakes real parsers make; a careful applicant must correct every one:
 *  1. work 1 job title merged with the company ("Junior Software Engineer Tessellate Labs")
 *  2. work 1 company is the location line ("Lahore (hybrid)")
 *  3. work 1 start year wrong (2022, CV says Jul 2023)
 *  4. work 1 "I currently work here" not ticked and no end date ("Present" was lost)
 *  5. a bogus work 3 built from the ledger-lite project
 *  6. school name truncated ("Lahore Institute of")
 *  7. degree not recognised (left at Select One)
 *  8. GPA copied with its scale ("3.4 / 4.0")
 *  9. phone without a country code, written with the trunk 0 ("0301 5550142")
 * The country is left at the site default (United States of America).
 */
function parsedResume() {
  return {
    parserVersion: 'wd-resume-parser 2026.10.3',
    myInformation: {
      legalNameSection_firstName: 'Rania',
      legalNameSection_lastName: 'Haroon',
      addressSection_city: 'Lahore',
      'phone-number': '0301 5550142',
    },
    myExperience: {
      workExperience: [
        {
          jobTitle: 'Junior Software Engineer Tessellate Labs',
          company: 'Lahore (hybrid)',
          location: '',
          currentlyWorkHere: false,
          startMonth: '07',
          startYear: '2022',
          endMonth: '',
          endYear: '',
          roleDescription:
            'Built and maintain the invoicing service (Node.js, TypeScript, PostgreSQL) that issues about 9,000 invoices a month for the company\'s logistics clients.\nCut the nightly reconciliation job from 41 minutes to 6 by replacing row-by-row updates with set-based SQL and adding two partial indexes.\nMoved four services from a hand-built VPS setup to Docker Compose with health checks; wrote the runbook the on-call rotation now uses.',
        },
        {
          jobTitle: 'Software Engineering Intern',
          company: 'Kestrel Analytics',
          location: 'Lahore',
          currentlyWorkHere: false,
          startMonth: '06',
          startYear: '2022',
          endMonth: '09',
          endYear: '2022',
          roleDescription:
            'Wrote Python scripts that cleaned and loaded retail sales CSVs into PostgreSQL for the analytics team (about 2 million rows a week).\nAdded unit tests to the ingestion scripts (pytest), raising coverage of the loader module from 0 to 71%.',
        },
        {
          jobTitle: 'ledger-lite',
          company: 'github.com/rania-haroon-example/ledger-lite',
          location: '',
          currentlyWorkHere: false,
          startMonth: '',
          startYear: '',
          endMonth: '',
          endYear: '',
          roleDescription: 'A small double-entry bookkeeping API in TypeScript (Fastify, PostgreSQL). Enforces balanced journal entries with a database constraint and exposes a trial balance endpoint. 140 GitHub stars.',
        },
      ],
      education: [
        {
          school: { label: 'Lahore Institute of', unmatched: true },
          degree: '',
          fieldOfStudy: 'Computer Science',
          gradeAverage: '3.4 / 4.0',
          firstYearAttended: '2019',
          lastYearAttended: '2023',
        },
      ],
      skills: ['TypeScript', 'JavaScript', 'Node.js', 'React', 'PostgreSQL', 'Python', 'Docker'],
      websites: ['https://github.com/rania-haroon-example', 'https://rania-haroon.example.com'],
      linkedin: '',
    },
  };
}

const JOB_INFO = {
  jobPostingInfo: {
    id: '8f1e2d3c4b5a69788776655443322110',
    title: 'Associate Software Engineer',
    jobReqId: REQ_ID,
    location: 'Remote - Pakistan',
    additionalLocations: [] as string[],
    timeType: 'Full time',
    postedOn: 'Posted 3 Days Ago',
    startDate: '2026-10-30',
    externalUrl: `https://atlasmutual.wd5.myworkdayjobs.com/en-US/AtlasCareers/job/${JOB_PATH}`,
    jobDescription: [
      '<p><b>About Atlas Mutual</b></p>',
      '<p>Atlas Mutual is a member-owned insurer serving policyholders across four continents. Our Digital Engineering group builds the claims, billing and member-portal systems behind every policy.</p>',
      '<p><b>The role</b></p>',
      '<p>As an Associate Software Engineer on the Billing Platform team you will build and maintain TypeScript and Node.js services that calculate premiums, issue invoices and reconcile payments, working fully remotely from Pakistan with a team spread across UTC+0 to UTC+5.</p>',
      '<p><b>What you will do</b></p>',
      '<ul><li>Build and operate Node.js / TypeScript services backed by PostgreSQL</li><li>Write migrations and queries that stay correct under concurrency</li><li>Own small features end to end, from design note to production</li><li>Take part in code review and a light on-call rotation</li></ul>',
      '<p><b>What you bring</b></p>',
      '<ul><li>1-3 years of professional software engineering experience</li><li>Working knowledge of SQL and relational modelling</li><li>A degree in Computer Science or a related field, or equivalent experience</li><li>Nice to have: Docker, React, experience with billing or financial systems</li></ul>',
      '<p>Atlas Mutual is an equal opportunity employer. All qualified applicants will receive consideration for employment without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, disability or protected veteran status.</p>',
    ].join(''),
    canApply: true,
    posted: true,
  },
  hiringOrganization: { name: 'Atlas Mutual' },
};

export function register(app: FastifyInstance, ctx: FixtureRouteContext): void {
  const accounts = () => bag<Account>(ctx, 'accounts');
  const sessions = () => bag<Session>(ctx, 'sessions');
  const attachments = () => bag<Attachment>(ctx, 'attachments');
  const drafts = () => bag<Draft>(ctx, 'drafts');
  const applications = () => bag<Application[]>(ctx, 'applications');
  const selfOrigin = () => (ctx.origin === 'b' ? ctx.originB() : ctx.originA());

  const sessionOf = (req: FastifyRequest): Session | null => {
    const id = cookies(req).fx_session;
    return id ? (sessions().get(id) ?? null) : null;
  };

  const csrfOk = (req: FastifyRequest): boolean => {
    const c = cookies(req).CALYPSO_CSRF_TOKEN;
    return !!c && req.headers['x-calypso-csrf-token'] === c;
  };

  /** Guard for state-changing calls: CSRF always, a signed-in session when `auth`. */
  const guard = (req: FastifyRequest, reply: FastifyReply, auth: boolean): Session | null | false => {
    if (!csrfOk(req)) {
      reply.status(403).send({ errorCode: 'CSRF_TOKEN_INVALID', errors: [{ message: 'Your session is no longer valid. Refresh the page and try again.' }] });
      return false;
    }
    if (!auth) return null;
    const s = sessionOf(req);
    if (!s) {
      reply.status(401).send({ errorCode: 'SESSION_EXPIRED', errors: [{ message: 'Your session has expired. Sign in to continue.' }] });
      return false;
    }
    return s;
  };

  const startSession = (reply: FastifyReply, email: string): Session => {
    const s: Session = { id: `wd-${crypto.randomBytes(12).toString('hex')}`, email, createdAt: new Date().toISOString() };
    sessions().set(s.id, s);
    appendCookie(reply, `fx_session=${s.id}; Path=/; HttpOnly; SameSite=Lax`);
    ctx.log(`workday: signed in ${email}`);
    return s;
  };

  const sendVerification = (acct: Account) => {
    acct.code = newCode();
    acct.codeIssued = Date.now();
    acct.attempts = 0;
    const link = `${selfOrigin()}${SITE}/login`;
    const text = [
      'Atlas Mutual Careers',
      '',
      'Hello,',
      '',
      'Thank you for creating a candidate account with Atlas Mutual. To finish setting up your account, enter this verification code on the Verify Your Account page:',
      '',
      `    ${acct.code}`,
      '',
      'This code expires in 10 minutes. For your security, do not share it with anyone.',
      '',
      `Once your account is verified you can sign in at ${link} to track your applications.`,
      '',
      'If you did not create this account, you can ignore this email.',
      '',
      'Atlas Mutual Talent Acquisition',
      'This is an automated message from Workday. Please do not reply.',
    ].join('\n');
    const html = `<div style="font-family:Arial,sans-serif;color:#333"><h2 style="color:#0b5394">Atlas Mutual Careers</h2><p>Hello,</p><p>Thank you for creating a candidate account with Atlas Mutual. To finish setting up your account, enter this verification code on the <b>Verify Your Account</b> page:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${acct.code}</p><p>This code expires in 10 minutes. For your security, do not share it with anyone.</p><p>Once your account is verified you can <a href="${link}">sign in</a> to track your applications.</p><p style="color:#888;font-size:12px">If you did not create this account, you can ignore this email.<br>This is an automated message from Workday. Please do not reply.</p></div>`;
    ctx.addMail({
      to: acct.email,
      from: SENDER,
      subject: 'Verify your candidate account',
      text,
      html,
      meta: { kind: 'workday-verification', tenant: 'atlasmutual', code: acct.code, email: acct.email },
    });
  };

  const body = (req: FastifyRequest): Record<string, unknown> => (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {});

  // ---------------------------------------------------------------- session
  app.get(`${AUTH}/session`, async (req, reply) => {
    let csrf = cookies(req).CALYPSO_CSRF_TOKEN;
    if (!csrf) {
      csrf = crypto.randomBytes(16).toString('hex');
      appendCookie(reply, `CALYPSO_CSRF_TOKEN=${csrf}; Path=/; SameSite=Lax`);
    }
    const s = sessionOf(req);
    return reply.send({ signedIn: !!s, email: s?.email ?? null, tenant: 'atlasmutual', site: 'AtlasCareers' });
  });

  app.post(`${AUTH}/createAccount`, async (req, reply) => {
    if (guard(req, reply, false) === false) return reply;
    const b = body(req);
    const email = normEmail(b.email);
    const password = String(b.password ?? '');
    const verifyPassword = String(b.verifyPassword ?? '');
    const errors: { field: string; message: string }[] = [];
    if (!email) errors.push({ field: 'email', message: 'The field Email Address is required and must have a value.' });
    else if (!isEmail(email)) errors.push({ field: 'email', message: 'Enter a valid email address. For example: name@example.com.' });
    if (!password) errors.push({ field: 'password', message: 'The field Password is required and must have a value.' });
    else for (const m of passwordErrors(password, email)) errors.push({ field: 'password', message: m });
    if (!verifyPassword) errors.push({ field: 'verifyPassword', message: 'The field Verify New Password is required and must have a value.' });
    else if (password && verifyPassword !== password) errors.push({ field: 'verifyPassword', message: 'The passwords you entered do not match.' });
    if (b.acceptTerms !== true && b.acceptTerms !== 'true') errors.push({ field: 'createAccountCheckbox', message: 'You must agree to the Candidate Privacy Statement before you create an account.' });
    if (errors.length) return reply.status(400).send({ errorCode: 'VALIDATION', errors });

    const existing = accounts().get(email);
    if (existing?.verified) {
      return reply.status(409).send({
        errorCode: 'ACCOUNT_EXISTS',
        errors: [{ field: 'email', message: 'An account with this email address already exists. Sign in to continue, or select Forgot your password? to reset it.' }],
      });
    }
    if (existing) {
      // Unverified: Workday re-sends the verification and keeps the new password.
      existing.salt = crypto.randomBytes(8).toString('hex');
      existing.hash = hashPassword(existing.salt, password);
      sendVerification(existing);
      return reply.send({ status: 'VERIFICATION_REQUIRED', email, maskedEmail: maskEmail(email) });
    }
    const salt = crypto.randomBytes(8).toString('hex');
    const acct: Account = { email, salt, hash: hashPassword(salt, password), verified: false, code: '', codeIssued: 0, attempts: 0, createdAt: new Date().toISOString() };
    accounts().set(email, acct);
    sendVerification(acct);
    ctx.log(`workday: account created for ${email} (unverified)`);
    return reply.send({ status: 'VERIFICATION_REQUIRED', email, maskedEmail: maskEmail(email) });
  });

  app.post(`${AUTH}/verifyAccount`, async (req, reply) => {
    if (guard(req, reply, false) === false) return reply;
    const b = body(req);
    const email = normEmail(b.email);
    const code = String(b.code ?? '').replace(/\s+/g, '');
    const acct = accounts().get(email);
    const fail = (message: string, errorCode = 'INVALID_CODE') => reply.status(400).send({ errorCode, errors: [{ field: 'verificationCode', message }] });
    if (!acct) return fail('We could not find an account for this email address. Create an account to continue.', 'NO_ACCOUNT');
    if (acct.verified) {
      startSession(reply, email);
      return reply.send({ status: 'SIGNED_IN', email });
    }
    if (!code) return fail('The field Verification Code is required and must have a value.', 'REQUIRED');
    if (acct.attempts >= MAX_CODE_ATTEMPTS) return fail('Too many incorrect attempts. Select Resend Code to get a new verification code.', 'LOCKED');
    if (Date.now() - acct.codeIssued > CODE_TTL_MS) return fail('This verification code has expired. Select Resend Code to get a new one.', 'EXPIRED');
    if (code !== acct.code) {
      acct.attempts++;
      return fail('The verification code you entered is incorrect. Check the code and try again.');
    }
    acct.verified = true;
    acct.code = '';
    startSession(reply, email);
    return reply.send({ status: 'SIGNED_IN', email });
  });

  app.post(`${AUTH}/resendVerification`, async (req, reply) => {
    if (guard(req, reply, false) === false) return reply;
    const email = normEmail(body(req).email);
    const acct = accounts().get(email);
    if (acct && !acct.verified) sendVerification(acct);
    return reply.send({ status: 'SENT', maskedEmail: email ? maskEmail(email) : '' });
  });

  app.post(`${AUTH}/signIn`, async (req, reply) => {
    if (guard(req, reply, false) === false) return reply;
    const b = body(req);
    const email = normEmail(b.email);
    const password = String(b.password ?? '');
    const errors: { field: string; message: string }[] = [];
    if (!email) errors.push({ field: 'email', message: 'The field Email Address is required and must have a value.' });
    if (!password) errors.push({ field: 'password', message: 'The field Password is required and must have a value.' });
    if (errors.length) return reply.status(400).send({ errorCode: 'VALIDATION', errors });
    const acct = accounts().get(email);
    if (!acct || hashPassword(acct.salt, password) !== acct.hash) {
      return reply.status(401).send({ errorCode: 'INVALID_CREDENTIALS', errors: [{ field: '', message: 'Wrong email address or password.' }] });
    }
    if (!acct.verified) {
      sendVerification(acct);
      return reply.status(403).send({
        errorCode: 'VERIFICATION_REQUIRED',
        email,
        maskedEmail: maskEmail(email),
        errors: [{ field: '', message: 'Your account has not been verified. We sent a new verification code to your email address.' }],
      });
    }
    startSession(reply, email);
    return reply.send({ status: 'SIGNED_IN', email });
  });

  app.post(`${AUTH}/signOut`, async (req, reply) => {
    const id = cookies(req).fx_session;
    if (id) sessions().delete(id);
    appendCookie(reply, 'fx_session=; Path=/; Max-Age=0; SameSite=Lax');
    return reply.send({ status: 'SIGNED_OUT' });
  });

  app.post(`${AUTH}/forgotPassword`, async (req, reply) => {
    if (guard(req, reply, false) === false) return reply;
    // Real Workday mails a reset link; the replica only acknowledges (no reset flow).
    return reply.send({ status: 'SENT', message: 'If an account exists for this email address, you will receive an email with instructions to reset your password.' });
  });

  // ---------------------------------------------------------------- job
  app.get(`${CXS}/job/${JOB_PATH}`, async (_req, reply) => reply.send(JOB_INFO));
  app.get(`${CXS}/jobs`, async (_req, reply) =>
    reply.send({ total: 1, jobPostings: [{ title: JOB_INFO.jobPostingInfo.title, externalPath: `/job/${JOB_PATH}`, locationsText: 'Remote - Pakistan', postedOn: 'Posted 3 Days Ago', bulletFields: [REQ_ID] }] }),
  );

  // ---------------------------------------------------------------- attachments + parse
  app.post(`${CXS}/attachments`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    if (!req.isMultipart()) return reply.status(400).send({ errors: [{ message: 'Expected a file upload.' }] });
    const part = await req.file();
    if (!part) return reply.status(400).send({ errors: [{ message: 'Expected a file upload.' }] });
    const data = await part.toBuffer();
    const ext = (part.filename.split('.').pop() ?? '').toLowerCase();
    if (!UPLOAD_TYPES[ext]) return reply.status(400).send({ errorCode: 'FILE_TYPE', errors: [{ message: `The file type .${ext} is not supported. Upload a file with one of these extensions: pdf, doc, docx, rtf, txt.` }] });
    if (data.length === 0) return reply.status(400).send({ errorCode: 'EMPTY', errors: [{ message: 'The file you selected is empty.' }] });
    if (data.length > MAX_UPLOAD) return reply.status(400).send({ errorCode: 'FILE_SIZE', errors: [{ message: 'The file exceeds the maximum file size of 5 MB.' }] });
    const a: Attachment = {
      id: crypto.randomBytes(16).toString('hex'),
      owner: s.email,
      fileName: part.filename,
      contentType: part.mimetype || UPLOAD_TYPES[ext],
      size: data.length,
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      data,
      uploadedAt: new Date().toISOString(),
    };
    attachments().set(a.id, a);
    ctx.log(`workday: attachment ${a.fileName} (${a.size} bytes) for ${s.email}`);
    return reply.send({ id: a.id, fileName: a.fileName, contentType: a.contentType, size: a.size, uploadedAt: a.uploadedAt });
  });

  app.get(`${CXS}/attachments/:id`, async (req, reply) => {
    const s = sessionOf(req);
    const a = attachments().get((req.params as { id: string }).id);
    if (!s || !a || a.owner !== s.email) return reply.status(404).send({ errors: [{ message: 'Not found' }] });
    return reply.type(a.contentType).header('content-disposition', `attachment; filename="${a.fileName.replace(/"/g, '')}"`).send(a.data);
  });

  app.delete(`${CXS}/attachments/:id`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    const a = attachments().get((req.params as { id: string }).id);
    if (a && a.owner === s.email) attachments().delete(a.id);
    return reply.send({ ok: true });
  });

  app.post(`${CXS}/resumeParse`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    const a = attachments().get(String(body(req).attachmentId ?? ''));
    if (!a || a.owner !== s.email) return reply.status(404).send({ errors: [{ message: 'The uploaded file could not be found. Upload it again.' }] });
    await new Promise((r) => setTimeout(r, 450)); // parsing takes a moment
    if (a.data.subarray(0, 5).toString('latin1') !== '%PDF-' && !/\.(docx?|rtf|txt)$/i.test(a.fileName)) {
      return reply.status(422).send({ errorCode: 'PARSE_FAILED', errors: [{ message: 'We could not read your resume. You can still continue and enter your information manually.' }] });
    }
    ctx.log(`workday: parsed ${a.fileName}`);
    return reply.send({ attachmentId: a.id, ...parsedResume() });
  });

  // ---------------------------------------------------------------- drafts + applications
  const draftKey = (s: Session) => `${s.email}|${REQ_ID}`;

  app.get(`${CXS}/applications/${REQ_ID}/draft`, async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.status(401).send({ errorCode: 'SESSION_EXPIRED' });
    const d = drafts().get(draftKey(s));
    return d ? reply.send(d) : reply.status(404).send({ errorCode: 'NO_DRAFT' });
  });

  app.put(`${CXS}/applications/${REQ_ID}/draft`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    const d: Draft = { jobReqId: REQ_ID, updatedAt: new Date().toISOString(), data: body(req).data ?? null };
    drafts().set(draftKey(s), d);
    return reply.send({ ok: true, updatedAt: d.updatedAt });
  });

  app.delete(`${CXS}/applications/${REQ_ID}/draft`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    drafts().delete(draftKey(s));
    return reply.send({ ok: true });
  });

  app.post(`${CXS}/applications/${REQ_ID}/submitted`, async (req, reply) => {
    const s = guard(req, reply, true);
    if (!s) return reply;
    const list = applications().get(s.email) ?? [];
    list.push({ jobReqId: REQ_ID, jobTitle: JOB_INFO.jobPostingInfo.title, status: 'Application Received', submittedOn: new Date().toISOString(), snapshot: body(req).snapshot ?? null });
    applications().set(s.email, list);
    drafts().delete(draftKey(s));
    return reply.send({ ok: true, count: list.length });
  });

  app.get(`${CXS}/applications`, async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.status(401).send({ errorCode: 'SESSION_EXPIRED' });
    const list = (applications().get(s.email) ?? []).map(({ snapshot: _snap, ...rest }) => rest);
    return reply.send({ email: s.email, applications: list });
  });

  app.get(`${CXS}/applications/last`, async (req, reply) => {
    const s = sessionOf(req);
    if (!s) return reply.status(401).send({ errorCode: 'SESSION_EXPIRED' });
    const last = (applications().get(s.email) ?? []).at(-1);
    return last ? reply.send(last) : reply.status(404).send({ errorCode: 'NO_PREVIOUS_APPLICATION' });
  });
}

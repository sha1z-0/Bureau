import nodemailer from 'nodemailer';
import { getSetting } from '../db.ts';
import { AppError } from '../errors.ts';
import { getSecret } from '../security/vault.ts';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  bccSelf: boolean;
}

export function smtpSettings(): SmtpSettings | null {
  return getSetting<SmtpSettings | null>('smtp', null);
}

function transport() {
  const s = smtpSettings();
  const pass = getSecret('smtp_password');
  if (!s || !s.host || !pass) throw new AppError(412, 'NO_SMTP', 'Connect an email account in Settings → Email to send applications.');
  return {
    settings: s,
    transporter: nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: { user: s.user, pass },
      requireTLS: !s.secure,
      tls: { minVersion: 'TLSv1.2' },
    }),
  };
}

export async function verifySmtp(): Promise<string> {
  const { transporter, settings } = transport();
  await transporter.verify();
  return `Connected to ${settings.host} as ${settings.user}`;
}

const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

export async function sendApplicationEmail(opts: {
  to: string;
  subject: string;
  text: string;
  attachment: { filename: string; content: Buffer };
}) {
  if (!EMAIL_RE.test(opts.to)) throw new AppError(400, 'BAD_EMAIL', 'That recipient address does not look valid.');
  const { transporter, settings } = transport();
  // Strip CR/LF so nothing can smuggle extra headers in through the subject line.
  const subject = opts.subject.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const info = await transporter.sendMail({
    from: settings.from || settings.user,
    to: opts.to,
    bcc: settings.bccSelf ? settings.from || settings.user : undefined,
    subject,
    text: opts.text,
    attachments: [{ filename: opts.attachment.filename, content: opts.attachment.content, contentType: 'application/pdf' }],
  });
  return info.messageId as string;
}

import nodemailer from 'nodemailer';
import { AppError } from '../errors.ts';
import { getSecret } from '../security/vault.ts';
import { smtpSettings } from '../services/mailer.ts';
import { offline } from './telegram.ts';

/**
 * The digest by email, over the SMTP account already set up for applications.
 * Sends only to the owner (the configured digest address or the account's own
 * address), never to anyone else. Swappable for tests; refuses in offline mode.
 */

export interface DigestMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type MailSender = (mail: DigestMail) => Promise<string>;

const realSender: MailSender = async (mail) => {
  if (offline()) throw new AppError(503, 'OFFLINE', 'Email is disabled in offline mode.');
  const s = smtpSettings();
  const pass = getSecret('smtp_password');
  if (!s || !s.host || !pass) throw new AppError(412, 'NO_SMTP', 'Connect an email account in Settings → Email first.');
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass },
    requireTLS: !s.secure,
    tls: { minVersion: 'TLSv1.2' },
  });
  const info = await transporter.sendMail({
    from: s.from || s.user,
    to: mail.to,
    subject: mail.subject.replace(/[\r\n]+/g, ' ').slice(0, 200),
    text: mail.text,
    html: mail.html,
  });
  return String(info.messageId);
};

let sender: MailSender = realSender;

export function setMailSender(fake: MailSender | null): () => void {
  const prev = sender;
  sender = fake ?? realSender;
  return () => {
    sender = prev;
  };
}

/** The owner's own address: the configured digest recipient, else the SMTP account. */
export function ownerAddress(configured: string): string | null {
  if (configured) return configured;
  const s = smtpSettings();
  return s ? s.from || s.user || null : null;
}

export async function sendDigestMail(mail: DigestMail): Promise<string> {
  return sender(mail);
}

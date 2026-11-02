import crypto from 'node:crypto';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { decodeEntities, htmlToText } from '../security/sanitize.ts';

/**
 * Raw RFC 822 → the few fields the inbox needs. Everything here is untrusted
 * third-party data: it is parsed, never executed, and attachments are ignored
 * (mailparser decodes them into memory; we drop them unread).
 */

export interface ParsedEmail {
  /** Normalised Message-ID with angle brackets, or a content hash when the header is missing. */
  messageId: string;
  inReplyTo: string[];
  references: string[];
  from: { address: string; name: string; domain: string };
  replyTo: string | null;
  subject: string;
  receivedAt: string;
  /** Plain-text body (HTML converted), capped. */
  text: string;
  /** Every distinct http(s) link in the body, in order of appearance. */
  links: string[];
  autoReply: boolean;
  bulk: boolean;
}

const MAX_TEXT = 40_000;
const MAX_LINKS = 60;

function ids(v: string | string[] | undefined): string[] {
  const list = Array.isArray(v) ? v : v ? v.split(/\s+/) : [];
  return list.map(normId).filter(Boolean);
}

export function normId(id: string): string {
  const t = id.trim();
  if (!t) return '';
  return t.startsWith('<') ? t : `<${t}>`;
}

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } | null {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  if (!v?.address) return null;
  return { address: v.address.toLowerCase(), name: (v.name ?? '').trim() };
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).toLowerCase().replace(/\.$/, '') : '';
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;

/** Links from both the HTML anchors and the visible text, de-duplicated, trailing punctuation trimmed. */
export function extractLinks(text: string, html: string | null): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const u = decodeEntities(raw).trim().replace(/[.,;:!?]+$/, '');
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      if (!out.includes(parsed.href) && out.length < MAX_LINKS) out.push(parsed.href);
    } catch {
      /* not a URL */
    }
  };
  if (html) for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(URL_RE)) add(m[0]);
  return out;
}

function header(mail: ParsedMail, name: string): string | null {
  const v = mail.headers.get(name);
  if (v == null) return null;
  return typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value) : String(v);
}

export async function parseEmail(raw: Buffer | string, fallbackDate?: Date | null): Promise<ParsedEmail> {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const html = typeof mail.html === 'string' ? mail.html : null;
  const text = (mail.text?.trim() ? mail.text : html ? htmlToText(html) : '').replace(/\r\n/g, '\n').slice(0, MAX_TEXT);
  const from = firstAddress(mail.from) ?? { address: 'unknown@invalid', name: '' };
  const replyTo = firstAddress(mail.replyTo)?.address ?? null;
  const date = mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date : (fallbackDate ?? new Date());
  const messageId =
    normId(mail.messageId ?? '') || `<sha256-${crypto.createHash('sha256').update(typeof raw === 'string' ? raw : raw).digest('hex').slice(0, 32)}@bureau.local>`;
  const autoSubmitted = (header(mail, 'auto-submitted') ?? '').toLowerCase();
  const precedence = (header(mail, 'precedence') ?? '').toLowerCase();
  const subject = (mail.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    messageId,
    inReplyTo: ids(mail.inReplyTo),
    references: ids(mail.references),
    from: { ...from, domain: domainOf(from.address) },
    replyTo,
    subject,
    receivedAt: date.toISOString(),
    text,
    links: extractLinks(text, html),
    autoReply:
      (!!autoSubmitted && autoSubmitted !== 'no') ||
      mail.headers.has('x-autoreply') ||
      mail.headers.has('x-autorespond') ||
      /^(automatic reply|auto(-|\s)?reply|out of (the )?office)\b/i.test(subject),
    bulk: mail.headers.has('list') || mail.headers.has('list-unsubscribe') || mail.headers.has('list-id') || precedence === 'bulk' || precedence === 'list',
  };
}

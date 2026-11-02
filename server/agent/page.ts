import type { Frame } from 'playwright-core';

/**
 * The browser agent's in-page helper (plain JavaScript source, like A05's
 * PAGE_LIB, so no build step can inject helpers the page lacks). Called as
 * `(AGENT_LIB)(op, arg)` in a frame.
 *
 * Ops:
 *  - snapshot  a compact accessibility view of the page: headings, every visible
 *              clickable control (stamped `data-bureau-agent="k<n>"`, stable across
 *              calls in one document) with its role, name, href and selector
 *              candidates, and the visible text.
 *  - scan      all text a page could use to talk to an AI, hidden or not: body text
 *              (including display:none and off-screen blocks), placeholders,
 *              aria-labels, titles, option labels and HTML comments. Used only to
 *              detect and log prompt-injection attempts, never sent to Claude.
 *  - find      the first visible clickable matching one of the selector
 *              candidates (CSS, or `text=<role>|<name>`): its ref, or null.
 */
export const AGENT_LIB = String.raw`(op, arg) => {
  const W = window;
  const S = W.__bureauAgent || (W.__bureauAgent = { seq: 0 });
  const norm = (s) => String(s == null ? '' : s).replace(/[ \s]+/g, ' ').trim();
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    const x = r.left + W.scrollX, y = r.top + W.scrollY;
    if (x + r.width < -50 || y + r.height < -50) return false;
    return true;
  }
  const CLICK_SEL = 'button, [role="button"], a[href], input[type="submit"], input[type="button"], [role="tab"], [role="link"], summary, [aria-expanded]';
  function roleOf(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName;
    if (t === 'A') return 'link';
    if (t === 'BUTTON' || t === 'SUMMARY' || (t === 'INPUT' && /^(submit|button)$/i.test(el.type))) return 'button';
    return 'button';
  }
  function nameOf(el) {
    const t = el.tagName === 'INPUT' ? el.value : (el.innerText || el.textContent);
    return norm(t) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('title'));
  }
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  function selectorsOf(el, role, name) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\d{5,}|^[0-9]|[:\s]/.test(el.id)) {
      try { if (document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) out.push('#' + CSS.escape(el.id)); } catch (e) {}
    }
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-automation-id']) {
      const v = el.getAttribute(a);
      if (v) out.push(tag + '[' + a + '="' + esc(v) + '"]');
    }
    const al = el.getAttribute('aria-label');
    if (al) out.push(tag + '[aria-label="' + esc(al) + '"]');
    const nm = el.getAttribute('name');
    if (nm) out.push(tag + '[name="' + esc(nm) + '"]');
    if (name) out.push('text=' + role + '|' + name);
    return out.slice(0, 6);
  }
  function clickables() {
    const out = [];
    for (const el of Array.from(document.querySelectorAll(CLICK_SEL))) {
      if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      if (el.closest('[role="listbox"], [role="menu"]')) continue;
      const name = nameOf(el).slice(0, 90);
      if (!name) continue;
      let ref = el.getAttribute('data-bureau-agent');
      if (!ref) { ref = 'k' + (++S.seq); el.setAttribute('data-bureau-agent', ref); }
      const role = roleOf(el);
      out.push({
        ref, role, name,
        tag: el.tagName.toLowerCase(),
        type: (el.getAttribute('type') || '').toLowerCase(),
        href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '',
        absHref: el.tagName === 'A' && el.href ? String(el.href) : '',
        inForm: !!el.closest('form'),
        expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') : '',
        selectors: selectorsOf(el, role, name),
      });
      if (out.length >= 80) break;
    }
    return out;
  }
  if (op === 'snapshot') {
    const heads = Array.from(document.querySelectorAll('h1, h2, h3, h4, legend, [role="heading"]')).filter(visible).map((h) => norm(h.textContent).slice(0, 120)).filter(Boolean).slice(0, 30);
    const text = norm(document.body ? document.body.innerText : '').slice(0, arg.maxText || 3500);
    return { title: norm(document.title).slice(0, 160), url: location.href, headings: heads, clickables: clickables(), text };
  }
  if (op === 'scan') {
    const parts = [];
    if (document.body) {
      parts.push({ where: 'text', text: norm(document.body.textContent).slice(0, 20000) });
      for (const el of Array.from(document.querySelectorAll('[placeholder], [aria-label], [title], [alt], option'))) {
        for (const a of ['placeholder', 'aria-label', 'title', 'alt']) { const v = el.getAttribute(a); if (v && v.length > 12) parts.push({ where: a, text: norm(v).slice(0, 400) }); }
        if (el.tagName === 'OPTION' && norm(el.textContent).length > 12) parts.push({ where: 'option', text: norm(el.textContent).slice(0, 400) });
      }
      const tw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT);
      for (let n = tw.nextNode(), k = 0; n && k < 50; n = tw.nextNode(), k++) { const v = norm(n.nodeValue); if (v.length > 12) parts.push({ where: 'comment', text: v.slice(0, 1000) }); }
    }
    return parts;
  }
  if (op === 'find') {
    const list = clickables();
    for (const s of arg.selectors || []) {
      if (s.indexOf('text=') === 0) {
        const want = s.slice(5);
        const bar = want.indexOf('|');
        const role = want.slice(0, bar), name = want.slice(bar + 1);
        const hit = list.find((c) => c.role === role && c.name === name) || list.find((c) => c.name === name);
        if (hit) return hit.ref;
        continue;
      }
      let els = [];
      try { els = Array.from(document.querySelectorAll(s)); } catch (e) { els = []; }
      const el = els.find(visible);
      if (el) {
        const ref = el.getAttribute('data-bureau-agent');
        if (ref) return ref;
      }
    }
    return null;
  }
  return null;
}`;

export interface Clickable {
  ref: string;
  role: string;
  name: string;
  tag: string;
  type: string;
  href: string;
  absHref: string;
  inForm: boolean;
  expanded: string;
  selectors: string[];
}

export interface Snapshot {
  title: string;
  url: string;
  headings: string[];
  clickables: Clickable[];
  text: string;
}

export async function agentOp<T>(frame: Frame, op: string, arg: unknown = {}): Promise<T> {
  return (await frame.evaluate(`(${AGENT_LIB})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`)) as T;
}

import type { Frame, Page } from 'playwright-core';

/**
 * The in-page half of the form engine. It runs inside every frame as plain
 * JavaScript source (never a transpiled function, so no build tool can inject
 * helpers that do not exist in the page) and is called as
 * `(PAGE_LIB)(op, arg)`.
 *
 * Ops:
 *  - extract   every fillable control in the document, piercing open shadow
 *              roots: kind, label, required, options, section, repeating group,
 *              EEO flag, stable selectors; plus "Add another" buttons, wizard
 *              navigation buttons and apply links. Controls are stamped with
 *              `data-bureau-id` (stable across re-extracts of the same document).
 *  - read      the current value of stamped fields (and filename chips, errors).
 *  - options   the visible options of an open listbox / suggestion menu.
 *  - errors    visible validation messages and aria-invalid controls.
 *  - challenge a visible CAPTCHA or bot wall (never solved, only reported).
 *  - confirm   confirmation text / selectors after submit.
 *  - fingerprint a cheap description of the current step (to see a step change).
 *  - blur      blur a stamped element (commit typed values).
 */
export const PAGE_LIB = String.raw`(op, arg) => {
  const W = window;
  const S = W.__bureauState || (W.__bureauState = { seq: {} });
  const norm = (s) => String(s == null ? '' : s).replace(/[ \s]+/g, ' ').trim();
  const GENERIC = /^(attach|attach file|upload|upload file|choose( a)? files?|browse|select|select\.\.\.|select one|enter manually|or|drop files? here|drag (and|&) drop.*|paste|\+|add|remove|delete|clear|required|optional|\*|locate me|no file chosen)$/i;
  const CONTROL_SEL = 'input:not([type=hidden]),select,textarea,[role=combobox],[role=radio],[role=checkbox],[role=textbox],[role=spinbutton],[contenteditable=""],[contenteditable=true]';

  function collect(root, out) {
    const els = root.querySelectorAll('*');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      out.push(el);
      if (el.shadowRoot) collect(el.shadowRoot, out);
    }
    return out;
  }
  let ALL = null;
  const all = () => ALL || (ALL = collect(document, []));
  function deepAll(sel) {
    const res = [];
    const roots = [document];
    for (const el of all()) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const r of roots) { const found = r.querySelectorAll(sel); for (let i = 0; i < found.length; i++) res.push(found[i]); }
    return res;
  }
  function byStamp(attr, id) { return deepAll('[' + attr + '="' + String(id).replace(/"/g, '\\"') + '"]'); }
  const parentOf = (n) => n.parentElement || (n.getRootNode && n.getRootNode() !== document && n.getRootNode().host) || null;
  const rootOf = (el) => (el.getRootNode ? el.getRootNode() : document);

  function ownText(el) {
    if (!el) return '';
    let out = '';
    const walk = (n) => {
      const kids = n.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          const t = c.tagName;
          if (t === 'SELECT' || t === 'OPTION' || t === 'TEXTAREA' || t === 'INPUT' || t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT' || t === 'svg') continue;
          const r = c.getAttribute('role');
          if (r === 'listbox' || r === 'option' || r === 'tooltip' || r === 'combobox') continue;
          if (t === 'BUTTON' && c.getAttribute('aria-haspopup')) continue;
          if (c.hasAttribute('data-bureau-skiptext')) continue;
          if (c.getClientRects().length === 0 && getComputedStyle(c).display === 'none') continue;
          walk(c);
          out += ' ';
        }
      }
    };
    walk(el);
    return norm(out);
  }
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
  const precedes = (a, b) => !!(a.compareDocumentPosition(b) & 4);
  const hasControl = (c) => !!c.querySelector(CONTROL_SEL);
  function controlCount(node) { return node.querySelectorAll(CONTROL_SEL).length; }
  function byIds(el, ids) {
    const root = rootOf(el);
    return ids.split(/\s+/).map((i) => {
      const t = (root.getElementById ? root.getElementById(i) : null) || document.getElementById(i);
      return t ? ownText(t) || norm(t.textContent) : '';
    }).filter(Boolean).join(' ');
  }
  function humanName(n) {
    return norm(String(n || '').replace(/^.*[\[\.]/, '').replace(/[\]_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  }
  const LABELISH = 'label, legend, [class*="label" i], [data-automation-id*="formLabel"], [data-automation-id*="Label"], [id$="-label"], [id$="_label"], [class*="question" i], [class*="prompt" i], h3, h4, h5, [role="heading"]';
  function questionLabel(el, shared) {
    let node = parentOf(el);
    for (let i = 0; node && i < 6 && node !== document.body; i++) {
      const caps = Array.from(node.querySelectorAll(LABELISH)).filter((c) => {
        if (c.contains(el) || !precedes(c, el) || hasControl(c)) return false;
        if (c.tagName === 'LABEL' && c.htmlFor) { const tgt = rootOf(c).getElementById ? rootOf(c).getElementById(c.htmlFor) : null; if (tgt && tgt !== el) return false; }
        return true;
      });
      for (let k = caps.length - 1; k >= 0; k--) {
        const t = ownText(caps[k]);
        if (t && !GENERIC.test(t) && t.length < 600) { if (shared) shared.v = controlCount(node) > 1; return t; }
      }
      if (node.tagName === 'FORM') break;
      node = parentOf(node);
    }
    return '';
  }
  /** The menu a menu button opens, when its items are choices (menuitemcheckbox / menuitemradio), else null. */
  function choiceMenu(el) {
    const pop = el.getAttribute('aria-haspopup');
    if (pop !== 'menu' && pop !== 'true') return null;
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const menu = ctl && rootOf(el).getElementById ? rootOf(el).getElementById(ctl) : null;
    return menu && menu.querySelector('[role="menuitemcheckbox"], [role="menuitemradio"]') ? menu : null;
  }
  /**
   * The visible drop zone a detached file input serves (Dropzone.js appends one hidden input per zone to <body>,
   * in zone order). Null for inputs that sit inside their form or zone.
   */
  function detachedZone(el) {
    if (el.parentElement !== document.body) return null;
    const ZONE = '.dropzone, .dz-clickable, [class*="upload-trigger" i], [data-controller*="upload" i] [role="button"], [role="button"][aria-label*="upload" i], [class*="dropzone" i]:not(input)';
    const found = deepAll(ZONE);
    // Visible or not: a zone hides itself once its file is attached, and the label must not change then.
    const zones = found.filter((z) => z.tagName !== 'INPUT' && !z.querySelector('input[type=file]') && !found.some((o) => o !== z && o.contains(z)));
    if (!zones.length) return null;
    const detached = Array.from(document.body.children).filter((c) => c.tagName === 'INPUT' && c.type === 'file');
    return zones[Math.max(0, detached.indexOf(el))] || zones[0];
  }
  /** A placeholder that names the field ("Company", "Field of Study"), not an example value or an instruction. */
  function placeholderName(el) {
    const ph = norm(el.getAttribute('placeholder'));
    if (!ph || ph.length > 40 || GENERIC.test(ph) || /^(e\.?g\.?|ex(ample)?[:.]|type|enter|start typing|search)\b/i.test(ph) || /[@\d\/]|\.\.\.|…/.test(ph)) return '';
    return ph;
  }
  function labelOf(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = byIds(el, by); if (t && !GENERIC.test(t)) return t; }
    if (el.labels && el.labels.length) {
      for (const l of Array.from(el.labels)) { const t = ownText(l); if (t && !GENERIC.test(t)) return t; }
    }
    const wrap = el.closest('label');
    if (wrap) { const t = ownText(wrap); if (t && !GENERIC.test(t)) return t; }
    const aria = norm(el.getAttribute('aria-label'));
    if (aria && !GENERIC.test(aria)) return aria;
    const shared = { v: false };
    const q = questionLabel(el, shared);
    // A caption over several controls (a section heading above an entry's inputs) names the section, not this
    // input: the input's own placeholder is the better name when it has one.
    if (q && shared.v && placeholderName(el)) return placeholderName(el);
    if (q) return q;
    return norm(el.getAttribute('placeholder')) || norm(el.getAttribute('title')) || humanName(el.getAttribute('name') || el.id || '');
  }
  function groupLabel(first, container) {
    const g = container || first.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (g && container) {
      const cap = container.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > legend, :scope > p, :scope > [class*="question" i], :scope > [class*="label" i]:not(label)');
      if (cap && !cap.contains(first) && !hasControl(cap)) { const t = ownText(cap); if (t) return t; }
    }
    if (g) {
      const by = g.getAttribute('aria-labelledby');
      if (by) { const t = byIds(g, by); if (t) return t; }
      const lg = g.querySelector(':scope > legend') || (g.tagName === 'FIELDSET' ? g.querySelector('legend') : null);
      if (lg && ownText(lg)) return ownText(lg);
      const al = norm(g.getAttribute('aria-label'));
      if (al) return al;
    }
    return questionLabel(g || first) || questionLabel(first) || humanName(first.getAttribute('name') || '');
  }
  function optionLabel(el) {
    if (el.labels && el.labels.length) { const t = ownText(el.labels[0]); if (t) return t; }
    const wrap = el.closest('label');
    if (wrap) { const t = ownText(wrap); if (t) return t; }
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = byIds(el, by); if (t) return t; }
    const aria = norm(el.getAttribute('aria-label'));
    if (aria) return aria;
    // Web components carry their label as an attribute or inside their shadow root.
    const attr = norm(el.getAttribute('label'));
    if (attr) return attr;
    if (el.tagName !== 'INPUT') { const t = norm(el.innerText || el.textContent); if (t) return t; }
    if (el.shadowRoot) { const t = ownText(el.shadowRoot.querySelector('label, [class*="label" i]') || el.shadowRoot.host); if (t) return t; }
    const next = el.nextElementSibling;
    if (next && !hasControl(next)) { const t = ownText(next); if (t) return t; }
    return norm(el.value);
  }
  function requiredMark(label) { return /[*✱]\s*\)?\s*$|^\s*[*✱]|\(required\)|\brequired\s*\.?\s*$|^\s*required\b/i.test(label); }
  function containerRequired(el) {
    let n = parentOf(el);
    for (let i = 0; n && i < 3; i++, n = parentOf(n)) {
      const cls = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '');
      if (/(^|[\s_-])required($|[\s_-])/i.test(cls) && !/not-required|optional/i.test(cls)) return true;
      if (n.getAttribute && (n.getAttribute('aria-required') === 'true' || n.getAttribute('data-required') === 'true')) return true;
    }
    return false;
  }
  function cleanLabel(t) {
    return norm(String(t || '').replace(/\(required\)|\(optional\)/gi, ' ').replace(/\s*[*✱]+\s*/g, ' ').replace(/\s+required\s*\.?\s*$/i, '').replace(/^\s*required\s*[.:]\s*/i, '').replace(/\s*[–—-]*\s*(select( one)?|please select|choose)\s*(\.\.\.|…|[–—-]*)\s*[▾▼⌄▿]?\s*$/i, '').replace(/\s*[▾▼⌄▿]\s*$/, ''));
  }
  const HEAD_DIRECT = ':scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > [role="heading"], :scope > header h2, :scope > header h3, :scope > div > h2, :scope > div > h3, :scope > div > legend, :scope > [data-automation-id*="sectionHeader" i], :scope > [class*="section-title" i], :scope > [class*="sectionTitle"], :scope > [class*="section-header" i] h2, :scope > [class*="section-header" i] h3';
  function sectionOf(el, label) {
    let node = parentOf(el);
    for (let i = 0; node && i < 16 && node !== document.body; i++) {
      const tag = node.tagName;
      const cls = String(node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className || '');
      const da = node.getAttribute('data-automation-id') || '';
      const role = node.getAttribute('role');
      if (tag === 'FIELDSET' || tag === 'SECTION' || role === 'group' || role === 'region' || /section|panel|step/i.test(cls) || /section/i.test(da)) {
        if (controlCount(node) >= 2) {
          const h = node.querySelector(HEAD_DIRECT);
          if (h) { const t = ownText(h); if (t && t !== label && t.length < 120 && !hasControl(h)) return t; }
        }
      }
      if (tag === 'FORM') break;
      node = parentOf(node);
    }
    const scope = el.closest('form') || document.body;
    const hs = Array.from(scope.querySelectorAll('h2, h3')).filter((h) => precedes(h, el) && !hasControl(h));
    for (let k = hs.length - 1; k >= 0; k--) {
      const t = ownText(hs[k]);
      if (t && t !== label && t.length < 120) return t;
    }
    return '';
  }
  function attrsOf(n) {
    const cls = String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || '');
    return (n.id || '') + ' ' + (n.getAttribute('data-automation-id') || '') + ' ' + cls + ' ' + (n.getAttribute('data-section') || '');
  }
  const shapeKey = (n) => n.tagName + '|' + attrsOf(n).replace(/\d+/g, '#');
  function groupKind(t) {
    if (/educat|school|universit|degree|college|academ/i.test(t)) return 'education';
    if (/experience|employ|work|position|job|career|history/i.test(t)) return 'work';
    if (/language/i.test(t)) return 'language';
    if (/reference/i.test(t)) return 'reference';
    return 'other';
  }
  /** What a repeating block is about, from its attributes and the words in it (labels say "School", "Company"). */
  /** A block's words: its text plus its controls' placeholders and aria-labels (entries that label inputs only by placeholder). */
  function blockText(n) {
    const names = Array.from(n.querySelectorAll(CONTROL_SEL)).map((c) => (c.getAttribute('placeholder') || '') + ' ' + (c.getAttribute('aria-label') || '')).join(' ');
    return norm(n.textContent + ' ' + names);
  }
  function blockKind(n) {
    // The list that holds the entries names the collection ("ul#education" of "li.experience" items).
    const p = parentOf(n);
    const pa = p ? attrsOf(p) : '';
    if (p && p.children && p.children.length && /educat|school|experience|employ|work|position|history|language|reference/i.test(pa) && groupKind(pa) !== 'other') return groupKind(pa);
    const a = attrsOf(n);
    const byAttr = groupKind(a);
    if (byAttr !== 'other' && /educat|school|experience|employ|work|position|history|language|reference/i.test(a)) return byAttr;
    const t = blockText(n).slice(0, 400).toLowerCase();
    if (/\b(school|university|degree|field of study|major|institution|college)\b/.test(t)) return 'education';
    if (/\b(company|employer|job title|title|position|currently work)\b/.test(t)) return 'work';
    return groupKind(a + ' ' + sectionOf(n, ''));
  }
  function groupOf(el, label) {
    let node = parentOf(el);
    for (let i = 0; node && i < 9 && node !== document.body; i++) {
      const p = parentOf(node);
      if (!p || !p.children) break;
      const key = shapeKey(node);
      const attr = attrsOf(node);
      const named = /(experience|education|employment|school|position|language|reference)s?[-_ ]?(item|entry|section|group|panel|row)?[-_ ]?\d+\b/i.test(attr);
      if (named && controlCount(node) >= 2) {
        const kind = blockKind(node);
        const sibs = Array.from(p.children).filter((s) => shapeKey(s) === key && s.querySelector(CONTROL_SEL) && blockKind(s) === kind);
        return { index: Math.max(0, sibs.indexOf(node)), count: Math.max(1, sibs.length), name: kind };
      }
      const sibs = Array.from(p.children).filter((s) => shapeKey(s) === key && s.querySelector(CONTROL_SEL));
      // An entry of a list that names its collection ("ul#education > li"), even the first and only one.
      const pa = attrsOf(p);
      if (controlCount(node) >= 2 && (p.tagName === 'UL' || p.tagName === 'OL' || /(^|[\s_-])(list|entries|items)([\s_-]|$)/i.test(pa)) && /educat|school|experience|employ|work|position|history/i.test(pa)) {
        const kind = blockKind(node);
        if (kind === 'work' || kind === 'education') return { index: Math.max(0, sibs.indexOf(node)), count: Math.max(1, sibs.length), name: kind };
      }
      if (sibs.length >= 2 && label && controlCount(node) >= 2 && sibs.filter((s) => blockText(s).indexOf(label) >= 0).length >= 2) {
        const kind = blockKind(node);
        const same = sibs.filter((s) => blockKind(s) === kind);
        if (same.length >= 2) return { index: same.indexOf(node), count: same.length, name: kind };
      }
      if (node.tagName === 'FORM') break;
      node = p;
    }
    return null;
  }
  const RANDOMISH = /(\d{5,}|[0-9a-f]{8,}|react-select-\d+|^:r|mui-\d+|^input-\d+$|^ember\d+|^yui_|^ext-gen|^j_id|^ctl\d+|^headlessui)/i;
  const qa = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  function selectorsFor(el, label) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const da = el.getAttribute('data-automation-id');
    if (da && !RANDOMISH.test(da)) out.push('[data-automation-id="' + qa(da) + '"]');
    for (const a of ['data-qa', 'data-testid', 'data-test', 'data-ui', 'data-field', 'data-input']) {
      const v = el.getAttribute(a);
      if (v && !RANDOMISH.test(v)) out.push('[' + a + '="' + qa(v) + '"]');
    }
    if (el.id && !RANDOMISH.test(el.id)) out.push('#' + (W.CSS && CSS.escape ? CSS.escape(el.id) : el.id));
    const nm = el.getAttribute('name');
    if (nm && !RANDOMISH.test(nm)) out.push(tag + '[name="' + qa(nm) + '"]');
    if (label && label.length < 90) out.push('label=' + label);
    return out;
  }
  const HONEY = /honey|hp_|leave (this )?(field )?(blank|empty)|do not (fill|complete)|bot[-_ ]?(field|trap|check)|url_confirm|website_confirm|_gotcha|fax_only|nospam/i;
  function honeypot(el, label) {
    const s = (el.name || '') + ' ' + (el.id || '') + ' ' + String(el.className || '') + ' ' + label;
    if (HONEY.test(s)) return true;
    if (el.getAttribute('tabindex') === '-1' && el.getAttribute('autocomplete') === 'off' && !label) return true;
    return false;
  }
  function stampField(el, prefix) {
    const cur = el.getAttribute('data-bureau-id');
    if (cur && cur.indexOf(prefix) === 0 && cur.indexOf(':') < 0) return cur;
    S.seq[prefix] = S.seq[prefix] || 0;
    const id = prefix + (S.seq[prefix]++);
    el.setAttribute('data-bureau-id', id);
    return id;
  }
  function stampGroup(members, prefix) {
    const first = members[0];
    let id = first.getAttribute('data-bureau-group');
    if (!id || id.indexOf(prefix) !== 0) {
      S.seq[prefix] = S.seq[prefix] || 0;
      id = prefix + (S.seq[prefix]++);
      first.setAttribute('data-bureau-group', id);
    }
    members.forEach((m, i) => m.setAttribute('data-bureau-id', id + ':' + i));
    return id;
  }
  function stampAttr(el, attr, prefix) {
    let id = el.getAttribute(attr);
    if (id) return id;
    S.seq[prefix] = S.seq[prefix] || 0;
    id = prefix + (S.seq[prefix]++);
    el.setAttribute(attr, id);
    return id;
  }
  const isPlaceholderOption = (o) => (o.value === '' && !!norm(o.text).match(/^(|select.*|choose.*|please select.*|--.*|-+|pick.*|none selected)$/i)) || /^(select|choose|please select|--)/i.test(norm(o.text));
  const COMBO_WRAP = '[class*="select__control"], [class*="select-control" i], .MuiAutocomplete-root, [data-automation-id="multiselectInputContainer"], [data-automation-id*="searchBox" i], [class*="combobox" i], [class*="autocomplete" i], [class*="typeahead" i]';
  const LOCATION_RE = /\b(location|city|town|where (are you|do you) (currently )?(based|live|located|reside)|current(ly)? (based|located|residing)|place of residence)\b/i;
  const DATE_PH = /^(mm|dd|yyyy|yy|m|d)([\/.\- ](mm|dd|yyyy|yy|m|d)){1,2}$/i;
  const CONSENT_RE = /\b(agree|consent|acknowledge|accept|privacy|terms|gdpr|data (protection|processing)|i (have )?read|certify|confirm that|attest|understand that)\b/i;
  const EEO_RE = /voluntary|self[- ]?identif|equal (employment )?opportunit|\beeo\b|\beeoc\b|demographic|diversity|veteran|disabilit|gender|\brace\b|ethnic|hispanic|latin[oax]|sexual orientation|transgender/i;

  const PHONE_PICKER = '.iti__selected-flag, .iti__selected-country, [class*="flag-dropdown" i], [class*="country-select" i] button, button[aria-label*="calling code" i], button[aria-label*="country code" i], [role=combobox][aria-label*="country code" i], [role=combobox][aria-label*="calling code" i], [aria-label*="region code" i], [class*="phone" i] > [role=combobox], [class*="phone" i] > button[aria-haspopup]';
  function nativeSelectFor(trigger) {
    const box = trigger.closest('.select2-container, .chosen-container, [id^="s2id_"], [id$="_chosen"]') || parentOf(trigger);
    if (!box) return null;
    let sel = null;
    if (box.id && /^s2id_/.test(box.id)) sel = (rootOf(box).getElementById ? rootOf(box).getElementById(box.id.slice(5)) : null);
    if (!sel && box.id && /_chosen$/.test(box.id)) sel = (rootOf(box).getElementById ? rootOf(box).getElementById(box.id.replace(/_chosen$/, '')) : null);
    if (!sel) {
      // The hidden <select> sits right next to the widget (before or after it).
      const near = [box.previousElementSibling, box.nextElementSibling].filter(Boolean);
      sel = near.find((c) => c.tagName === 'SELECT' && !visible(c)) || null;
    }
    return sel && sel.tagName === 'SELECT' && !visible(sel) ? sel : null;
  }
  function phonePicker(el) {
    let n = parentOf(el);
    for (let i = 0; n && i < 3; i++, n = parentOf(n)) {
      const texts = n.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea');
      if (texts.length > 2) break;
      const sel = Array.from(n.querySelectorAll('select')).find((s) => {
        const opts = Array.from(s.options).map((o) => o.text);
        const dial = opts.filter((t) => /\+\s?\d{1,4}/.test(t)).length;
        return dial >= Math.max(2, opts.length * 0.3) || (opts.length >= 20 && /country|code|dial/i.test((s.name || '') + ' ' + (s.id || '') + ' ' + (s.getAttribute('aria-label') || '')));
      });
      if (sel) {
        const own = labelOf(sel);
        if (!own || own === labelOf(el) || /code|country|dial|flag/i.test(own) && !(sel.labels && sel.labels.length)) return { el: sel, kind: 'select' };
      }
      const btn = n.querySelector(PHONE_PICKER + ', .iti__selected-flag, .iti__selected-country, [class*="flag-dropdown" i], [class*="country-select" i] button, button[aria-label*="country" i], [role=combobox][aria-label*="country" i], button[class*="country" i], button[aria-haspopup][class*="phone" i]');
      if (btn && btn !== el) return { el: btn, kind: 'button' };
    }
    return null;
  }
  function segPart(s) {
    const t = (s.getAttribute('aria-label') || '') + ' ' + (s.getAttribute('data-automation-id') || '') + ' ' + (s.getAttribute('placeholder') || '') + ' ' + (s.getAttribute('name') || '') + ' ' + (s.getAttribute('data-part') || '') + ' ' + (s.id || '');
    if (/month|\bmm\b|\bm\b/i.test(t)) return 'MM';
    if (/\bday\b|\bdd\b|dateSectionDay|\bd\b/i.test(t)) return 'DD';
    if (/year|yyyy|\byy\b/i.test(t)) return 'YYYY';
    return '';
  }

  function extract(prefix) {
    const out = [];
    const consumed = new Set();
    const list = all();
    for (const el of list) {
      if (consumed.has(el)) continue;
      const tag = el.tagName;
      const role = el.getAttribute('role');
      const native = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      const editable = !native && (el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'true') && !(el.parentElement && el.parentElement.isContentEditable);
      const trigger = !native && ((tag === 'BUTTON' || role === 'button' || role === 'combobox') && (el.getAttribute('aria-haspopup') === 'listbox' || choiceMenu(el)) || role === 'combobox');
      const custom = !native && (role === 'radio' || role === 'checkbox' || (role === 'textbox' && !el.querySelector('input,textarea')) || role === 'spinbutton' || editable || trigger);
      // Yes/No toggle buttons (Ashby and friends): a group of aria-pressed buttons is a radio question.
      if (!native && tag === 'BUTTON' && el.hasAttribute('aria-pressed') && parentOf(el)) {
        const members = Array.from(parentOf(el).children).filter((b) => b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed'));
        members.forEach((m) => consumed.add(m));
        if (members.length >= 2 && members.some(visible)) {
          const raw = groupLabel(members[0], null);
          const id = stampGroup(members, prefix);
          const label = cleanLabel(raw);
          out.push({ id, kind: 'radio', rawLabel: raw, label, required: requiredMark(raw) || containerRequired(members[0]), options: members.map(optionLabel), meta: { toggle: true }, el: parentOf(el), selectors: selectorsFor(parentOf(el), label) });
        }
        continue;
      }
      if (!native && !custom) continue;
      if (el.closest('[role="listbox"], [role="menu"], nav, header, footer, [data-bureau-ignore]')) continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const type = (el.getAttribute('type') || (tag === 'INPUT' ? 'text' : tag)).toLowerCase();
      if (tag === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset', 'password', 'search'].indexOf(type) >= 0) continue;
      if (el.closest('[aria-hidden="true"]') && type !== 'file') continue;

      // Date segments (MUI sections, Workday month/day/year boxes).
      const segAttr = el.getAttribute('data-automation-id') || '';
      if (role === 'spinbutton' || /^dateSection/.test(segAttr)) {
        const box = el.closest('[role="group"], [data-automation-id="dateInputWrapper"], [data-automation-id*="dateInput" i], [class*="date" i], fieldset') || parentOf(el);
        const segs = Array.from(box.querySelectorAll('[role="spinbutton"], [data-automation-id^="dateSection"]')).filter((s) => s.tagName !== 'DIV' || s.getAttribute('role') === 'spinbutton');
        const uniq = segs.filter((s, i) => segs.indexOf(s) === i);
        uniq.forEach((s) => consumed.add(s));
        if (!uniq.some(visible)) continue;
        const raw = groupLabel(uniq[0], box.matches('[role="group"], fieldset') ? box : null) || labelOf(uniq[0]);
        const id = stampGroup(uniq, prefix);
        const label = cleanLabel(raw);
        out.push({ id, kind: 'date', rawLabel: raw, label, required: uniq.some((s) => s.getAttribute('aria-required') === 'true' || s.required) || requiredMark(raw) || containerRequired(box), meta: { segments: uniq.map((s) => segPart(s)) }, el: box, selectors: selectorsFor(box, label) });
        continue;
      }

      if (type === 'radio' || role === 'radio') {
        let members;
        let container = null;
        if (type === 'radio') {
          const scope = el.form || rootOf(el);
          members = list.filter((r) => r.tagName === 'INPUT' && r.type === 'radio' && (el.name ? r.name === el.name && (r.form || rootOf(r)) === scope : r === el));
        } else {
          container = el.closest('[role="radiogroup"]') || parentOf(el);
          members = Array.from(container.querySelectorAll('[role="radio"]'));
        }
        members.forEach((m) => consumed.add(m));
        const shown = members.filter((m) => visible(m) || (m.labels && m.labels[0] && visible(m.labels[0])) || visible(parentOf(m)));
        if (!shown.length) continue;
        const raw = groupLabel(members[0], container);
        if (honeypot(el, raw)) continue;
        const id = stampGroup(members, prefix);
        const label = cleanLabel(raw);
        out.push({ id, kind: 'radio', rawLabel: raw, label, required: members.some((m) => m.required || m.getAttribute('aria-required') === 'true') || (container && container.getAttribute('aria-required') === 'true') || requiredMark(raw) || containerRequired(members[0]), options: members.map(optionLabel), el: container || members[0], selectors: selectorsFor(container || members[0], label).filter((s) => s.indexOf('#') !== 0) });
        continue;
      }

      if (type === 'checkbox' || role === 'checkbox') {
        const scope = el.form || rootOf(el);
        const box = el.closest('fieldset, [role="group"]');
        let members = [el];
        let groupBox = box;
        if (type === 'checkbox' && el.name && box) members = Array.from(box.querySelectorAll('input[type=checkbox]')).filter((c) => c.name === el.name && (c.form || rootOf(c)) === scope);
        else if (role === 'checkbox' && box) members = Array.from(box.querySelectorAll('[role="checkbox"]'));
        if (members.length < 2 && type === 'checkbox') {
          // "Pick all that apply" without a fieldset: short option labels under one question caption.
          let n = parentOf(el);
          for (let i = 0; n && i < 3; i++, n = parentOf(n)) {
            const boxes = Array.from(n.querySelectorAll('input[type=checkbox]'));
            if (boxes.length < 2) continue;
            if (boxes.length > 40 || n.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), select, textarea').length) break;
            const shortOpts = boxes.every((b) => { const t = optionLabel(b); return t && t.length <= 40; });
            const caption = n.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > legend, :scope > p, :scope > [class*="question" i], :scope > [class*="label" i]:not(label)');
            if (shortOpts && caption && !caption.contains(el)) { members = boxes; groupBox = n; }
            break;
          }
        }
        const shownOne = (m) => visible(m) || (m.labels && m.labels[0] && visible(m.labels[0])) || visible(parentOf(m));
        if (members.length >= 2) {
          members.forEach((m) => consumed.add(m));
          if (!members.some(shownOne)) continue;
          const raw = groupLabel(members[0], groupBox);
          const id = stampGroup(members, prefix);
          const label = cleanLabel(raw);
          const gb = groupBox || parentOf(members[0]);
          out.push({ id, kind: 'checkbox', rawLabel: raw, label, required: requiredMark(raw) || (gb && gb.getAttribute('aria-required') === 'true') || containerRequired(gb) || (gb && gb.getAttribute('data-required') === 'true'), options: members.map(optionLabel), meta: { multi: true }, el: gb, selectors: selectorsFor(gb, label) });
          continue;
        }
        consumed.add(el);
        if (!shownOne(el)) continue;
        let raw = optionLabel(el);
        if (!raw || raw === el.value || raw.length < 3) raw = labelOf(el) || raw;
        if (honeypot(el, raw)) continue;
        const id = stampField(el, prefix);
        const label = cleanLabel(raw);
        const q = questionLabel(el);
        out.push({ id, kind: CONSENT_RE.test(raw) ? 'consent' : 'checkbox', rawLabel: raw, label, required: el.required || el.getAttribute('aria-required') === 'true' || requiredMark(raw) || containerRequired(el), meta: { question: q && q !== raw ? cleanLabel(q) : '' }, el, selectors: selectorsFor(el, label) });
        continue;
      }

      if (type === 'file') {
        consumed.add(el);
        let raw = labelOf(el) || '';
        // Drop zones label themselves "Upload a file…" or with the accept list: find what the upload is for.
        if (!raw || /^\s*\.\w+\s*,/.test(raw) || /^(upload|choose|drop|drag|attach|browse|select)\b/i.test(raw)) {
          // Dropzone.js puts its hidden input at the end of <body>, far from the zone it serves: read the zone's context.
          const zone = detachedZone(el);
          let n = zone || parentOf(el);
          for (let i = 0; n && i < 5 && n !== document.body && n !== document.documentElement; i++, n = parentOf(n)) {
            const t = ownText(n);
            const m = t.match(/(resume\s*\/\s*cv|curriculum vitae|resume|\bcv\b|cover letter|motivation letter|anschreiben|lebenslauf|portfolio|transcript|photo)/i);
            if (m) { raw = m[1] + (/[*✱]/.test(t.slice(0, 60)) ? ' *' : ''); break; }
            if (controlCount(n) > 3) break;
          }
        }
        raw = raw || el.getAttribute('accept') || 'file';
        const hintEl = el.closest('[data-for], [data-field-path], [data-ui], [data-test], [data-automation-id]');
        const hint = [el.name, el.id, el.getAttribute('aria-label'), hintEl && (hintEl.getAttribute('data-for') || hintEl.getAttribute('data-field-path') || hintEl.getAttribute('data-ui') || hintEl.getAttribute('data-test') || hintEl.getAttribute('data-automation-id'))].filter(Boolean).join(' ');
        const id = stampField(el, prefix);
        const label = cleanLabel(raw);
        out.push({ id, kind: 'file', rawLabel: raw, label, required: el.required || el.getAttribute('aria-required') === 'true' || requiredMark(raw) || containerRequired(el), meta: { accept: el.getAttribute('accept') || '', multiple: !!el.multiple, hint }, el, selectors: selectorsFor(el, label) });
        continue;
      }

      // A phone input's country button is folded into the phone field, not a question of its own.
      if (trigger && el.matches(PHONE_PICKER)) continue;
      consumed.add(el);
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 && r.height <= 2) continue;
      if (el.readOnly && !(el.getAttribute('aria-haspopup') || role === 'combobox' || /date|picker|calendar/i.test(String(el.className) + ' ' + (el.getAttribute('data-automation-id') || '')))) continue;
      // Select2 / Chosen style widgets: a visible trigger over a hidden native <select>.
      const nat = trigger ? nativeSelectFor(el) : null;
      if (nat) consumed.add(nat);
      let raw = nat ? labelOf(nat) : trigger || editable || role === 'textbox' ? (labelOf(el) || questionLabel(el)) : labelOf(el);
      if (nat && (!raw || GENERIC.test(raw))) raw = labelOf(el) || questionLabel(el);
      if (honeypot(el, raw)) continue;
      if (trigger && !raw) continue;
      const label = cleanLabel(raw);
      const required = !!el.required || el.getAttribute('aria-required') === 'true' || requiredMark(raw) || containerRequired(el) || (!!nat && (nat.required || nat.getAttribute("aria-required") === "true"));
      let kind = 'text';
      const meta = {};
      if (nat) {
        const id = stampField(el, prefix);
        nat.setAttribute("data-bureau-native", id);
        const opts = Array.from(nat.options).filter((o) => !isPlaceholderOption(o) && !o.disabled).map((o) => norm(o.text)).filter(Boolean);
        out.push({ id, kind: 'combobox', rawLabel: raw, label, required, options: opts, meta: { trigger: 'button', native: true }, el, selectors: selectorsFor(nat, label) });
        continue;
      }
      if (tag === 'SELECT') {
        kind = 'select';
        const opts = Array.from(el.options).filter((o) => !isPlaceholderOption(o) && !o.disabled).map((o) => norm(o.text)).filter(Boolean);
        const id = stampField(el, prefix);
        out.push({ id, kind, rawLabel: raw, label, required, options: opts, meta: { multiple: !!el.multiple }, el, selectors: selectorsFor(el, label) });
        continue;
      }
      if (trigger) {
        kind = 'combobox';
        meta.trigger = 'button';
        // A menu button over menuitemcheckbox items (Teamtailor's multiple choice) picks several.
        const menu = choiceMenu(el);
        if (menu) {
          if (menu.querySelector('[role="menuitemcheckbox"]')) meta.multi = true;
          meta.options = Array.from(menu.querySelectorAll('[role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]')).map((o) => norm(o.getAttribute('data-search-text') || o.textContent).replace(/^✓\s*/, '')).filter(Boolean);
        }
      } else if (tag === 'TEXTAREA') {
        kind = 'textarea';
        if (el.maxLength > 0) meta.maxLength = el.maxLength;
      } else if (editable || role === 'textbox') {
        kind = 'richtext';
      } else if (type === 'date' || type === 'month' || type === 'datetime-local') {
        kind = 'date';
        meta.format = type === 'month' ? 'iso-month' : 'iso';
      } else {
        const ph = norm(el.getAttribute('placeholder'));
        const hint = String(el.className) + ' ' + (el.getAttribute('data-automation-id') || '') + ' ' + (el.getAttribute('aria-haspopup') || '') + ' ' + (el.name || '') + ' ' + (el.id || '');
        const comboish = role === 'combobox' || /^(list|both)$/.test(el.getAttribute('aria-autocomplete') || '') || el.getAttribute('aria-haspopup') === 'listbox' || !!el.getAttribute('list') || /select__input|react-select|autocomplete|typeahead/i.test(hint) || !!el.closest(COMBO_WRAP);
        const dialogDate = el.getAttribute('aria-haspopup') === 'dialog' && /date|birth|start|end|from|graduat|available|availability/i.test(raw);
        if (DATE_PH.test(ph) || dialogDate || (/date|picker|calendar/i.test(hint) && /date|birth|start|end|from|to|graduat|available/i.test(raw))) {
          kind = 'date';
          meta.format = DATE_PH.test(ph) ? ph.toUpperCase().replace(/^M([\/.\- ])/, 'MM$1').replace(/([\/.\- ])D([\/.\- ])/, '$1DD$2') : 'MM/DD/YYYY';
        } else if (type === 'tel' || (/\b(phone|mobile|telephone|cell)\b/i.test(raw) && !comboish && !/code|extension|type|device/i.test(raw))) {
          const picker = phonePicker(el);
          kind = picker ? 'phone' : 'tel';
          if (picker) {
            consumed.add(picker.el);
            meta.cc = picker.kind;
            const fid = stampField(el, prefix);
            picker.el.setAttribute('data-bureau-cc', fid);
            out.push({ id: fid, kind, rawLabel: raw, label, required, meta, el, selectors: selectorsFor(el, label) });
            continue;
          }
        } else if (comboish) {
          kind = LOCATION_RE.test(raw) ? 'location' : 'combobox';
          if (el.getAttribute('list')) {
            const dl = rootOf(el).getElementById ? rootOf(el).getElementById(el.getAttribute('list')) : null;
            if (dl) meta.options = Array.from(dl.querySelectorAll('option')).map((o) => norm(o.value || o.text)).filter(Boolean);
          }
          meta.multi = !!el.closest('[class*="multi" i]') || el.getAttribute('aria-multiselectable') === 'true';
        } else if (type === 'email' || type === 'url' || type === 'number') {
          kind = type;
        } else if (LOCATION_RE.test(raw) && el.getAttribute('autocomplete') !== 'address-level2') {
          kind = 'text';
        }
      }
      const id = stampField(el, prefix);
      let options;
      if (kind === 'combobox') {
        const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
        const lb = ctl ? (rootOf(el).getElementById ? rootOf(el).getElementById(ctl) : null) : null;
        if (lb) options = Array.from(lb.querySelectorAll('[role="option"]')).map((o) => norm(o.textContent)).filter(Boolean);
        if ((!options || !options.length) && meta.options) options = meta.options;
        if (options && !options.length) options = undefined;
      }
      out.push({ id, kind, rawLabel: raw, label, required, options, meta, el, selectors: selectorsFor(el, label) });
    }

    const fields = out.map((f, i) => {
      const section = sectionOf(f.el, f.rawLabel);
      const group = groupOf(f.el, f.rawLabel);
      const ctx = section + ' ' + f.label;
      const meta = Object.assign({}, f.meta || {});
      if (EEO_RE.test(ctx)) meta.eeo = true;
      if (group) meta.group = group;
      if (f.el.closest && f.el.closest('[aria-hidden="true"]')) meta.hiddenInput = true;
      const rect = f.el.getBoundingClientRect ? f.el.getBoundingClientRect() : { top: 0 };
      return { id: f.id, kind: f.kind, label: f.label || '', rawLabel: f.rawLabel || '', required: !!f.required, options: f.options, section: cleanLabel(section), meta, selectors: f.selectors, order: i, y: Math.round(rect.top + W.scrollY) };
    });

    const adders = [];
    const navs = [];
    const applies = [];
    for (const b of list) {
      const t0 = b.tagName;
      const isBtn = t0 === 'BUTTON' || (t0 === 'INPUT' && /^(submit|button)$/i.test(b.type)) || b.getAttribute('role') === 'button' || t0 === 'A';
      if (!isBtn || !visible(b) || b.disabled || b.getAttribute('aria-disabled') === 'true') continue;
      if (b.closest('[role="listbox"], [role="menu"], [data-bureau-ignore]')) continue;
      const t = norm(t0 === 'INPUT' ? b.value : (b.innerText || b.textContent)) || norm(b.getAttribute('aria-label'));
      if (!t || t.length > 70) continue;
      const da = b.getAttribute('data-automation-id') || '';
      if (/^add\b(?!ress)/i.test(t.replace(/^[^a-z]+/i, '')) || /^add(Button)?$|-add$/i.test(da)) {
        const id = stampAttr(b, 'data-bureau-add', prefix + 'a');
        let ctx = t + ' ' + attrsOf(b) + ' ' + (b.getAttribute('data-test') || '') + ' ' + (b.getAttribute('data-ui') || '');
        let up = parentOf(b);
        for (let k = 0; up && k < 4 && groupKind(ctx) === 'other'; k++, up = parentOf(up)) {
          const hd = up.querySelector('h1, h2, h3, h4, legend, [role="heading"]');
          ctx += ' ' + attrsOf(up) + ' ' + (up.getAttribute('data-ui') || '') + ' ' + (hd ? ownText(hd) : '');
        }
        if (groupKind(ctx) === 'other') ctx += ' ' + sectionOf(b, '');
        adders.push({ id, text: t, section: cleanLabel(sectionOf(b, '')), group: groupKind(ctx) });
        continue;
      }
      let kind = null;
      if (/^(next|continue|save (and|&) continue|next step|proceed|continue to .*|save & next|weiter)\b/i.test(t) || /NextButton|nextButton/.test(da)) kind = 'next';
      else if (/^(review|review (my |your )?application)\b/i.test(t)) kind = 'review';
      else if (/^(submit|send|complete( application)?|finish|submit (my |your )?application|send application|apply now|apply)$/i.test(t) || /SubmitButton|submitButton/.test(da) || (t0 !== 'A' && b.type === 'submit' && !/^(next|continue|search|sign|log|create|verify|back|cancel)/i.test(t))) kind = 'submit';
      else if (/^(back|previous)\b/i.test(t)) kind = 'back';
      if (/^(apply( now| for this (job|position|role)| to this (job|position))?|i'?m interested|apply manually|start (your )?application|apply for job)$/i.test(t) || /adventureButton|applyManually/.test(da)) {
        applies.push({ id: stampAttr(b, 'data-bureau-nav', prefix + 'n'), text: t, href: t0 === 'A' ? b.getAttribute('href') || '' : '', target: b.getAttribute('target') || '', inForm: !!b.closest('form'), da });
      }
      if (!kind) continue;
      navs.push({ id: stampAttr(b, 'data-bureau-nav', prefix + 'n'), text: t, kind, type: (b.getAttribute('type') || '').toLowerCase(), inForm: !!b.closest('form'), da, tag: t0 });
    }
    const forms = document.querySelectorAll('form').length;
    return { fields, adders, navs, applies, forms, url: location.href, title: document.title };
  }

  function containerOf(el) {
    return el.closest(COMBO_WRAP + ', [data-automation-id*="formField" i], .field, .form-group, .form-field, [class*="field" i], [class*="question" i], li') || parentOf(el) || el;
  }
  function displayOf(el) {
    const box = el.closest('[class*="select__control"], [class*="select-container" i], [class*="select__value-container"], .MuiAutocomplete-root, [data-automation-id="multiselectInputContainer"], [class*="combobox" i], [class*="autocomplete" i], [class*="typeahead" i]') || containerOf(el);
    const picks = Array.from(box.querySelectorAll('[class*="singleValue"], [class*="single-value"], [class*="multiValue"] [class*="label" i], [class*="multi-value__label"], .MuiChip-label, [data-automation-id="selectedItem"], [data-automation-id="promptSelectionLabel"], [class*="selected-value" i], [class*="chip" i], [class*="tag-label" i], [class*="pill" i]'));
    return picks.map((p) => norm(p.textContent)).filter(Boolean).join('; ');
  }
  function errorNear(el) {
    const box = containerOf(el);
    const errs = Array.from(box.querySelectorAll('[role="alert"], [class*="error" i], [class*="invalid" i], [data-automation-id*="error" i], [id$="-error"], [id$="_error"]')).filter((e) => e.tagName !== 'INPUT' && visible(e) && norm(e.textContent).length > 1);
    return errs.map((e) => norm(e.textContent)).filter((t) => t.length < 300).slice(0, 2).join(' · ');
  }
  function read(items) {
    const res = {};
    for (const it of items) {
      const id = it.id;
      const kind = it.kind;
      const el = byStamp('data-bureau-id', id)[0];
      const members = byStamp('data-bureau-group', id).length ? deepAll('[data-bureau-id^="' + id + ':"]') : [];
      if (!el && !members.length) { res[id] = { exists: false, value: '' }; continue; }
      const anchor = el || members[0];
      let value = '';
      let chip = '';
      let display = '';
      if (members.length && kind === 'date') {
        value = members.map((m) => (m.value !== undefined ? m.value : norm(m.textContent))).join('|');
        value = members.map((m) => (m.value !== undefined && m.tagName === 'INPUT' ? m.value : norm(m.getAttribute('aria-valuetext') || m.textContent))).join('|');
      } else if (members.length && kind === 'radio') {
        const on = members.find((m) => m.checked || m.getAttribute('aria-checked') === 'true' || m.getAttribute('aria-pressed') === 'true');
        value = on ? optionLabel(on) : '';
      } else if (members.length && kind === 'checkbox') {
        value = members.filter((m) => m.checked || m.getAttribute('aria-checked') === 'true').map(optionLabel).join('; ');
      } else if (el.tagName === 'SELECT') {
        const sel = Array.from(el.selectedOptions || []).filter((o) => !isPlaceholderOption(o));
        value = sel.map((o) => norm(o.text)).join('; ');
      } else if (el.type === 'checkbox' || el.getAttribute('role') === 'checkbox') {
        value = el.checked || el.getAttribute('aria-checked') === 'true' ? 'true' : 'false';
      } else if (el.type === 'file') {
        value = Array.from(el.files || []).map((f) => f.name).join('; ');
        let n = parentOf(el);
        for (let i = 0; n && i < 4; i++, n = parentOf(n)) { const t = norm(n.innerText || n.textContent); if (t) chip = t.slice(0, 400); if (controlCount(n) > 2) break; }
        // Upload widgets render the file name somewhere else (a preview list, a shadow root): look for it.
        if (it.expect && chip.indexOf(it.expect) < 0) {
          const roots = [document];
          for (const x of all()) if (x.shadowRoot) roots.push(x.shadowRoot);
          for (const r of roots) {
            const host = r === document ? document.body : r;
            const txt = host ? (host.innerText !== undefined ? host.innerText : host.textContent) || '' : '';
            if (txt.indexOf(it.expect) >= 0 || (host && (host.textContent || '').indexOf(it.expect) >= 0)) { chip = it.expect; break; }
          }
        }
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        value = el.value;
        if (kind === 'combobox' || kind === 'location') display = displayOf(el);
        if (kind === 'phone') {
          const cc = byStamp('data-bureau-cc', id)[0];
          if (cc) display = cc.tagName === 'SELECT' ? norm(cc.selectedOptions[0] && cc.selectedOptions[0].text) : norm(cc.getAttribute('title') || cc.getAttribute('aria-label') || cc.textContent);
        }
      } else if (byStamp('data-bureau-native', id)[0]) {
        const nat = byStamp('data-bureau-native', id)[0];
        value = Array.from(nat.selectedOptions || []).filter((o) => !isPlaceholderOption(o)).map((o) => norm(o.text)).join('; ');
        display = norm(el.innerText || el.textContent);
      } else if (it.trigger || el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('role') === 'combobox') {
        value = norm(el.innerText || el.textContent);
        if (/^(select( one)?|select\.\.\.|choose.*|please select.*|--.*)$/i.test(value)) value = '';
        if (!value) display = displayOf(el);
      } else {
        value = norm(el.innerText || el.textContent);
      }
      const invalid = anchor.getAttribute && anchor.getAttribute('aria-invalid') === 'true';
      res[id] = { exists: true, value: String(value == null ? '' : value), display, chip, invalid, error: errorNear(anchor) };
    }
    return res;
  }
  function options(arg) {
    let scope = null;
    if (arg && arg.forId) {
      const el = byStamp('data-bureau-id', arg.forId)[0];
      const ctl = el && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns'));
      if (ctl) scope = (rootOf(el).getElementById ? rootOf(el).getElementById(ctl) : null) || document.getElementById(ctl);
      if (scope && !visible(scope) && !Array.from(scope.querySelectorAll('[role=option]')).some(visible)) scope = null;
    }
    const SEL = '[role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], .select2-result-selectable, .chosen-results li.active-result, [class*="dropdown-results" i] > *, [class*="select__option"], .MuiAutocomplete-option, [data-automation-id="promptOption"], [data-automation-id="menuItem"], .pac-item, [class*="suggestion" i]:not(:has([class*="suggestion" i])), [class*="dropdown-item" i], li[class*="option" i]';
    const els = scope ? Array.from(scope.querySelectorAll(SEL)) : deepAll(SEL);
    const seen = new Set();
    const out = [];
    for (const o of els) {
      if (seen.has(o) || !visible(o) || o.getAttribute('aria-disabled') === 'true') continue;
      if (o.querySelector('[role="option"]')) continue;
      // Real menu items only: no form controls inside, and loose class matches must sit in a menu-like container.
      if (o.querySelector('input, select, textarea')) continue;
      if (!o.matches('[role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], .pac-item, .select2-result-selectable, .MuiAutocomplete-option, [data-automation-id="promptOption"], [data-automation-id="menuItem"]') && !o.closest('[role="listbox"], [role="menu"], .pac-container, [class*="menu" i], [class*="dropdown" i], [class*="results" i], [class*="suggest" i], [class*="popover" i], [class*="popup" i]')) continue;
      seen.add(o);
      const id = stampAttr(o, 'data-bureau-opt', 'o');
      out.push({ opt: id, text: norm(o.innerText || o.textContent).replace(/\s*[›»▸▶❯>]+\s*$/, '').slice(0, 200) });
      if (out.length >= 200) break;
    }
    return out;
  }
  function errors() {
    const sel = '[role="alert"], [aria-live="assertive"], .error, .errors, .field-error, .error-message, .invalid-feedback, [class*="error" i], [class*="invalid" i], [data-automation-id*="error" i], [id$="-error"], [id$="_error"]';
    const msgs = [];
    for (const e of deepAll(sel)) {
      if (e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA' || e.tagName === 'FORM') continue;
      if (!visible(e)) continue;
      if (e.querySelector(sel) && norm(e.textContent) === norm(e.querySelector(sel).textContent)) continue;
      const t = norm(e.innerText || e.textContent);
      if (t.length < 2 || t.length > 300) continue;
      if (/captcha/i.test(String(e.className))) continue;
      if (msgs.indexOf(t) < 0) msgs.push(t);
    }
    const invalid = deepAll('[aria-invalid="true"]').filter(visible).map((e) => labelOf(e)).filter(Boolean);
    return { messages: msgs.slice(0, 10), invalid: invalid.slice(0, 10) };
  }
  function challenge() {
    const SRC = /recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com|challenges\.cloudflare\.com|turnstile|arkoselabs\.com|funcaptcha|captcha-delivery\.com|geo\.captcha|px-captcha/i;
    for (const f of deepAll('iframe')) {
      const r = f.getBoundingClientRect();
      const shown = r.width > 60 && r.height > 60 && getComputedStyle(f).visibility !== 'hidden' && getComputedStyle(f).display !== 'none';
      const src = f.getAttribute('src') || '';
      const title = f.getAttribute('title') || '';
      if (shown && (SRC.test(src) || /recaptcha challenge|hcaptcha|cloudflare security challenge|arkose|verification challenge/i.test(title))) {
        const kind = /recaptcha/i.test(src + title) ? 'recaptcha' : /hcaptcha/i.test(src + title) ? 'hcaptcha' : /cloudflare|turnstile/i.test(src + title) ? 'turnstile' : /arkose|funcaptcha/i.test(src + title) ? 'arkose' : 'captcha';
        return { found: true, kind };
      }
    }
    for (const d of deepAll('.g-recaptcha, .h-captcha, .cf-turnstile, #px-captcha, [id^="arkose"], [class*="captcha" i][data-sitekey], [data-captcha-visible]')) {
      if (d.classList.contains('grecaptcha-badge')) continue;
      const r = d.getBoundingClientRect();
      if (r.width > 60 && r.height > 40 && visible(d)) return { found: true, kind: d.className.indexOf('h-captcha') >= 0 ? 'hcaptcha' : d.className.indexOf('cf-turnstile') >= 0 ? 'turnstile' : 'captcha' };
    }
    const body = norm(document.body ? document.body.innerText : '').slice(0, 3000);
    const few = document.querySelectorAll('input:not([type=hidden]), textarea, select').length < 2;
    if (few && /verify (that )?you are (a )?human|checking (if the site connection is secure|your browser)|press (&|and) hold|are you a robot|unusual traffic|access denied|request blocked|attention required/i.test(body)) return { found: true, kind: 'bot_wall' };
    return { found: false, kind: '' };
  }
  function confirmCheck(a) {
    const body = norm(document.body ? document.body.innerText : '');
    const re = /thank(s| you) (you )?for (applying|your application|your interest)|application (has been |was )?(received|submitted|sent|complete)|we('|’)ve received your application|we have received your application|successfully (submitted|applied)|your application (is|has been) (on its way|submitted|received)|application sent|you('|’)ve applied|you have applied|congratulations.*application/i;
    let hit = re.test(body);
    if (!hit && a && a.text) { try { hit = new RegExp(a.text, 'i').test(body); } catch (e) {} }
    if (!hit && a && a.selectors) for (const s of a.selectors) { try { if (deepAll(s).some(visible)) { hit = true; break; } } catch (e) {} }
    return { confirmed: hit, text: body.slice(0, 300) };
  }
  function fingerprint() {
    const heads = deepAll('h1, h2, h3, [aria-current="step"], [data-automation-id="progressBarActiveStep"], legend').filter(visible).map((h) => norm(h.textContent)).join('|').slice(0, 600);
    const ctl = deepAll(CONTROL_SEL).filter(visible).length;
    const step = deepAll('[aria-current="step"], [data-automation-id="progressBarActiveStep"], .step.active, [class*="step" i][class*="active" i], [class*="current" i][class*="step" i]').filter(visible).map((e) => norm(e.textContent)).join('|').slice(0, 200);
    return { heads, ctl, step, url: location.href };
  }

  if (op === 'extract') return extract(arg.prefix);
  if (op === 'read') return read(arg.items);
  if (op === 'options') return options(arg);
  if (op === 'errors') return errors();
  if (op === 'challenge') return challenge();
  if (op === 'confirm') return confirmCheck(arg);
  if (op === 'fingerprint') return fingerprint();
  if (op === 'blur') {
    const el = byStamp('data-bureau-id', arg.id)[0];
    if (el) { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); if (el.blur) el.blur(); el.dispatchEvent(new Event('change', { bubbles: true })); }
    return !!el;
  }
  if (op === 'selectOptions') {
    const el = byStamp('data-bureau-id', arg.id)[0];
    if (!el || el.tagName !== 'SELECT') return [];
    return Array.from(el.options).map((o, i) => ({ index: i, text: norm(o.text), value: o.value, placeholder: isPlaceholderOption(o), disabled: o.disabled }));
  }
  if (op === 'stampOf') {
    const found = [];
    for (const s of arg.selectors) {
      let els = [];
      try { els = deepAll(s); } catch (e) { els = []; }
      const v = els.filter((e) => visible(e) || (e.type === 'file') || e.getAttribute('data-bureau-group'));
      if (v.length === 1) {
        const e = v[0];
        found.push({ selector: s, id: e.getAttribute('data-bureau-id') || (e.getAttribute('data-bureau-group') || ''), group: e.getAttribute('data-bureau-group') || '' });
      }
    }
    return found;
  }
  if (op === 'scrollTop') { W.scrollTo(0, 0); return true; }
  if (op === 'saveButtons') {
    // Visible "Save" buttons of open entry sub-forms (never the application's own submit).
    const out = [];
    const seen = new Set();
    for (const b of deepAll('button, [role="button"], input[type=button], [data-test$="-save"], [data-ui$="save-section"]')) {
      if (seen.has(b) || !visible(b) || b.disabled) continue;
      seen.add(b);
      const t = norm(b.tagName === 'INPUT' ? b.value : b.innerText || b.textContent);
      const tag = (b.getAttribute('data-ui') || '') + ' ' + (b.getAttribute('data-test') || '') + ' ' + (b.getAttribute('data-automation-id') || '');
      const isSave = /^(save|done|save entry|save (position|education|experience))$/i.test(t) || /(^|[-_ ])save(-section)?$|-save$/i.test(tag.trim());
      if (!isSave || b.type === 'submit' || /submit|apply/i.test(tag)) continue;
      let box = parentOf(b);
      for (let k = 0; box && k < 5 && !box.querySelector('input:not([type=hidden]), textarea, select'); k++) box = parentOf(box);
      if (!box || box.tagName === 'FORM' || box === document.body) continue;
      if (box.querySelectorAll('input:not([type=hidden]), textarea, select').length > 12) continue;
      // The fields this save commits (they empty out afterwards): reported so verification checks the saved entry instead.
      const ids = Array.from(box.querySelectorAll('[data-bureau-id]')).map((e) => e.getAttribute('data-bureau-id'));
      const values = Array.from(box.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')).map((e) => norm(e.value)).filter((v) => v.length >= 3);
      out.push({ id: stampAttr(b, 'data-bureau-nav', 'sb'), fields: ids, values });
    }
    return out;
  }
  if (op === 'saveNear') {
    // The "Save" / "Done" button of an inline sub-form opened by an "Add" button.
    const adder = byStamp('data-bureau-add', arg.adderId)[0];
    let n = adder ? parentOf(adder) : null;
    const BTN = 'button, [role="button"], input[type=button], input[type=submit]';
    for (let i = 0; n && i < 7; i++, n = parentOf(n)) {
      // Buttons inside custom elements' open shadow roots count too (SmartRecruiters' spl-button).
      const btns = collect(n, []).filter((b) => b.matches(BTN) && b !== adder && !(adder && adder.shadowRoot && adder.shadowRoot.contains(b)) && visible(b) && !b.disabled);
      const hit = btns.find((b) => {
        // A button inside a custom element shows its host's slotted text and carries the host's test ids.
        const host = rootOf(b) !== document && rootOf(b).host ? rootOf(b).host : null;
        const text = norm(b.tagName === 'INPUT' ? b.value : b.innerText || b.textContent) || (host ? norm(host.textContent) : '') || norm(b.getAttribute('aria-label'));
        const tag = b.getAttribute('data-ui') || b.getAttribute('data-test') || (host && (host.getAttribute('data-ui') || host.getAttribute('data-test'))) || '';
        return /^(save|done|ok|confirm|add|save (entry|position|education|experience)|save (position|education|experience) entry)$/i.test(text) || /save(-section)?$|-save$|^save/i.test(tag);
      });
      if (hit) return stampAttr(hit, 'data-bureau-nav', 'sv');
      if (n.tagName === 'FORM') break;
    }
    return null;
  }
  return null;
}`;

/** Run one PAGE_LIB op in a frame. */
export async function inFrame<T>(frame: Frame, op: string, arg: unknown = {}): Promise<T> {
  return (await frame.evaluate(`(${PAGE_LIB})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`)) as T;
}

/** Same as inFrame on the page's main frame. */
export function inPage<T>(page: Page, op: string, arg: unknown = {}): Promise<T> {
  return inFrame<T>(page.mainFrame(), op, arg);
}

// ── Shapes returned by the in-page ops ────────────────────────────────────────

export interface RawField {
  id: string;
  kind: string;
  label: string;
  rawLabel: string;
  required: boolean;
  options?: string[];
  section: string;
  meta: {
    segments?: string[];
    multi?: boolean;
    multiple?: boolean;
    trigger?: 'button';
    format?: string;
    cc?: 'select' | 'button';
    maxLength?: number;
    accept?: string;
    eeo?: boolean;
    group?: { index: number; count: number; name: string };
    options?: string[];
    question?: string;
    hiddenInput?: boolean;
    hint?: string;
    native?: boolean;
    toggle?: boolean;
  };
  selectors: string[];
  order: number;
  y: number;
}
export interface RawNav {
  id: string;
  text: string;
  kind: 'next' | 'review' | 'submit' | 'back';
  type: string;
  inForm: boolean;
  da: string;
  tag: string;
}
export interface RawApply {
  id: string;
  text: string;
  href: string;
  target: string;
  inForm: boolean;
  da: string;
}
export interface RawAdder {
  id: string;
  text: string;
  section: string;
  group: string;
}
export interface RawExtract {
  fields: RawField[];
  adders: RawAdder[];
  navs: RawNav[];
  applies: RawApply[];
  forms: number;
  url: string;
  title: string;
}
export interface ReadResult {
  exists: boolean;
  value: string;
  display?: string;
  chip?: string;
  invalid?: boolean;
  error?: string;
}

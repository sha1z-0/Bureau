/*
 * Tiny plumbing shared by the fixture forms. It is NOT part of any replica's
 * visible structure: each page keeps its own ATS-specific DOM, widgets and
 * validation. This only posts to the fixture server and paints errors.
 */
(function () {
  'use strict';

  function submitUrl(formId, step) {
    return '/__submit/' + encodeURIComponent(formId) + (step ? '/' + step : '');
  }

  /** POST FormData (multipart) and resolve with the server's JSON verdict. */
  async function postForm(formId, formData, step) {
    const res = await fetch(submitUrl(formId, step), {
      method: 'POST',
      body: formData,
      headers: { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' },
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({ ok: false, errors: ['bad response'] }));
    return data;
  }

  /** POST a JSON body (files as { filename, mime, contentBase64 }). */
  async function postJson(formId, body, step) {
    const res = await fetch(submitUrl(formId, step), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
    });
    return res.json().catch(() => ({ ok: false, errors: ['bad response'] }));
  }

  function fileToJson(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ filename: file.name, mime: file.type || 'application/octet-stream', contentBase64: String(r.result).split(',')[1] || '' });
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  /** Follow the server's redirect after a successful final submit. */
  function finish(result) {
    if (result && result.ok && result.redirect) {
      window.location.assign(result.redirect);
      return true;
    }
    return false;
  }

  function isBlank(el) {
    if (!el) return true;
    if (el.type === 'checkbox' || el.type === 'radio') {
      const group = el.name ? el.form ? el.form.querySelectorAll('[name="' + CSS.escape(el.name) + '"]') : [el] : [el];
      return !Array.prototype.some.call(group, (x) => x.checked);
    }
    if (el.type === 'file') return !el.files || el.files.length === 0;
    return !String(el.value || '').trim();
  }

  window.FX = { submitUrl, postForm, postJson, fileToJson, finish, isBlank };
})();

/*
 * Host-page half of the CAPTCHA mocks (plays the role of the vendor's api.js):
 * listens to the cross-origin captcha iframes, shows/hides the challenge
 * popup, writes the token into the vendor's hidden response field(s), and
 * gates the application form's submit. Used by captcha-*.html only.
 *
 * Message protocol (frame -> host), all with source 'fx-captcha':
 *   { kind: 'open' }            checkbox clicked by a human: show the challenge
 *   { kind: 'token', token }    challenge solved: write token, tick the checkbox
 *   { kind: 'resize', height }  inline widget (Turnstile) grows for its challenge
 *   { kind: 'close' }           challenge dismissed from inside
 * host -> anchor frame: { kind: 'checked' } | { kind: 'reset' }
 */
(function () {
  'use strict';

  function attach(opts) {
    var origin = opts.frameOrigin;
    var popup = null;
    var challengeFrame = null;

    function tell(frame, msg) {
      if (frame && frame.contentWindow) {
        msg.source = 'fx-captcha-host';
        frame.contentWindow.postMessage(msg, origin);
      }
    }

    function openChallenge() {
      if (!opts.challenge) return;
      if (!popup) {
        popup = opts.challenge.build();
        challengeFrame = popup.querySelector('iframe');
        var overlay = popup.querySelector('[data-fx-overlay]');
        if (overlay)
          overlay.addEventListener('click', function () {
            closeChallenge(true);
          });
        document.body.appendChild(popup);
      }
      var r = opts.anchor.getBoundingClientRect();
      var box = popup.querySelector('[data-fx-bubble]');
      if (box) {
        // Like the vendors: next to the checkbox, but clamped so the whole bubble is on screen.
        var h = box.offsetHeight || 600;
        var top = Math.max(10, Math.min(r.top - 200, window.innerHeight - h - 10));
        box.style.top = top + window.scrollY + 'px';
        box.style.left = Math.max(10, Math.min(r.left + 54, window.innerWidth - (box.offsetWidth || 400) - 10)) + window.scrollX + 'px';
      }
      popup.style.visibility = 'visible';
    }

    function closeChallenge(reset) {
      if (popup) popup.style.visibility = 'hidden';
      if (reset) tell(opts.anchor, { kind: 'reset' });
    }

    window.addEventListener('message', function (e) {
      if (e.origin !== origin) return;
      var d = e.data || {};
      if (d.source !== 'fx-captcha') return;
      var fromAnchor = e.source === opts.anchor.contentWindow;
      var fromChallenge = challengeFrame && e.source === challengeFrame.contentWindow;
      if (!fromAnchor && !fromChallenge) return;
      if (d.kind === 'open') openChallenge();
      else if (d.kind === 'close') closeChallenge(true);
      else if (d.kind === 'resize' && fromAnchor && typeof d.height === 'number') {
        opts.anchor.style.height = d.height + 'px';
        if (typeof d.width === 'number') opts.anchor.style.width = d.width + 'px';
      }
      else if (d.kind === 'token' && typeof d.token === 'string') {
        opts.tokenInputs.forEach(function (el) {
          el.value = d.token;
        });
        closeChallenge(false);
        tell(opts.anchor, { kind: 'checked' });
        if (opts.onToken) opts.onToken(d.token);
      }
    });
  }

  /** Client-side validation + gated multipart submit for the host form. */
  function form(formEl, formId, opts) {
    var summary = opts.errorBox;
    function fieldOf(el) {
      return el.closest('.field') || el.parentElement;
    }
    function mark(el, msg) {
      var f = fieldOf(el);
      var m = f.querySelector('.field-error');
      if (msg) {
        if (!m) {
          m = document.createElement('div');
          m.className = 'field-error';
          f.appendChild(m);
        }
        m.textContent = msg;
        el.setAttribute('aria-invalid', 'true');
      } else {
        if (m) m.remove();
        el.removeAttribute('aria-invalid');
      }
    }
    formEl.setAttribute('novalidate', '');
    formEl.addEventListener('submit', async function (e) {
      e.preventDefault();
      var bad = 0;
      formEl.querySelectorAll('[required]').forEach(function (el) {
        var empty = FX.isBlank(el);
        var msg = empty ? 'This field is required.' : '';
        if (!empty && el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)) msg = 'Enter a valid email address.';
        mark(el, msg);
        if (msg) bad++;
      });
      var token = opts.tokenInputs.map(function (el) {
        return el.value;
      }).join('');
      var captchaErr = opts.captchaError;
      captchaErr.textContent = token ? '' : 'Please complete the CAPTCHA';
      captchaErr.style.display = token ? 'none' : 'block';
      if (bad || !token) {
        summary.textContent = bad ? 'Please fix the highlighted fields.' : '';
        summary.style.display = bad ? 'block' : 'none';
        return;
      }
      var btn = formEl.querySelector('[type=submit]');
      btn.disabled = true;
      var res = await FX.postForm(formId, new FormData(formEl));
      if (FX.finish(res)) return;
      btn.disabled = false;
      summary.textContent = (res.errors || ['Something went wrong.']).join(' ');
      summary.style.display = 'block';
    });
  }

  window.FXCaptchaHost = { attach: attach, form: form };
})();

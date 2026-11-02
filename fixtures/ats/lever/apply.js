/*
 * Behaviour of the Lever apply page (fixture): resume "parsing" states, the
 * custom-pronoun toggle, the structured location typeahead that fills the
 * hidden selectedLocation, native-validation error styling, and Lever's
 * invisible-hCaptcha submit flow (btn-submit -> hcaptcha.execute -> callback
 * writes h-captcha-response -> hidden #hcaptchaSubmitBtn.click() -> native
 * multipart POST of form#application-form).
 */
(function () {
  'use strict';
  var form = document.getElementById('application-form');
  var banner = form.querySelector('.error-banner');

  // --- Resume upload ------------------------------------------------------
  var resumeLi = form.querySelector('.application-question.resume');
  var resumeInput = document.getElementById('resume-upload-input');
  var resumeBtn = resumeLi.querySelector('.visible-resume-upload');
  resumeBtn.addEventListener('click', function (e) {
    if (e.target !== resumeInput) e.preventDefault();
  });
  resumeInput.addEventListener('change', function () {
    var f = resumeInput.files && resumeInput.files[0];
    resumeLi.classList.remove('resume-working', 'resume-success', 'resume-failure', 'resume-oversize', 'has-error');
    var err = resumeLi.querySelector('.application-error');
    if (err) err.remove();
    if (!f) return;
    if (f.size > 100 * 1024 * 1024) {
      resumeInput.value = '';
      resumeLi.classList.add('resume-oversize');
      return;
    }
    resumeBtn.querySelector('.filename').textContent = f.name;
    resumeBtn.querySelector('.default-label').style.display = 'none';
    resumeLi.classList.add('resume-working');
    // Lever uploads the file to /parseResume and stores it; we only simulate the round trip.
    setTimeout(function () {
      resumeLi.classList.remove('resume-working');
      resumeLi.classList.add('resume-success');
      form.querySelector('input[name=resumeStorageId]').value = 'rs-' + Math.random().toString(16).slice(2, 10) + '-' + Date.now().toString(16);
    }, 900);
  });

  // --- Pronouns: "Custom" reveals a text field ------------------------------
  var custom = document.getElementById('customPronounsOption');
  var customText = document.getElementById('customPronounsTextField');
  custom.addEventListener('change', function () {
    customText.style.display = custom.checked ? 'block' : 'none';
    if (!custom.checked) customText.value = '';
  });

  // --- Structured location typeahead ----------------------------------------
  var LOCATIONS = [
    { name: 'Lahore, Punjab, Pakistan', id: 'ChIJ2QeB5YMEGTkRYiR-zGy-OsI' },
    { name: 'Lahore Cantonment, Lahore, Punjab, Pakistan', id: 'ChIJm7oRy-IEGTkRB7pAFpNcpTM' },
    { name: 'Karachi, Sindh, Pakistan', id: 'ChIJv0sdZQY-sz4RIwxaVUQv-Zw' },
    { name: 'Islamabad, Islamabad Capital Territory, Pakistan', id: 'ChIJL3qO4bW_3zgRCb6QmdzR1L8' },
    { name: 'Lagos, Nigeria', id: 'ChIJwYCC5iqLOxARy9nDZ6OHntw' },
    { name: 'Lahaina, HI, USA', id: 'ChIJt8KfSbfQVHkRvd2FdRz_9C0' },
    { name: 'London, UK', id: 'ChIJdd4hrwug2EcRmSrV3Vo6llI' },
    { name: 'Dubai - United Arab Emirates', id: 'ChIJRcbZaklDXz4RYlEphFBu5r0' },
    { name: 'Berlin, Germany', id: 'ChIJAVkDPzdOqEcRcDteW0YgIQQ' },
    { name: 'Toronto, ON, Canada', id: 'ChIJpTvG15DL1IkRd8S0KlBVNTI' },
  ];
  var locLi = form.querySelector('.location-question');
  var loc = document.getElementById('location-input');
  var selected = document.getElementById('selected-location');
  var dd = locLi.querySelector('.dropdown-container');
  var results = dd.querySelector('.dropdown-results');
  var items = [];
  var hi = -1;
  var timer = null;

  function closeDd() {
    locLi.classList.remove('dropdown-open');
    hi = -1;
  }
  function highlight(i) {
    hi = i;
    Array.prototype.forEach.call(results.children, function (c, j) {
      c.classList.toggle('highlighted', j === i);
    });
  }
  function choose(i) {
    var it = items[i];
    if (!it) return;
    loc.value = it.name;
    selected.value = JSON.stringify({ name: it.name, id: it.id });
    closeDd();
    locLi.classList.remove('has-error');
  }
  function search() {
    var q = loc.value.trim().toLowerCase();
    dd.classList.remove('no-results', 'loading');
    results.innerHTML = '';
    if (q.length < 2) return closeDd();
    items = LOCATIONS.filter(function (l) { return l.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
    if (!items.length) dd.classList.add('no-results');
    items.forEach(function (it, i) {
      var row = document.createElement('div');
      row.className = 'dropdown-location';
      row.setAttribute('data-id', it.id);
      row.textContent = it.name;
      row.addEventListener('mousedown', function (e) {
        e.preventDefault();
        choose(i);
      });
      row.addEventListener('mouseover', function () { highlight(i); });
      results.appendChild(row);
    });
    hi = -1;
    locLi.classList.add('dropdown-open');
  }
  loc.addEventListener('input', function () {
    selected.value = '';
    locLi.classList.add('dropdown-open');
    dd.classList.add('loading');
    results.innerHTML = '';
    clearTimeout(timer);
    timer = setTimeout(search, 250);
  });
  loc.addEventListener('keydown', function (e) {
    if (!locLi.classList.contains('dropdown-open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items.length - 1, hi + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, hi - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hi < 0 ? 0 : hi); }
    else if (e.key === 'Escape') closeDd();
  });
  loc.addEventListener('blur', function () { setTimeout(closeDd, 150); });

  // --- Validation styling ------------------------------------------------------
  function liOf(el) {
    return el.closest('.application-question');
  }
  function markError(el, msg) {
    var li = liOf(el);
    if (!li) return;
    li.classList.add('has-error');
    el.setAttribute('aria-invalid', 'true');
    if (!li.querySelector('.application-error')) {
      var p = document.createElement('div');
      p.className = 'application-error';
      p.setAttribute('role', 'alert');
      p.textContent = msg;
      (li.querySelector('.application-field') || li).appendChild(p);
    }
  }
  function clearError(el) {
    var li = liOf(el);
    if (!li) return;
    li.classList.remove('has-error');
    el.removeAttribute('aria-invalid');
    var p = li.querySelector('.application-error');
    if (p) p.remove();
  }
  form.addEventListener('invalid', function (e) {
    markError(e.target, e.target.type === 'email' && e.target.value ? 'Please enter a valid email address.' : 'This field is required.');
  }, true);
  form.addEventListener('input', function (e) { if (e.target.checkValidity && e.target.checkValidity()) clearError(e.target); });
  form.addEventListener('change', function (e) { if (e.target.checkValidity && e.target.checkValidity()) clearError(e.target); });

  // --- Invisible hCaptcha + submit (mirrors Lever's inline script) ----------
  var captchaId = null;
  var executedFromSubmitButton = false;
  var hcaptchaTokenExpired = false;
  var submitBtn = document.getElementById('btn-submit');
  var formSubmitButton = document.getElementById('hcaptchaSubmitBtn');
  var tokenInput = document.getElementById('hcaptchaResponseInput');

  function clickSubmitButton() {
    // Clicking the hidden submit button runs native constraint validation.
    formSubmitButton.click();
  }
  function onSuccess(token) {
    hcaptchaTokenExpired = false;
    tokenInput.value = token;
    if (executedFromSubmitButton) clickSubmitButton();
  }
  captchaId = window.hcaptcha.render('h-captcha', {
    sitekey: document.getElementById('h-captcha').getAttribute('data-sitekey'),
    size: 'invisible',
    callback: onSuccess,
    'expired-callback': function () { hcaptchaTokenExpired = true; },
  });
  submitBtn.addEventListener('click', function () {
    if (tokenInput.value && !hcaptchaTokenExpired) return clickSubmitButton();
    executedFromSubmitButton = true;
    window.hcaptcha.execute(captchaId);
  });
  form.addEventListener('submit', function (event) {
    if (!tokenInput.value || hcaptchaTokenExpired) {
      event.preventDefault();
      executedFromSubmitButton = true;
      window.hcaptcha.execute(captchaId);
      return;
    }
    if (!resumeInput.files || !resumeInput.files.length) {
      event.preventDefault();
      markError(resumeInput, 'Please attach your resume/CV.');
      resumeLi.scrollIntoView({ block: 'center' });
      return;
    }
    if (resumeLi.classList.contains('resume-working')) {
      event.preventDefault();
      banner.textContent = 'Please wait until your resume has finished uploading.';
      banner.style.display = 'block';
      setTimeout(clickSubmitButton, 600);
      return;
    }
    banner.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
  });
})();

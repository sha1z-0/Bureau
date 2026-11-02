/*
 * Behaviour of the Workable application fixture: phone country dropdown with
 * dial-code detection, photo picker, Education / Experience inline sub-forms
 * that save into cards, MM/YYYY date masks, the resume drop zone, the custom
 * CA_ listbox, inline validation, and an XMLHttpRequest multipart submit.
 */
(function () {
  'use strict';
  var FORM_ID = window.__FX_FORM_ID;
  var form = document.querySelector('form[data-ui=application-form]');
  var summaryError = form.querySelector('[data-ui=form-error]');

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function wrapperOf(el) { return el.closest('.styles--1Sarc'); }
  function setError(el, msg) {
    var w = wrapperOf(el);
    if (!w) return;
    var id = (el.id || el.getAttribute('name') || 'field') + '-error';
    var old = w.querySelector(':scope > .styles--error');
    if (old) old.remove();
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) {
      var p = document.createElement('p');
      p.className = 'styles--error';
      p.id = id;
      p.setAttribute('role', 'alert');
      p.textContent = msg;
      w.appendChild(p);
      el.setAttribute('aria-errormessage', id);
    } else el.removeAttribute('aria-errormessage');
  }

  // --- Phone: country dropdown + dial-code detection ----------------------------
  var COUNTRIES = [
    ['US', 'United States', '1', '🇺🇸'], ['CA', 'Canada', '1', '🇨🇦'], ['GB', 'United Kingdom', '44', '🇬🇧'], ['IE', 'Ireland', '353', '🇮🇪'],
    ['DE', 'Germany', '49', '🇩🇪'], ['NL', 'Netherlands', '31', '🇳🇱'], ['GR', 'Greece', '30', '🇬🇷'], ['PK', 'Pakistan', '92', '🇵🇰'],
    ['IN', 'India', '91', '🇮🇳'], ['BD', 'Bangladesh', '880', '🇧🇩'], ['AE', 'United Arab Emirates', '971', '🇦🇪'], ['SA', 'Saudi Arabia', '966', '🇸🇦'],
    ['EG', 'Egypt', '20', '🇪🇬'], ['NG', 'Nigeria', '234', '🇳🇬'], ['KE', 'Kenya', '254', '🇰🇪'], ['TR', 'Turkey', '90', '🇹🇷'],
    ['AU', 'Australia', '61', '🇦🇺'], ['SG', 'Singapore', '65', '🇸🇬'], ['PH', 'Philippines', '63', '🇵🇭'], ['BR', 'Brazil', '55', '🇧🇷'],
  ];
  var country = COUNTRIES[0];
  var phone = $('#phone');
  var cBtn = $('[data-ui=phone-country]');
  var cMenu = $('.styles--country-menu');
  var cSearch = $('.styles--country-search');
  var cList = $('.styles--country-list');
  var cActive = 0;
  var cShown = COUNTRIES.slice();

  function setCountry(c) {
    country = c;
    cBtn.querySelector('.flag').textContent = c[3];
    cBtn.querySelector('.dial').textContent = '+' + c[2];
    cBtn.setAttribute('aria-label', 'Country code: ' + c[1] + ' +' + c[2]);
  }
  function drawCountries() {
    var q = cSearch.value.trim().toLowerCase();
    cShown = COUNTRIES.filter(function (c) { return !q || c[1].toLowerCase().indexOf(q) !== -1 || ('+' + c[2]).indexOf(q) !== -1; });
    cList.innerHTML = '';
    cShown.forEach(function (c, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('data-country', c[0]);
      li.setAttribute('aria-selected', c === country ? 'true' : 'false');
      if (i === cActive) li.classList.add('is-active');
      li.innerHTML = '<span aria-hidden="true"></span><span></span><span></span>';
      li.children[0].textContent = c[3];
      li.children[1].textContent = c[1];
      li.children[2].textContent = '+' + c[2];
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        pickCountry(c);
      });
      cList.appendChild(li);
    });
  }
  function openCountries() {
    cMenu.hidden = false;
    cBtn.setAttribute('aria-expanded', 'true');
    cSearch.value = '';
    cActive = 0;
    drawCountries();
    cSearch.focus();
  }
  function closeCountries() {
    cMenu.hidden = true;
    cBtn.setAttribute('aria-expanded', 'false');
  }
  function pickCountry(c) {
    setCountry(c);
    closeCountries();
    phone.focus();
  }
  cBtn.addEventListener('click', function () { cMenu.hidden ? openCountries() : closeCountries(); });
  cSearch.addEventListener('input', function () { cActive = 0; drawCountries(); });
  cSearch.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cActive = Math.min(cShown.length - 1, cActive + 1); drawCountries(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cActive = Math.max(0, cActive - 1); drawCountries(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (cShown[cActive]) pickCountry(cShown[cActive]); }
    else if (e.key === 'Escape') { closeCountries(); cBtn.focus(); }
  });
  cSearch.addEventListener('blur', function () { setTimeout(closeCountries, 150); });
  phone.addEventListener('input', function () {
    var v = phone.value.replace(/[^\d+]/g, '');
    if (v.charAt(0) === '+') {
      var digits = v.slice(1);
      var best = null;
      COUNTRIES.forEach(function (c) {
        if (digits.indexOf(c[2]) === 0 && (!best || c[2].length > best[2].length)) best = c;
      });
      if (best && best[2] !== country[2]) setCountry(best);
    }
    if (phone.getAttribute('aria-invalid') === 'true' && phone.value.trim()) setError(phone, '');
  });
  function phoneE164() {
    var raw = phone.value.trim();
    if (!raw) return '';
    if (raw.charAt(0) === '+') return '+' + raw.replace(/\D/g, '');
    return '+' + country[2] + raw.replace(/\D/g, '').replace(/^0+/, '');
  }

  // --- Photo ---------------------------------------------------------------------
  var avatar = $('#avatar');
  $('[data-ui=avatar-upload]').addEventListener('click', function () { avatar.click(); });
  avatar.addEventListener('change', function () {
    var f = avatar.files && avatar.files[0];
    $('.styles--avatar-name').textContent = f ? f.name : '';
  });

  // --- MM/YYYY masks -------------------------------------------------------------
  $all('.styles--date').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var d = inp.value.replace(/\D/g, '').slice(0, 6);
      inp.value = d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
    });
  });
  function badDate(v) {
    return v && !/^(0[1-9]|1[0-2])\/(19|20)\d{2}$/.test(v);
  }

  // --- Education / Experience groups -------------------------------------------
  var groups = {};
  function setupGroup(kind, fieldsList, requiredField, describe) {
    var root = $('[data-ui=' + kind + ']');
    var add = root.querySelector('[data-ui=add-section]');
    var sub = root.querySelector('[data-ui=' + kind + '-form]');
    var list = root.querySelector('[data-ui=' + kind + '-entries]');
    var state = { entries: [], editing: -1, sub: sub };
    groups[kind] = state;
    function input(name) { return sub.querySelector('#' + kind + '-' + name); }
    function clear() {
      fieldsList.forEach(function (n) {
        var el = input(n);
        if (el.type === 'checkbox') el.checked = false;
        else el.value = '';
        el.disabled = false;
        setError(el, '');
      });
    }
    function draw() {
      list.innerHTML = '';
      state.entries.forEach(function (e, i) {
        var card = document.createElement('div');
        card.className = 'styles--entry';
        card.setAttribute('data-ui', kind + '-entry');
        var d = describe(e);
        card.innerHTML = '<div><div class="styles--entry-title"></div><div class="styles--entry-meta"></div></div><div class="styles--entry-actions"><button type="button" data-ui="edit-entry">Edit</button><button type="button" data-ui="remove-entry">Remove</button></div>';
        card.querySelector('.styles--entry-title').textContent = d[0];
        card.querySelector('.styles--entry-meta').textContent = d[1];
        card.querySelector('[data-ui=edit-entry]').addEventListener('click', function () {
          state.editing = i;
          fieldsList.forEach(function (n) {
            var el = input(n);
            if (el.type === 'checkbox') el.checked = !!e[n];
            else el.value = e[n] || '';
          });
          if (input('current')) input('end_date').disabled = !!e.current;
          sub.hidden = false;
          add.hidden = true;
        });
        card.querySelector('[data-ui=remove-entry]').addEventListener('click', function () {
          state.entries.splice(i, 1);
          draw();
        });
        list.appendChild(card);
      });
    }
    add.addEventListener('click', function () {
      state.editing = -1;
      clear();
      sub.hidden = false;
      add.hidden = true;
      input(requiredField).focus();
    });
    sub.querySelector('[data-ui=cancel-section]').addEventListener('click', function () {
      clear();
      sub.hidden = true;
      add.hidden = false;
    });
    sub.querySelector('[data-ui=save-section]').addEventListener('click', function () {
      var ok = true;
      var req = input(requiredField);
      if (!req.value.trim()) { setError(req, 'This field is required'); ok = false; } else setError(req, '');
      ['start_date', 'end_date'].forEach(function (n) {
        var el = input(n);
        if (badDate(el.value.trim())) { setError(el, 'Use the format MM/YYYY'); ok = false; } else setError(el, '');
      });
      if (!ok) return;
      var e = {};
      fieldsList.forEach(function (n) {
        var el = input(n);
        e[n] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      if (state.editing >= 0) state.entries[state.editing] = e;
      else state.entries.push(e);
      state.editing = -1;
      clear();
      sub.hidden = true;
      add.hidden = false;
      draw();
    });
    if (input('current')) {
      input('current').addEventListener('change', function () {
        var end = input('end_date');
        end.disabled = input('current').checked;
        if (end.disabled) end.value = '';
      });
    }
  }
  setupGroup('education', ['school', 'field_of_study', 'degree', 'start_date', 'end_date'], 'school', function (e) {
    return [e.school, [e.degree, e.field_of_study].filter(Boolean).join(', ') + (e.start_date || e.end_date ? ' · ' + (e.start_date || '?') + ' – ' + (e.end_date || '?') : '')];
  });
  setupGroup('experience', ['title', 'company', 'industry', 'summary', 'start_date', 'end_date', 'current'], 'title', function (e) {
    return [e.title + (e.company ? ' at ' + e.company : ''), (e.start_date || '?') + ' – ' + (e.current ? 'Present' : e.end_date || '?')];
  });

  // --- Resume drop zone -------------------------------------------------------------
  var resume = $('#resume');
  var zone = $('[data-ui=resume-dropzone]');
  var resumeFile = null;
  var OK_EXT = ['pdf', 'doc', 'docx', 'odt', 'rtf'];
  function acceptResume(f) {
    if (!f) return;
    var ext = (f.name.split('.').pop() || '').toLowerCase();
    if (OK_EXT.indexOf(ext) === -1) return setError(resume, 'File type not supported');
    if (f.size > 12000000) return setError(resume, 'File is too large (max 12MB)');
    resumeFile = f;
    $('[data-ui=resume-filename]').textContent = f.name;
    setError(resume, '');
  }
  zone.addEventListener('click', function () { resume.click(); });
  zone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resume.click(); }
  });
  resume.addEventListener('change', function () { acceptResume(resume.files && resume.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) {
    zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('is-dragging'); });
  });
  zone.addEventListener('dragleave', function () { zone.classList.remove('is-dragging'); });
  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    zone.classList.remove('is-dragging');
    acceptResume(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  // --- Custom listbox dropdown (CA_ questions) --------------------------------------
  $all('.styles--select').forEach(function (wrap) {
    var btn = wrap.querySelector('.styles--select-button');
    var list = wrap.querySelector('[role=listbox]');
    var hidden = wrap.querySelector('input[type=hidden]');
    var opts = $all('[role=option]', list);
    var active = -1;
    opts.forEach(function (o, i) { o.id = list.id + '-option-' + i; });
    function paint() {
      opts.forEach(function (o, i) { o.classList.toggle('is-active', i === active); });
      if (active >= 0) btn.setAttribute('aria-activedescendant', opts[active].id);
      else btn.removeAttribute('aria-activedescendant');
    }
    function open() {
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      active = Math.max(0, opts.findIndex(function (o) { return o.getAttribute('aria-selected') === 'true'; }));
      paint();
    }
    function close() {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      active = -1;
      paint();
    }
    function choose(i) {
      opts.forEach(function (o, j) { o.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
      hidden.value = opts[i].getAttribute('data-value');
      var v = btn.querySelector('.styles--select-value');
      v.textContent = opts[i].textContent.trim();
      v.classList.remove('styles--placeholder');
      close();
      btn.focus();
    }
    btn.addEventListener('click', function () { list.hidden ? open() : close(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); else { active = Math.min(opts.length - 1, active + 1); paint(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (!list.hidden) { active = Math.max(0, active - 1); paint(); } }
      else if (e.key === 'Enter' || e.key === ' ') { if (!list.hidden && active >= 0) { e.preventDefault(); choose(active); } }
      else if (e.key === 'Escape') close();
      else if (e.key.length === 1 && /\S/.test(e.key)) {
        var k = e.key.toLowerCase();
        var hit = opts.findIndex(function (o) { return o.textContent.trim().toLowerCase().indexOf(k) === 0; });
        if (hit >= 0) { if (list.hidden) open(); active = hit; paint(); }
      }
    });
    btn.addEventListener('blur', function () { setTimeout(function () { if (!list.contains(document.activeElement)) close(); }, 150); });
    opts.forEach(function (o, i) {
      o.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
      o.addEventListener('mousemove', function () { active = i; paint(); });
    });
  });

  // --- Clear errors as the candidate fixes them -------------------------------------
  form.addEventListener('input', function (e) {
    if (e.target.getAttribute && e.target.getAttribute('aria-invalid') === 'true' && String(e.target.value || '').trim()) setError(e.target, '');
  });
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (t.type === 'radio' || t.type === 'checkbox') {
      var first = form.querySelector('[name="' + t.name + '"]');
      if (first && (t.checked || form.querySelector('[name="' + t.name + '"]:checked'))) setError(first, '');
      if (t.id === 'gdpr') setGdprError('');
    }
  });
  var gdpr = $('#gdpr');
  function setGdprError(msg) {
    var sec = $('[data-ui=gdpr]');
    var old = sec.querySelector('.styles--error');
    if (old) old.remove();
    gdpr.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) {
      var p = document.createElement('p');
      p.className = 'styles--error';
      p.setAttribute('role', 'alert');
      p.textContent = msg;
      sec.appendChild(p);
    }
  }

  // --- Submit: validate, then FormData over XMLHttpRequest ---------------------------
  var submit = $('[data-ui=apply-button]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submit.disabled) return;
    var bad = [];
    function need(el, ok, msg) {
      setError(el, ok ? '' : msg || 'This field is required');
      if (!ok) bad.push(el);
    }
    need($('#firstname'), !!$('#firstname').value.trim());
    need($('#lastname'), !!$('#lastname').value.trim());
    var em = $('#email').value.trim();
    need($('#email'), !!em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em), em ? 'Please enter a valid email address' : 'This field is required');
    need(phone, phone.value.replace(/\D/g, '').length >= 6, phone.value.trim() ? 'Please enter a valid phone number' : 'This field is required');
    need(resume, !!resumeFile);
    need($('[name=QA_9102341]'), !!form.querySelector('[name=QA_9102341]:checked'));
    need($('#QA_9102342'), !!$('#QA_9102342').value.trim());
    ['education', 'experience'].forEach(function (k) {
      var g = groups[k];
      if (!g.sub.hidden) {
        var first = g.sub.querySelector('input');
        setError(first, 'Please save or cancel this entry');
        bad.push(first);
      }
    });
    setGdprError(gdpr.checked ? '' : 'Please accept the privacy notice to continue');
    if (!gdpr.checked) bad.push(gdpr);
    if (bad.length) {
      summaryError.textContent = 'Please fix the errors below and try again.';
      summaryError.hidden = false;
      bad[0].scrollIntoView({ block: 'center' });
      if (bad[0].focus && bad[0].type !== 'file') bad[0].focus({ preventScroll: true });
      return;
    }
    summaryError.hidden = true;

    var fd = new FormData();
    fd.append('firstname', $('#firstname').value.trim());
    fd.append('lastname', $('#lastname').value.trim());
    fd.append('email', em);
    fd.append('headline', $('#headline').value.trim());
    fd.append('phone', phoneE164());
    fd.append('address', $('#address').value.trim());
    if (avatar.files && avatar.files[0]) fd.append('avatar', avatar.files[0], avatar.files[0].name);
    groups.education.entries.forEach(function (en, i) {
      ['school', 'field_of_study', 'degree', 'start_date', 'end_date'].forEach(function (k) { fd.append('education[' + i + '][' + k + ']', en[k] || ''); });
    });
    groups.experience.entries.forEach(function (en, i) {
      ['title', 'company', 'industry', 'summary', 'start_date', 'end_date'].forEach(function (k) { fd.append('experience[' + i + '][' + k + ']', en[k] || ''); });
      fd.append('experience[' + i + '][current]', en.current ? 'true' : 'false');
    });
    fd.append('summary', $('#summary').value.trim());
    fd.append('resume', resumeFile, resumeFile.name);
    fd.append('cover_letter', $('#cover_letter').value);
    fd.append('CA_18811', form.querySelector('input[name=CA_18811]').value);
    fd.append('QA_9102341', form.querySelector('[name=QA_9102341]:checked').value);
    fd.append('QA_9102342', $('#QA_9102342').value.trim());
    fd.append('gdpr', 'true');

    submit.disabled = true;
    submit.textContent = 'Submitting...';
    var xhr = new XMLHttpRequest();
    xhr.open('POST', FX.submitUrl(FORM_ID));
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    xhr.onload = function () {
      var res = null;
      try { res = JSON.parse(xhr.responseText); } catch (err) { res = null; }
      if (res && res.ok) {
        form.outerHTML = '<section class="styles--success" data-ui="application-success" role="status"><h2>Thank you!</h2><p>Your application was submitted. Brightwater Health will review it and get back to you.</p></section>';
        setTimeout(function () { FX.finish(res); }, 800);
        return;
      }
      submit.disabled = false;
      submit.textContent = 'Submit application';
      summaryError.textContent = 'Something went wrong: ' + ((res && res.errors) || ['please try again']).join('; ');
      summaryError.hidden = false;
    };
    xhr.onerror = function () {
      submit.disabled = false;
      submit.textContent = 'Submit application';
      summaryError.textContent = 'Network error. Please try again.';
      summaryError.hidden = false;
    };
    xhr.send(fd);
  });
})();

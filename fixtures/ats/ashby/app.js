/*
 * Fixture SPA for the Ashby hosted application tab. Renders the form from the
 * ApiJobPosting-shaped definition in window.__appData after a short "fetch"
 * delay (the real page shows a skeleton while it queries non-user-graphql),
 * then wires Ashby's widgets: text/email/tel inputs keyed by field path,
 * the location autocomplete combobox, file drop zones ("Upload File" or drag and
 * drop), Yes/No toggle buttons for Boolean fields, checkbox groups for
 * MultiValueSelect, radio groups for ValueSelect, "Select..." comboboxes for the
 * EEOC survey, field errors plus the "Your form needs corrections" summary,
 * and a JSON submit (files inline as base64) followed by the success view.
 */
(function () {
  'use strict';
  var app = window.__appData;
  var posting = app.posting;
  var FORM_ID = window.__FX_FORM_ID;
  var org = app.organization;
  var base = app.routerPrefix + '/' + org.hostedJobsPageSlug + '/' + posting.id;

  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var EMPLOYMENT = { FullTime: 'Full time', PartTime: 'Part time', Contract: 'Contract', Intern: 'Internship' };
  var root = document.getElementById('root');
  root.innerHTML =
    '<div class="_container_4bb1z_1">' +
    '<div class="ashby-job-posting-brand-header"><a class="_navLogo_1hd3o_5" href="' + base.replace(/\/[^/]+$/, '') + '">' + esc(org.name) + '</a></div>' +
    '<h1 class="ashby-job-posting-heading">' + esc(posting.title) + '</h1>' +
    '<div class="_content_ud4nd_71">' +
    '<div class="ashby-job-posting-left-pane _leftPane_ud4nd_37">' +
    '<div class="_section_101oc_37"><h2>Location</h2><p>' + esc(posting.locationName) + '</p></div>' +
    '<div class="_section_101oc_37"><h2>Employment Type</h2><p>' + esc(EMPLOYMENT[posting.employmentType] || posting.employmentType) + '</p></div>' +
    '<div class="_section_101oc_37"><h2>Location Type</h2><p>' + esc(posting.workplaceType) + '</p></div>' +
    '<div class="_section_101oc_37"><h2>Department</h2><p>' + esc(posting.departmentName) + '</p></div>' +
    '<div class="_section_101oc_37"><h2>Compensation</h2><p>' + esc(posting.compensationTierSummary) + '</p></div>' +
    '</div>' +
    '<div class="ashby-job-posting-right-pane _rightPane_ud4nd_45">' +
    '<div role="tablist" class="_tabs_ud4nd_9">' +
    '<a role="tab" class="_tab_ud4nd_9" id="job-overview" href="' + base + '" aria-selected="false" aria-controls="overview">Overview</a>' +
    '<a role="tab" class="_tab_ud4nd_9" id="job-application-form" href="' + base + '/application" aria-selected="true" aria-controls="form">Application</a>' +
    '</div>' +
    '<div role="tabpanel" id="overview" aria-labelledby="job-overview" hidden><div class="_descriptionText_oj0x8_198">' + posting.descriptionHtml + '</div></div>' +
    '<div role="tabpanel" id="form" aria-labelledby="job-application-form"><div class="ashby-application-form-container _container_1x2b3_1">' +
    '<div class="_skeleton_1x2b3_1"></div><div class="_skeleton_1x2b3_1" style="width:70%"></div><div class="_skeleton_1x2b3_1" style="width:85%"></div>' +
    '</div></div>' +
    '</div></div>' +
    '<div class="_footer_ud4nd_200">Powered by Ashby · <a href="#privacy">Privacy Policy</a></div>' +
    '</div>';

  // Tabs switch panels in place (the real SPA routes between /<id> and /<id>/application).
  root.querySelectorAll('[role=tab]').forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      root.querySelectorAll('[role=tab]').forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      history.replaceState(null, '', tab.getAttribute('href'));
    });
  });

  var container = root.querySelector('.ashby-application-form-container');
  var fields = []; // { entry, path, title, required, get(): value|Promise, validate(): msg }

  // ------------------------------------------------------------------------
  // Field factories
  // ------------------------------------------------------------------------
  function entryShell(fe, labelFor) {
    var f = fe.field;
    var tag = labelFor ? 'label' : 'div';
    var el = h(
      '<div class="_fieldEntry_17qhk_25 ashby-application-form-field-entry" data-field-path="' + esc(f.path) + '">' +
        '<' + tag + ' id="' + esc(f.path) + '-label" class="_heading_101oc_53' + (fe.isRequired ? ' _required_101oc_92' : '') + ' _label_1x9rf_1 ashby-application-form-question-title"' + (labelFor ? ' for="' + esc(f.path) + '"' : '') + '>' + esc(f.title) + '</' + tag + '>' +
        (fe.descriptionHtml ? '<div class="_description_1x9rf_1">' + fe.descriptionHtml + '</div>' : '') +
        '</div>'
    );
    return el;
  }
  function setFieldError(entry, msg, control) {
    var old = entry.querySelector('._fieldError_1x9rf_9');
    if (old) old.remove();
    if (control) control.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) {
      var p = h('<p class="_fieldError_1x9rf_9 ashby-application-form-field-error" role="alert"></p>');
      p.textContent = msg;
      entry.appendChild(p);
    }
  }

  function textInput(fe, type) {
    var f = fe.field;
    var entry = entryShell(fe, true);
    var placeholder = type === 'email' ? 'hello@example.com...' : type === 'tel' ? '+1 (555) 123-4567...' : 'Type here...';
    var input = h('<input class="_input_1wkz4_28" id="' + esc(f.path) + '" name="' + esc(f.path) + '" type="' + type + '" placeholder="' + placeholder + '"' + (fe.isRequired ? ' required aria-required="true"' : '') + (type === 'email' ? ' autocomplete="email"' : type === 'tel' ? ' autocomplete="tel"' : f.path === '_systemfield_name' ? ' autocomplete="name"' : '') + '>');
    entry.appendChild(input);
    input.addEventListener('input', function () { if (input.getAttribute('aria-invalid') === 'true') setFieldError(entry, '', input); });
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: input,
      get: function () { return input.value.trim(); },
      validate: function () {
        var v = input.value.trim();
        if (fe.isRequired && !v) return 'Missing entry for required field';
        if (type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address';
        return '';
      },
    });
    return entry;
  }

  function longText(fe) {
    var f = fe.field;
    var entry = entryShell(fe, true);
    var ta = h('<textarea class="_textarea_1wkz4_29" id="' + esc(f.path) + '" name="' + esc(f.path) + '" placeholder="Type here..."' + (fe.isRequired ? ' required aria-required="true"' : '') + '></textarea>');
    entry.appendChild(ta);
    ta.addEventListener('input', function () { if (ta.getAttribute('aria-invalid') === 'true') setFieldError(entry, '', ta); });
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: ta,
      get: function () { return ta.value.trim(); },
      validate: function () { return fe.isRequired && !ta.value.trim() ? 'Missing entry for required field' : ''; },
    });
    return entry;
  }

  var ICON_UPLOAD = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 16V7.8l-3.3 3.3-1.4-1.4L12 4l5.7 5.7-1.4 1.4L13 7.8V16h-2Zm-6 4v-5h2v3h10v-3h2v5H5Z"/></svg>';

  function fileInput(fe) {
    var f = fe.field;
    var entry = entryShell(fe, false);
    var zone = h(
      '<div class="_container_1y4ge_1 _dropzone_1y4ge_1" aria-labelledby="' + esc(f.path) + '-label">' +
        '<div class="_dropzoneContent_1y4ge_5">' + ICON_UPLOAD +
        '<button type="button" class="_button_8wvgw_29 _secondary_8wvgw_112"><span>Upload File</span></button><span>or drag and drop here</span></div>' +
        '<input type="file" id="' + esc(f.path) + '" name="' + esc(f.path) + '" accept=".pdf,.doc,.docx,.odt,.rtf,.txt,.pages" tabindex="-1" style="display:none">' +
        '</div>'
    );
    entry.appendChild(zone);
    var input = zone.querySelector('input');
    var content = zone.querySelector('._dropzoneContent_1y4ge_5');
    var current = null;
    function show(file) {
      current = file;
      var old = zone.querySelector('._fileName_1y4ge_20');
      if (old) old.remove();
      content.hidden = !!file;
      if (file) {
        var row = h('<div class="_fileName_1y4ge_20"><span></span><button type="button" aria-label="Remove file">Remove</button></div>');
        row.firstChild.textContent = file.name;
        row.lastChild.addEventListener('click', function () {
          input.value = '';
          show(null);
        });
        zone.appendChild(row);
        setFieldError(entry, '', zone);
      }
    }
    function accept(file) {
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) {
        setFieldError(entry, 'File is too large. The maximum size is 25MB.', zone);
        return;
      }
      show(file);
    }
    zone.querySelector('button').addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { accept(input.files && input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        zone.classList.add('_isDragging_1y4ge_12');
      });
    });
    zone.addEventListener('dragleave', function () { zone.classList.remove('_isDragging_1y4ge_12'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('_isDragging_1y4ge_12');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      try {
        var dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
      } catch (err) { /* older browsers: keep the File in state only */ }
      accept(file);
    });
    var api = {
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: zone, isFile: true,
      get: function () { return current ? FX.fileToJson(current) : null; },
      validate: function () { return fe.isRequired && !current ? 'Missing entry for required field' : ''; },
      set: function (file) { show(file); },
    };
    fields.push(api);
    return entry;
  }

  function yesNo(fe) {
    var f = fe.field;
    var entry = entryShell(fe, false);
    var group = h(
      '<div class="_yesno_1e44y_1" role="group" aria-labelledby="' + esc(f.path) + '-label" id="' + esc(f.path) + '">' +
        '<button type="button" class="_container_pjyt6_1 _option_y2cw4_33" aria-pressed="false">Yes</button>' +
        '<button type="button" class="_container_pjyt6_1 _option_y2cw4_33" aria-pressed="false">No</button>' +
        '</div>'
    );
    entry.appendChild(group);
    var value = null;
    group.querySelectorAll('button').forEach(function (b, i) {
      b.addEventListener('click', function () {
        var v = i === 0;
        value = value === v ? null : v; // clicking the active option clears it
        group.querySelectorAll('button').forEach(function (x, j) {
          var on = value !== null && (j === 0) === value;
          x.classList.toggle('_active_y2cw4_58', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (value !== null) setFieldError(entry, '', group);
      });
    });
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: group,
      get: function () { return value; },
      validate: function () { return fe.isRequired && value === null ? 'Missing entry for required field' : ''; },
    });
    return entry;
  }

  function checkboxGroup(fe) {
    var f = fe.field;
    var entry = entryShell(fe, false);
    var group = h('<div class="_checkboxGroup_1f2j3_1" role="group" aria-labelledby="' + esc(f.path) + '-label"></div>');
    f.selectableValues.forEach(function (sv, i) {
      var id = f.path + '-labeled-checkbox-' + i;
      group.appendChild(h('<div class="_option_1f2j3_10"><input type="checkbox" id="' + esc(id) + '" name="' + esc(f.path) + '" value="' + esc(sv.value) + '"><label for="' + esc(id) + '">' + esc(sv.label) + '</label></div>'));
    });
    entry.appendChild(group);
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: group,
      get: function () { return Array.prototype.map.call(group.querySelectorAll('input:checked'), function (c) { return c.value; }); },
      validate: function () { return fe.isRequired && !group.querySelector('input:checked') ? 'Missing entry for required field' : ''; },
    });
    return entry;
  }

  function radioGroup(fe) {
    var f = fe.field;
    var entry = entryShell(fe, false);
    var group = h('<div class="_radioGroup_1f2j3_2" role="radiogroup" aria-labelledby="' + esc(f.path) + '-label"></div>');
    f.selectableValues.forEach(function (sv, i) {
      var id = f.path + '-labeled-radio-' + i;
      group.appendChild(h('<div class="_option_1f2j3_10"><input type="radio" id="' + esc(id) + '" name="' + esc(f.path) + '" value="' + esc(sv.value) + '"><label for="' + esc(id) + '">' + esc(sv.label) + '</label></div>'));
    });
    entry.appendChild(group);
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: group,
      get: function () { var c = group.querySelector('input:checked'); return c ? c.value : null; },
      validate: function () { return fe.isRequired && !group.querySelector('input:checked') ? 'Missing entry for required field' : ''; },
    });
    return entry;
  }

  /** Ashby's combobox: input[role=combobox] + ul[role=listbox]; static options or an async source. */
  function combobox(fe, opts) {
    var f = fe.field;
    var entry = entryShell(fe, true);
    var listId = f.path + '-listbox';
    var wrap = h(
      '<div class="_select_k8a3d_1">' +
        '<input class="_input_1wkz4_28" id="' + esc(f.path) + '" name="' + esc(f.path) + '" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + esc(listId) + '" aria-activedescendant="" autocomplete="off" placeholder="' + esc(opts.placeholder) + '"' + (fe.isRequired ? ' aria-required="true"' : '') + '>' +
        (opts.caret ? '<span class="_caret_k8a3d_9" aria-hidden="true">▾</span>' : '') +
        '<ul class="_listbox_k8a3d_15" role="listbox" id="' + esc(listId) + '" hidden></ul>' +
        '</div>'
    );
    entry.appendChild(wrap);
    var input = wrap.querySelector('input');
    var list = wrap.querySelector('ul');
    var selected = null;
    var shown = [];
    var focus = -1;
    var timer = null;

    function render() {
      list.innerHTML = '';
      if (!shown.length) {
        list.appendChild(h('<li class="_empty_k8a3d_40">' + (opts.async && input.value.trim().length < 2 ? 'Start typing to search...' : 'No results') + '</li>'));
      }
      shown.forEach(function (o, i) {
        var li = h('<li role="option" id="' + esc(f.path) + '-option-' + i + '" aria-selected="' + (selected && selected.value === o.value ? 'true' : 'false') + '"></li>');
        li.textContent = o.label;
        if (i === focus) li.classList.add('_focused_k8a3d_31');
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
          choose(o);
        });
        li.addEventListener('mousemove', function () {
          if (focus !== i) { focus = i; render(); }
        });
        list.appendChild(li);
      });
      input.setAttribute('aria-activedescendant', focus >= 0 && shown[focus] ? f.path + '-option-' + focus : '');
    }
    function open() {
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      render();
    }
    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-activedescendant', '');
      focus = -1;
    }
    function choose(o) {
      selected = o;
      input.value = o.label;
      close();
      setFieldError(entry, '', input);
    }
    function filter() {
      var q = input.value.trim().toLowerCase();
      if (opts.async) {
        clearTimeout(timer);
        shown = [];
        list.innerHTML = '<li class="_empty_k8a3d_40">Searching...</li>';
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        timer = setTimeout(function () {
          shown = q.length < 2 ? [] : opts.source.filter(function (o) { return o.label.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
          focus = shown.length ? 0 : -1;
          render();
        }, 250);
        return;
      }
      shown = opts.source.filter(function (o) { return !q || o.label.toLowerCase().indexOf(q) !== -1; });
      focus = shown.length ? 0 : -1;
      open();
    }
    input.addEventListener('focus', function () {
      if (!opts.async) {
        shown = opts.source.slice();
        focus = selected ? shown.indexOf(selected) : -1;
        open();
      }
    });
    input.addEventListener('click', function () {
      if (!opts.async && list.hidden) {
        shown = opts.source.slice();
        open();
      }
    });
    input.addEventListener('input', function () {
      if (selected && input.value !== selected.label) selected = null;
      filter();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (list.hidden) { shown = opts.async ? shown : opts.source.slice(); open(); }
        if (shown.length) { focus = (focus + 1) % shown.length; render(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) { focus = (focus - 1 + shown.length) % shown.length; render(); }
      } else if (e.key === 'Enter') {
        if (!list.hidden && shown[focus]) {
          e.preventDefault();
          choose(shown[focus]);
        }
      } else if (e.key === 'Escape') {
        close();
      }
    });
    input.addEventListener('blur', function () {
      close();
      // Free text that doesn't match the chosen option snaps back to the selection.
      if (!opts.async) input.value = selected ? selected.label : '';
    });
    fields.push({
      entry: entry, path: f.path, title: f.title, required: fe.isRequired, control: input,
      get: function () { return selected ? selected.value : null; },
      validate: function () {
        if (opts.async && input.value.trim() && !selected) return 'Please select a location from the list';
        return fe.isRequired && !selected ? 'Missing entry for required field' : '';
      },
    });
    return entry;
  }

  var LOCATIONS = [
    'Lahore, Punjab, Pakistan', 'Lahore Cantonment, Punjab, Pakistan', 'Karachi, Sindh, Pakistan', 'Islamabad, Pakistan',
    'Faisalabad, Punjab, Pakistan', 'Lagos, Nigeria', 'London, England, United Kingdom', 'Dubai, United Arab Emirates', 'Berlin, Germany', 'Toronto, Ontario, Canada',
  ].map(function (l) { return { label: l, value: l }; });

  function render(fe, inSurvey) {
    var f = fe.field;
    switch (f.type) {
      case 'String': return textInput(fe, 'text');
      case 'Email': return textInput(fe, 'email');
      case 'Phone': return textInput(fe, 'tel');
      case 'LongText': return longText(fe);
      case 'File': return fileInput(fe);
      case 'Boolean': return yesNo(fe);
      case 'MultiValueSelect': return checkboxGroup(fe);
      case 'Location': return combobox(fe, { placeholder: 'Start typing...', async: true, source: LOCATIONS });
      case 'ValueSelect':
        if (inSurvey || f.selectableValues.length > 6) return combobox(fe, { placeholder: 'Select...', caret: true, source: f.selectableValues });
        return radioGroup(fe);
    }
    return null;
  }

  // ------------------------------------------------------------------------
  // "Fetch" the form definition, then render it
  // ------------------------------------------------------------------------
  setTimeout(function () {
    container.innerHTML = '';
    var autofill = h(
      '<div class="ashby-application-form-autofill-pane _autofillPane_1x2b3_20"><div class="ashby-application-form-autofill-input-root">' +
        '<p class="_title_">Autofill from resume</p><p class="_description_">Upload your resume here to autofill key application fields.</p>' +
        '<button type="button" class="_button_8wvgw_29 _secondary_8wvgw_112 ashby-application-form-autofill-input-button">Upload file</button>' +
        '<input type="file" class="ashby-application-form-autofill-input" accept=".pdf,.doc,.docx,.odt,.rtf,.txt" tabindex="-1" style="display:none">' +
        '<p class="_status_" role="status"></p></div></div>'
    );
    container.appendChild(autofill);
    posting.applicationForm.sections.forEach(function (sec) {
      var s = h('<div class="ashby-application-form-section-container _section_1x2b3_30"></div>');
      if (sec.title) s.appendChild(h('<h3>' + esc(sec.title) + '</h3>'));
      sec.fieldEntries.forEach(function (fe) {
        var el = render(fe, false);
        if (el) s.appendChild(el);
      });
      container.appendChild(s);
    });
    (posting.surveyForms || []).forEach(function (sf) {
      var s = h('<div class="ashby-survey-form-container ashby-application-form-section-container"><h3>' + esc(sf.title) + '</h3><div class="_surveyDescription_">' + sf.descriptionHtml + '</div></div>');
      sf.sections.forEach(function (sec) {
        sec.fieldEntries.forEach(function (fe) {
          var el = render(fe, true);
          if (el) s.appendChild(el);
        });
      });
      container.appendChild(s);
    });
    var errors = h('<div class="_errors_1x2b3_9" role="alert" hidden></div>');
    container.appendChild(errors);
    var submit = h('<button type="submit" class="_button_8wvgw_29 _primary_8wvgw_96 ashby-application-form-submit-button">Submit Application</button>');
    container.appendChild(submit);

    // Autofill pane: the uploaded file becomes the Resume answer (field parsing is server-side in Ashby).
    var afBtn = autofill.querySelector('button');
    var afInput = autofill.querySelector('input');
    var afStatus = autofill.querySelector('._status_');
    afBtn.addEventListener('click', function () { afInput.click(); });
    afInput.addEventListener('change', function () {
      var file = afInput.files && afInput.files[0];
      if (!file) return;
      afStatus.textContent = 'Autofilling from ' + file.name + '...';
      setTimeout(function () {
        var resume = fields.filter(function (x) { return x.path === '_systemfield_resume'; })[0];
        if (resume) resume.set(file);
        afStatus.textContent = 'We added your resume. Please review the fields below.';
      }, 600);
    });

    submit.addEventListener('click', async function () {
      if (submit.disabled) return;
      var problems = [];
      fields.forEach(function (fl) {
        var msg = fl.validate();
        setFieldError(fl.entry, msg, fl.control);
        if (msg) problems.push(msg === 'Missing entry for required field' ? 'Missing entry for required field: ' + fl.title : fl.title + ': ' + msg);
      });
      if (problems.length) {
        errors.innerHTML = '<strong>Your form needs corrections</strong><ul></ul>';
        problems.forEach(function (p) {
          var li = document.createElement('li');
          li.textContent = p;
          errors.querySelector('ul').appendChild(li);
        });
        errors.hidden = false;
        var first = fields.filter(function (fl) { return fl.entry.querySelector('._fieldError_1x9rf_9'); })[0];
        if (first) first.entry.scrollIntoView({ block: 'center' });
        return;
      }
      errors.hidden = true;
      submit.disabled = true;
      submit.textContent = 'Submitting...';
      var body = { jobPostingId: posting.id, organizationHostedJobsPageName: org.hostedJobsPageSlug, applicationFormId: posting.applicationForm.id };
      for (var i = 0; i < fields.length; i++) {
        var v = await fields[i].get();
        if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        body[fields[i].path] = v;
      }
      var result;
      try {
        result = await FX.postJson(FORM_ID, body);
      } catch (e) {
        result = { ok: false, errors: ['network error'] };
      }
      if (!result || !result.ok) {
        submit.disabled = false;
        submit.textContent = 'Submit Application';
        errors.innerHTML = '<strong>Something went wrong</strong><ul><li></li></ul>';
        errors.querySelector('li').textContent = ((result && result.errors) || []).join('; ') || 'Please try again.';
        errors.hidden = false;
        return;
      }
      container.innerHTML =
        '<div class="ashby-application-form-success-container _successContainer_1x2b3_60">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" aria-hidden="true"><path fill="#16a34a" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7Z"/></svg>' +
        '<h2 class="_title_1x2b3_70">Thank you for applying</h2>' +
        '<p>Your application was successfully submitted. We\'ll contact you if there are next steps.</p></div>';
      setTimeout(function () { FX.finish(result); }, 1200);
    });
  }, 400);
})();

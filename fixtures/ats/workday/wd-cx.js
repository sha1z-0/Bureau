/*
 * Workday candidate experience replica (single-page app).
 * Fictional tenant "atlasmutual" (wd5), site "AtlasCareers". Local fixture only.
 *
 * Views: job posting -> "Start Your Application" dialog -> Create Account /
 * Sign In / Verify Your Account -> Autofill with Resume (upload + parse) ->
 * six-step wizard (My Information, My Experience, Application Questions,
 * Voluntary Disclosures, Self Identify, Review) -> confirmation / candidate home.
 *
 * Every "Save and Continue" validates the page, then POSTs the page's values to
 * /__submit/<formId>/<step> (recorded as a step save) and stores a draft on the
 * fixture server. "Submit" POSTs the whole application, flat keys named after
 * the widgets' data-automation-ids plus the resume file, to /__submit/<formId>.
 */
(function () {
  'use strict';

  var CFG = window.WD_CONFIG;
  var HOST = '/atlasmutual.wd5.myworkdayjobs.com';
  var SITE = HOST + '/en-US/AtlasCareers';
  var JOB_URL = SITE + '/job/' + CFG.jobPath;
  var AUTH = HOST + '/wday/authgwy/atlasmutual';
  var CXS = HOST + '/wday/cxs/atlasmutual/AtlasCareers';
  var REQ = CFG.jobReqId;
  var root = document.getElementById('root');
  var popLayer = document.getElementById('wd-popups');
  var uid = 0;
  function nextId(p) { uid += 1; return (p || 'wd') + '-' + uid; }

  // ------------------------------------------------------------------ catalogs
  var COUNTRIES = [
    ['Australia', '+61'], ['Bangladesh', '+880'], ['Canada', '+1'], ['China', '+86'], ['Egypt', '+20'], ['France', '+33'],
    ['Germany', '+49'], ['India', '+91'], ['Indonesia', '+62'], ['Ireland', '+353'], ['Malaysia', '+60'], ['Netherlands', '+31'],
    ['New Zealand', '+64'], ['Nigeria', '+234'], ['Oman', '+968'], ['Pakistan', '+92'], ['Philippines', '+63'], ['Qatar', '+974'],
    ['Saudi Arabia', '+966'], ['Singapore', '+65'], ['Sri Lanka', '+94'], ['Türkiye', '+90'], ['United Arab Emirates', '+971'],
    ['United Kingdom', '+44'], ['United States of America', '+1']
  ];
  var REGIONS = {
    'Pakistan': { label: 'Province or Territory', list: ['Azad Jammu and Kashmir', 'Balochistan', 'Gilgit-Baltistan', 'Islamabad Capital Territory', 'Khyber Pakhtunkhwa', 'Punjab', 'Sindh'] },
    'United States of America': { label: 'State', list: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'] },
    'India': { label: 'State', list: ['Delhi', 'Gujarat', 'Karnataka', 'Kerala', 'Maharashtra', 'Punjab', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'West Bengal'] },
    'Canada': { label: 'Province or Territory', list: ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Nova Scotia', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan'] },
    'United Kingdom': { label: 'County', list: ['England', 'Northern Ireland', 'Scotland', 'Wales'] },
    'Australia': { label: 'State', list: ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'] }
  };
  var SOURCE_TREE = [
    { label: 'Job Board', children: ['LinkedIn', 'Indeed', 'Glassdoor', 'Rozee.pk', 'Other Job Board'] },
    { label: 'Social Media', children: ['Facebook', 'Instagram', 'X (formerly Twitter)', 'YouTube'] },
    { label: 'Atlas Mutual Careers Website' },
    { label: 'Employee Referral' },
    { label: 'Career Fair or University Event' },
    { label: 'Recruiter Outreach', children: ['Atlas Mutual Recruiter', 'Staffing Agency'] },
    { label: 'Other' }
  ];
  var SCHOOLS = [
    'Air University', 'Bahria University', 'COMSATS University Islamabad', 'FAST National University of Computer and Emerging Sciences',
    'Forman Christian College', 'Government College University Lahore', 'Information Technology University', 'Lahore Institute of Computing',
    'Lahore University of Management Sciences', 'National University of Sciences and Technology', 'University of Central Punjab',
    'University of Engineering and Technology, Lahore', 'University of the Punjab', 'University of Karachi', 'Virtual University of Pakistan',
    'Other'
  ];
  var FIELDS_OF_STUDY = [
    'Accounting', 'Business Administration', 'Computer Engineering', 'Computer Science', 'Data Science', 'Economics', 'Electrical Engineering',
    'Finance', 'Information Systems', 'Information Technology', 'Mathematics', 'Mechanical Engineering', 'Physics', 'Software Engineering',
    'Statistics', 'Other'
  ];
  var DEGREES = ['High School Diploma', 'Associate Degree', 'Bachelor of Arts', 'Bachelor of Engineering', 'Bachelor of Science', 'Bachelors Degree', 'Master of Business Administration', 'Master of Science', 'Masters Degree', 'Doctorate (PhD)', 'Other'];
  var SKILLS = [
    'Agile Methodologies', 'Amazon Web Services (AWS)', 'Angular', 'Bash', 'Burp Suite', 'C', 'C#', 'C++', 'CSS', 'Continuous Integration', 'Data Analysis',
    'Django', 'Docker', 'Docker Compose', 'Express.js', 'Fastify', 'Git', 'GitHub', 'Go', 'GraphQL', 'HTML', 'Java', 'JavaScript', 'Jest', 'Jira',
    'Kubernetes', 'Leaflet', 'Linux', 'Microsoft Excel', 'MongoDB', 'MySQL', 'Next.js', 'Node.js', 'PHP', 'PostgreSQL', 'Python', 'pytest',
    'React', 'React Native', 'Redis', 'REST APIs', 'Ruby', 'Rust', 'SQL', 'SQLite', 'Spring Boot', 'Tableau', 'Terraform', 'TypeScript',
    'Unit Testing', 'Vue.js'
  ];
  var DEVICE_TYPES = ['Home', 'Mobile', 'Work'];
  var YES_NO = ['Yes', 'No'];
  var NOTICE = ['Immediately', '1 week', '2 weeks', '1 month', '2 months', '3 months or more'];
  var GENDERS = ['Female', 'Male', 'Non-Binary', 'I do not wish to self-identify'];
  var ETHNICITIES = [
    'American Indian or Alaska Native (United States of America)', 'Asian (United States of America)',
    'Black or African American (United States of America)', 'Hispanic or Latino (United States of America)',
    'Native Hawaiian or Other Pacific Islander (United States of America)', 'Two or More Races (United States of America)',
    'White (United States of America)', 'I do not wish to self-identify (United States of America)'
  ];
  var VETERAN = ['I am not a protected veteran', 'I identify as one or more of the classifications of protected veteran', "I don't wish to answer"];
  var DISABILITY = [
    'Yes, I have a disability, or have had one in the past',
    'No, I do not have a disability and have not had one in the past',
    'I do not want to answer'
  ];
  var QUESTIONS = [
    { id: '6f3b2d9a41c84e0b9d7a5c1e8f2b4a60', type: 'select', options: YES_NO, label: 'Are you legally authorized to work in Pakistan?' },
    { id: 'a2c94e17b85d4f3c9e6a0b7d1c5f8e29', type: 'select', options: YES_NO, label: 'Will you now or in the future require sponsorship for employment visa status?' },
    { id: '0d8e5b3a7c264f19b1e4a9c6d2f70b85', type: 'select', options: YES_NO, label: 'Are you at least 18 years of age?' },
    { id: 'c71f4a28e9b54d06a3f8b2e5d1c9a746', type: 'select', options: YES_NO, label: 'Have you previously been employed by Atlas Mutual or any of its subsidiaries?' },
    { id: '9e2b6d41f07a4c8eb5d3a1f6c8e20b97', type: 'text', label: 'What is your desired annual salary (USD)?' },
    { id: '4b8a1c6e2d9f4e70a6b3c5d8e1f2a947', type: 'select', options: NOTICE, label: 'What is your notice period?' }
  ];
  var STEPS = [
    { id: 'my-information', title: 'My Information', aid: 'applyFlowMyInfoPage' },
    { id: 'my-experience', title: 'My Experience', aid: 'applyFlowMyExpPage' },
    { id: 'application-questions', title: 'Application Questions', aid: 'applyFlowPrimaryQuestionsPage' },
    { id: 'voluntary-disclosures', title: 'Voluntary Disclosures', aid: 'applyFlowVoluntaryDisclosuresPage' },
    { id: 'self-identify', title: 'Self Identify', aid: 'applyFlowSelfIdentifyPage' },
    { id: 'review', title: 'Review', aid: 'applyFlowReviewPage' }
  ];

  function leafTree(list) { return list.map(function (x) { return { label: x, value: x }; }); }
  function buildSourceTree() {
    return SOURCE_TREE.map(function (n) {
      if (!n.children) return { label: n.label, value: n.label };
      return { label: n.label, children: n.children.map(function (c) { return { label: c, value: n.label + ' > ' + c }; }) };
    });
  }
  var PHONE_TREE = COUNTRIES.map(function (c) { var l = c[0] + ' (' + c[1] + ')'; return { label: l, value: l }; });

  // ------------------------------------------------------------------ DOM helpers
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function pad2(n) { n = String(n); return n.length === 1 ? '0' + n : n; }
  function todayParts() { var d = new Date(); return { M: pad2(d.getMonth() + 1), D: pad2(d.getDate()), Y: String(d.getFullYear()) }; }

  // ------------------------------------------------------------------ API
  function csrf() { var m = document.cookie.match(/(?:^|;\s*)CALYPSO_CSRF_TOKEN=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
  async function api(method, url, body) {
    var opts = { method: method, credentials: 'include', headers: { accept: 'application/json', 'x-calypso-csrf-token': csrf() } };
    if (typeof FormData !== 'undefined' && body instanceof FormData) opts.body = body;
    else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
    var res;
    try { res = await fetch(url, opts); } catch (e) { return { ok: false, status: 0, data: { errors: [{ message: 'Unable to reach Workday. Check your connection and try again.' }] } }; }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // ------------------------------------------------------------------ state
  var S = {
    session: null,
    job: null,
    mode: null,
    view: null,
    step: 0,
    maxStep: 0,
    v: {},
    work: [],
    edu: [],
    web: [],
    skills: [],
    resume: null,
    resumeFile: null,
    uploading: false,
    parse: null,
    notice: null,
    auth: { email: '', password: '', verifyPassword: '', terms: false, pendingEmail: '', masked: '' }
  };
  var busy = false;

  function resetApplication() {
    var t = S.session ? S.session.email : '';
    S.v = {
      source: [], candidateIsPreviousWorker: '', 'previousWorker--employeeId': '', countryDropdown: 'United States of America',
      legalNameSection_firstName: '', legalNameSection_middleName: '', legalNameSection_lastName: '', preferredNameCheckbox: false,
      preferredNameSection_firstName: '', preferredNameSection_lastName: '',
      addressSection_addressLine1: '', addressSection_addressLine2: '', addressSection_city: '', addressSection_countryRegion: '', addressSection_postalCode: '',
      email: t, 'phone-device-type': '', 'country-phone-code': [], 'phone-number': '', 'phone-extension': '',
      linkedinQuestion: '',
      gender: '', ethnicityDropdown: '', veteranStatus: '', agreementCheckbox: false,
      'selfIdentifiedDisabilityData--name': '', 'selfIdentifiedDisabilityData--employeeId': '', 'selfIdentifiedDisabilityData--disabilityStatus': '',
      'selfIdentifiedDisabilityData--dateSignedOn::M': '', 'selfIdentifiedDisabilityData--dateSignedOn::D': '', 'selfIdentifiedDisabilityData--dateSignedOn::Y': ''
    };
    QUESTIONS.forEach(function (q) { S.v['primaryQuestionnaire--' + q.id] = ''; });
    S.work = []; S.edu = []; S.web = []; S.skills = [];
    S.resume = null; S.resumeFile = null; S.parse = null;
    S.step = 0; S.maxStep = 0;
  }
  function emptyWork() { return { jobTitle: '', company: '', location: '', currentlyWorkHere: false, startMonth: '', startYear: '', endMonth: '', endYear: '', roleDescription: '' }; }
  function emptyEdu() { return { school: [], degree: '', fieldOfStudy: [], gradeAverage: '', firstYearAttended: '', lastYearAttended: '' }; }
  function serialize() {
    return { mode: S.mode, step: S.step, maxStep: S.maxStep, v: S.v, work: S.work, edu: S.edu, web: S.web, skills: S.skills, resume: S.resume };
  }
  function restore(d) {
    resetApplication();
    S.mode = d.mode || S.mode;
    S.step = d.step || 0; S.maxStep = d.maxStep || S.step;
    Object.keys(d.v || {}).forEach(function (k) { S.v[k] = d.v[k]; });
    S.v.email = S.session ? S.session.email : S.v.email;
    S.work = d.work || []; S.edu = d.edu || []; S.web = d.web || []; S.skills = d.skills || [];
    S.resume = d.resume || null; S.resumeFile = null;
  }
  async function saveDraft() {
    if (!S.session) return;
    await api('PUT', CXS + '/applications/' + REQ + '/draft', { data: serialize() });
  }

  // ------------------------------------------------------------------ popups
  var POP = null;
  function positionPopup(el, anchor) {
    var r = anchor.getBoundingClientRect();
    el.style.left = (r.left + window.scrollX) + 'px';
    el.style.top = (r.bottom + window.scrollY + 2) + 'px';
    el.style.minWidth = Math.max(r.width, 220) + 'px';
  }
  function openPopup(anchor, content, opts) {
    closePopup();
    opts = opts || {};
    var el = h('div', { class: 'wd-popup', 'data-automation-widget': 'wd-popup', 'data-associated-widget': anchor.id || null, 'data-automation-id': opts.aid || null }, content);
    popLayer.appendChild(el);
    positionPopup(el, anchor);
    var expander = opts.expander || anchor;
    expander.setAttribute('aria-expanded', 'true');
    POP = { el: el, anchor: anchor, expander: expander, onClose: opts.onClose };
    return el;
  }
  function closePopup() {
    if (!POP) return;
    var p = POP;
    POP = null;
    p.el.remove();
    p.expander.setAttribute('aria-expanded', 'false');
    if (p.onClose) p.onClose();
  }
  function popupOpenFor(anchor) { return !!POP && POP.anchor === anchor; }
  document.addEventListener('mousedown', function (e) {
    if (POP && !POP.el.contains(e.target) && !POP.anchor.contains(e.target)) closePopup();
  }, true);
  window.addEventListener('resize', function () { if (POP) positionPopup(POP.el, POP.anchor); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && POP) { var a = POP.expander; closePopup(); if (a && a.focus) a.focus(); }
  });

  // ------------------------------------------------------------------ field registry + validation
  var FIELDS = [];
  function REQ_MSG(label) { return 'The field ' + label + ' is required and must have a value.'; }
  function reg(d) { FIELDS.push(d); return d; }
  function evaluate(d) {
    if (d.required && d.empty()) return REQ_MSG(d.label);
    if (!d.empty() && d.check) return d.check() || null;
    if (d.empty() && d.checkEmpty) return d.checkEmpty() || null;
    return null;
  }
  function paintError(d, msgs) {
    if (typeof msgs === 'string') msgs = [msgs];
    msgs = (msgs || []).filter(Boolean);
    var old = d.wrap.querySelectorAll(':scope > .wd-error');
    Array.prototype.forEach.call(old, function (x) { x.remove(); });
    d.wrap.classList.toggle('wd-has-error', msgs.length > 0);
    var controls = d.wrap.querySelectorAll('input:not([type=file]), textarea, button[aria-haspopup=listbox]');
    var errId = d.wrap.getAttribute('data-fkey') ? 'error-' + d.wrap.getAttribute('data-fkey').replace(/[^\w-]/g, '_') : nextId('error');
    Array.prototype.forEach.call(controls, function (c) {
      if (msgs.length) { c.setAttribute('aria-invalid', 'true'); c.setAttribute('aria-describedby', errId); }
      else { c.removeAttribute('aria-invalid'); c.removeAttribute('aria-describedby'); }
    });
    if (!msgs.length) return;
    var box = h('div', { class: 'wd-error', 'data-automation-id': 'errorMessage', role: 'alert', id: errId });
    msgs.forEach(function (m) { box.appendChild(h('p', null, h('span', { class: 'wd-sr' }, 'Error: '), m)); });
    d.wrap.appendChild(box);
  }
  function errorFields() { return FIELDS.filter(function (d) { return d.wrap.isConnected && d.wrap.classList.contains('wd-has-error'); }); }
  function paintBanner(items) {
    var slot = document.getElementById('wd-banner-slot');
    if (!slot) return;
    slot.innerHTML = '';
    if (!items.length) return;
    var list = h('ul', { 'data-automation-id': 'errorWidgetBarMessages', hidden: true });
    items.forEach(function (it) {
      list.appendChild(h('li', null, h('button', { type: 'button', 'data-automation-id': 'errorLink', onclick: function () { if (it.focus) it.focus(); } }, it.label ? it.label + ': ' + it.msg : it.msg)));
    });
    var toggle = h('button', { type: 'button', 'data-automation-id': 'errorWidgetBarCollapsedButton', 'aria-expanded': 'false', onclick: function () {
      var open = list.hasAttribute('hidden');
      if (open) list.removeAttribute('hidden'); else list.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    } }, h('span', null, 'Errors Found'), h('span', { class: 'wd-count', 'data-automation-id': 'errorCount' }, String(items.length)));
    slot.appendChild(h('div', { class: 'wd-banner', 'data-automation-id': 'errorBanner', role: 'alert', tabindex: '-1' }, toggle, list));
  }
  function refreshBanner() {
    var slot = document.getElementById('wd-banner-slot');
    if (!slot || !slot.querySelector('[data-automation-id=errorBanner]')) return;
    paintBanner(errorFields().map(function (d) {
      var m = d.wrap.querySelector('[data-automation-id=errorMessage] p');
      return { label: d.label, msg: m ? m.textContent.replace(/^Error: /, '') : '', focus: d.focus };
    }));
  }
  function touched(d) {
    if (!d || !d.wrap.classList.contains('wd-has-error')) return;
    paintError(d, evaluate(d));
    refreshBanner();
  }
  function validatePage() {
    var items = [];
    FIELDS.forEach(function (d) {
      if (!d.wrap.isConnected) return;
      var msg = evaluate(d);
      paintError(d, msg);
      if (msg) items.push({ label: d.label, msg: msg, focus: d.focus });
    });
    paintBanner(items);
    if (items.length) {
      var b = document.querySelector('[data-automation-id=errorBanner]');
      if (b) { b.focus(); window.scrollTo(0, 0); }
    }
    return items.length === 0;
  }
  function infoBanner(text, aid) {
    var slot = document.getElementById('wd-banner-slot');
    if (!slot) return;
    slot.innerHTML = '';
    slot.appendChild(h('div', { class: 'wd-banner', 'data-automation-id': aid || 'errorBanner', role: 'alert' }, h('p', { style: 'margin:0' }, text)));
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------ widgets
  function labelEl(o, forId) {
    return h(forId ? 'label' : 'div', { class: forId ? null : 'wd-label', for: forId || null, id: o.labelId || null, 'data-automation-id': 'formLabel' },
      o.label, o.required ? h('abbr', { title: 'required' }, '*') : null);
  }
  function fieldWrap(o, control, forId) {
    var wrap = h('div', { class: 'wd-field' + (o.wide ? ' wd-wide' : ''), 'data-automation-id': o.wrapAid || ('formField-' + o.aid), 'data-fkey': o.key });
    wrap.appendChild(labelEl(o, forId));
    append(wrap, control);
    if (o.hint) wrap.appendChild(h('div', { class: 'wd-hint' }, o.hint));
    return wrap;
  }

  /** Plain text input / textarea. */
  function textField(o) {
    var id = o.id || o.key;
    var input = h(o.multiline ? 'textarea' : 'input', {
      class: 'wd-input', id: id, name: o.name || null, type: o.multiline ? null : (o.type || 'text'), 'data-automation-id': o.aid,
      'aria-required': o.required ? 'true' : null, readonly: o.readOnly || null, 'aria-readonly': o.readOnly ? 'true' : null,
      autocomplete: o.autocomplete || 'off', maxlength: o.maxlength || null, inputmode: o.inputmode || null
    });
    input.value = o.get() || '';
    var d;
    // Errors clear while typing (not on blur, so the layout never shifts under the next click).
    input.addEventListener('input', function () { o.set(input.value); touched(d); });
    input.addEventListener('change', function () { o.set(input.value); });
    if (o.onEnter) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); o.set(input.value); o.onEnter(); } });
    var wrap = fieldWrap(o, input, id);
    d = reg({ key: o.key, label: o.label, wrap: wrap, required: o.required, check: o.check,
      empty: function () { return !String(o.get() || '').trim(); }, focus: function () { input.focus(); } });
    return wrap;
  }

  /** Workday "select": a button that opens a listbox popup of options. */
  function openListbox(btn, options, current, pick) {
    var ul = h('ul', { role: 'listbox', tabindex: '-1', id: btn.id + '-listbox', 'aria-labelledby': btn.id });
    var items = options.map(function (opt, i) {
      var li = h('li', { role: 'option', id: btn.id + '-option-' + i, 'aria-selected': opt === current ? 'true' : 'false', 'data-value': opt, tabindex: '-1' },
        h('div', { 'data-automation-id': 'promptOption', 'data-automation-label': opt }, opt));
      li.addEventListener('click', function () { closePopup(); pick(opt); });
      return li;
    });
    items.forEach(function (li) { ul.appendChild(li); });
    openPopup(btn, ul, { aid: 'selectWidget-popup' });
    btn.setAttribute('aria-controls', ul.id);
    var active = Math.max(0, options.indexOf(current));
    var typed = '';
    var typedAt = 0;
    function setActive(i) {
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach(function (li, j) { li.classList.toggle('wd-active', j === active); });
      ul.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    }
    setActive(active);
    ul.focus();
    ul.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); var v = options[active]; closePopup(); pick(v); }
      else if (e.key === 'Escape') { e.preventDefault(); closePopup(); btn.focus(); }
      else if (e.key === 'Tab') { closePopup(); }
      else if (e.key.length === 1) {
        var now = Date.now();
        typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
        typedAt = now;
        for (var k = 0; k < options.length; k++) {
          if (options[k].toLowerCase().indexOf(typed) === 0) { setActive(k); break; }
        }
      }
    });
  }
  function selectField(o) {
    var id = o.id || o.key;
    var btn = h('button', { type: 'button', class: 'wd-select-btn', id: id, name: o.name || null, 'data-automation-id': o.aid || null, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-required': o.required ? 'true' : null });
    var d;
    function options() { return typeof o.options === 'function' ? o.options() : o.options; }
    function paint() {
      var v = o.get() || '';
      btn.textContent = v || 'Select One';
      btn.setAttribute('value', v);
      btn.setAttribute('aria-label', o.label + ' ' + (v || 'Select One') + (o.required ? ' Required' : ''));
    }
    paint();
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (popupOpenFor(btn)) { closePopup(); return; }
      openListbox(btn, options(), o.get(), function (val) {
        var changed = val !== o.get();
        o.set(val); paint(); btn.focus(); touched(d);
        if (changed && o.onChange) o.onChange(val);
      });
    });
    btn.addEventListener('keydown', function (e) {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !popupOpenFor(btn)) { e.preventDefault(); btn.click(); }
    });
    var wrap = fieldWrap(o, btn, id);
    d = reg({ key: o.key, label: o.label, wrap: wrap, required: o.required, check: o.check,
      empty: function () { return !o.get(); }, focus: function () { btn.focus(); } });
    return wrap;
  }

  /** Workday "prompt": search box + (multi-level) option list, selections shown as pills. */
  function promptField(o) {
    var id = o.id || o.key;
    var box = h('div', { class: 'wd-prompt', 'data-automation-id': 'multiselectInputContainer', id: id + '-container' });
    var pills = h('ul', { class: 'wd-pills', 'data-automation-id': 'selectedItemList', role: 'listbox', 'aria-label': 'items selected', 'aria-orientation': 'horizontal' });
    var input = h('input', { type: 'text', id: id, 'data-automation-id': o.inputAid || 'searchBox', 'data-uxi-widget-type': 'selectinput', placeholder: 'Search',
      autocomplete: 'off', role: 'combobox', 'aria-expanded': 'false', 'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', 'aria-required': o.required ? 'true' : null });
    var icon = h('button', { type: 'button', class: 'wd-prompt-icon', 'data-automation-id': 'promptIcon', 'aria-label': 'Open ' + o.label + ' options', tabindex: '-1' }, '☰');
    box.appendChild(pills); box.appendChild(input); box.appendChild(icon);
    var tree = typeof o.tree === 'function' ? o.tree() : o.tree;
    var nav = [];
    var results = null;
    var query = '';
    var listEl = null;
    var rows = [];
    var active = -1;
    var d;
    function leaves(nodes, out) {
      nodes.forEach(function (n) { if (n.children) leaves(n.children, out); else out.push(n); });
      return out;
    }
    function isSelected(n) { return o.get().some(function (x) { return x.value === n.value; }); }
    function paintPills() {
      pills.innerHTML = '';
      o.get().forEach(function (item, i) {
        pills.appendChild(h('li', { class: 'wd-pill', 'data-automation-id': 'selectedItem', title: item.label, role: 'option', 'aria-selected': 'true', 'data-value': item.value },
          h('p', { 'data-automation-id': 'promptSelectionLabel' }, item.label),
          h('button', { type: 'button', 'data-automation-id': 'DELETE_charm', 'aria-label': 'Delete ' + item.label, tabindex: '-1', onclick: function (e) {
            e.preventDefault(); e.stopPropagation();
            var arr = o.get().slice(); arr.splice(i, 1); o.set(arr); paintPills(); touched(d);
            if (popupOpenFor(box)) renderList();
          } }, '×')));
      });
    }
    function setActive(i) {
      if (!rows.length) { active = -1; return; }
      active = (i + rows.length) % rows.length;
      rows.forEach(function (r, j) { r.classList.toggle('wd-active', j === active); });
      input.setAttribute('aria-activedescendant', rows[active].id);
      rows[active].scrollIntoView({ block: 'nearest' });
    }
    function renderList() {
      if (!listEl) return;
      listEl.innerHTML = '';
      rows = []; active = -1;
      if (results) {
        listEl.appendChild(h('div', { class: 'wd-prompt-back', 'data-automation-id': 'promptBackButton', role: 'button', tabindex: '-1', onclick: function () { results = null; query = ''; renderList(); } },
          '‹ ', results.length + (results.length === 1 ? ' result' : ' results') + ' for "' + query + '"'));
      } else if (nav.length) {
        listEl.appendChild(h('div', { class: 'wd-prompt-back', 'data-automation-id': 'promptBackButton', role: 'button', tabindex: '-1', onclick: function () { nav.pop(); renderList(); } },
          '‹ ', nav[nav.length - 1].label));
      }
      var nodes = results || (nav.length ? nav[nav.length - 1].children : tree);
      if (!nodes.length) listEl.appendChild(h('div', { class: 'wd-prompt-empty', 'data-automation-id': 'promptNoItems' }, 'No Items.'));
      nodes.forEach(function (n, i) {
        var sel = !n.children && isSelected(n);
        var row = h('div', { class: 'wd-prompt-row', role: 'option', id: id + '-option-' + i, 'data-automation-id': n.children ? 'promptCategory' : 'promptLeafNode',
          'aria-selected': sel ? 'true' : 'false', 'aria-haspopup': n.children ? 'true' : null, tabindex: '-1' });
        if (!n.children) row.appendChild(h('input', { type: o.multi ? 'checkbox' : 'radio', tabindex: '-1', 'aria-hidden': 'true', checked: sel, 'data-automation-id': o.multi ? 'checkboxPanel' : 'radioBtn' }));
        row.appendChild(h('div', { 'data-automation-id': 'promptOption', 'data-automation-label': n.label, id: id + '-option-' + i + '-label' }, n.label));
        if (n.children) row.appendChild(h('span', { class: 'wd-chev', 'aria-hidden': 'true' }, '›'));
        row.addEventListener('click', function (e) { e.preventDefault(); activate(n); });
        rows.push(row);
        listEl.appendChild(row);
      });
    }
    function activate(n) {
      if (n.children) { nav.push(n); results = null; renderList(); return; }
      var item = { label: n.label, value: n.value };
      var arr = o.get().slice();
      if (o.multi) {
        var idx = -1;
        arr.forEach(function (x, j) { if (x.value === item.value) idx = j; });
        if (idx >= 0) arr.splice(idx, 1); else arr.push(item);
      } else arr = [item];
      o.set(arr);
      paintPills();
      input.value = '';
      touched(d);
      if (o.multi) { renderList(); } else { closePopup(); }
    }
    function open() {
      if (popupOpenFor(box)) return;
      nav = []; results = null; query = '';
      listEl = h('div', { class: 'wd-prompt-list', role: 'listbox', id: id + '-listbox', 'data-automation-id': 'activeListContainer', 'aria-label': o.label });
      openPopup(box, listEl, { aid: 'promptPopup', expander: input, onClose: function () { listEl = null; rows = []; input.removeAttribute('aria-activedescendant'); } });
      input.setAttribute('aria-controls', listEl.id);
      renderList();
    }
    function search(q) {
      query = q;
      var ql = q.toLowerCase();
      results = leaves(tree, []).filter(function (n) { return n.label.toLowerCase().indexOf(ql) >= 0 || String(n.value).toLowerCase().indexOf(ql) >= 0; });
      // Workday selects a lone search match straight away.
      if (results.length === 1 && !isSelected(results[0])) {
        var only = results[0];
        results = null;
        activate(only);
        return;
      }
      renderList();
    }
    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    icon.addEventListener('click', function (e) { e.preventDefault(); if (popupOpenFor(box)) closePopup(); else { input.focus(); open(); } });
    box.addEventListener('click', function (e) { if (e.target === box) { input.focus(); open(); } });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var q = input.value.trim();
        if (!popupOpenFor(box)) open();
        if (q) search(q);
        else if (active >= 0 && rows[active]) rows[active].click();
      } else if (e.key === 'ArrowDown') { e.preventDefault(); if (!popupOpenFor(box)) open(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Escape') { closePopup(); }
      else if (e.key === 'Tab') { closePopup(); }
    });
    paintPills();
    var wrap = fieldWrap(o, box, id);
    d = reg({ key: o.key, label: o.label, wrap: wrap, required: o.required, check: o.check,
      empty: function () { return !o.get().length; }, focus: function () { input.focus(); } });
    return wrap;
  }

  /** Radio group (Yes/No). */
  function radioField(o) {
    var fs = h('fieldset', { class: 'wd-field', 'data-automation-id': 'formField-' + o.aid, 'data-fkey': o.key, 'aria-required': o.required ? 'true' : null });
    fs.appendChild(h('legend', null, o.label, o.required ? h('abbr', { title: 'required' }, '*') : null));
    var d;
    o.options.forEach(function (opt, i) {
      var rid = o.key + '-' + i;
      var input = h('input', { type: 'radio', id: rid, name: o.key, value: opt.value, 'data-automation-id': o.aid + '-' + opt.value, checked: o.get() === opt.label });
      input.addEventListener('change', function () { if (input.checked) { o.set(opt.label); touched(d); if (o.onChange) o.onChange(opt.label); } });
      fs.appendChild(h('div', { class: 'wd-radio-row', 'data-automation-id': 'radioBtn' }, input, h('label', { for: rid }, opt.label)));
    });
    d = reg({ key: o.key, label: o.label, wrap: fs, required: o.required, empty: function () { return !o.get(); },
      focus: function () { var f = fs.querySelector('input'); if (f) f.focus(); } });
    return fs;
  }

  /** Single checkbox. */
  function checkField(o) {
    var id = o.id || o.key;
    var input = h('input', { type: 'checkbox', id: id, 'data-automation-id': o.aid, checked: !!o.get(), 'aria-required': o.required ? 'true' : null });
    var wrap = h('div', { class: 'wd-field', 'data-automation-id': 'formField-' + o.aid, 'data-fkey': o.key });
    if (o.groupLabel) wrap.appendChild(h('div', { class: 'wd-label' }, o.groupLabel, o.required ? h('abbr', { title: 'required' }, '*') : null));
    wrap.appendChild(h('div', { class: 'wd-check-row' }, input, h('label', { for: id }, o.label, (!o.groupLabel && o.required) ? h('abbr', { title: 'required' }, '*') : null)));
    var d;
    input.addEventListener('change', function () { o.set(input.checked); touched(d); if (o.onChange) o.onChange(input.checked); });
    d = reg({ key: o.key, label: o.groupLabel || o.label, wrap: wrap, required: o.required, empty: function () { return !o.get(); }, focus: function () { input.focus(); } });
    return wrap;
  }

  /** Workday date: segmented spinbuttons (MM / DD / YYYY subsets) plus a calendar popup. */
  var PART = {
    M: { aid: 'dateSectionMonth-input', name: 'Month', min: 1, max: 12, len: 2, ph: 'MM' },
    D: { aid: 'dateSectionDay-input', name: 'Day', min: 1, max: 31, len: 2, ph: 'DD' },
    Y: { aid: 'dateSectionYear-input', name: 'Year', min: 1900, max: 2100, len: 4, ph: 'YYYY' }
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function daysIn(m, y) { return new Date(+y, +m, 0).getDate(); }
  function dateField(o) {
    var id = o.id || o.key;
    var parts = o.parts.split('');
    var group = h('div', { class: 'wd-date', 'data-automation-id': 'dateInputWrapper', role: 'group', id: id, 'aria-labelledby': id + '-label' });
    var inputs = [];
    var setters = {};
    var d;
    parts.forEach(function (p, idx) {
      var meta = PART[p];
      if (idx) group.appendChild(h('span', { class: 'wd-sep', 'aria-hidden': 'true' }, '/'));
      var inp = h('input', { type: 'text', inputmode: 'numeric', role: 'spinbutton', id: id + '-dateSection' + meta.name + '-input', 'data-automation-id': meta.aid,
        'aria-label': meta.name, 'aria-valuemin': meta.min, 'aria-valuemax': meta.max, placeholder: meta.ph, maxlength: meta.len, autocomplete: 'off',
        'aria-required': o.required ? 'true' : null });
      var buf = '';
      function setVal(v, silent) {
        inp.value = v;
        if (v) inp.setAttribute('aria-valuenow', String(parseInt(v, 10))); else inp.removeAttribute('aria-valuenow');
        inp.setAttribute('aria-valuetext', v || meta.ph);
        if (!silent) o.set(p, v);
      }
      setters[p] = setVal;
      setVal(o.get(p) || '', true);
      function advance() {
        var nx = inputs[idx + 1];
        if (nx) nx.focus();
      }
      inp.addEventListener('focus', function () { buf = ''; setTimeout(function () { try { inp.select(); } catch (e) { /* ignore */ } }, 0); });
      inp.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var k = e.key;
        if (/^\d$/.test(k)) {
          e.preventDefault();
          buf += k;
          if (p === 'Y') {
            if (buf.length > 4) buf = k;
            setVal(buf);
            if (buf.length === 4) { buf = ''; advance(); touched(d); }
            return;
          }
          var first = p === 'M' ? 1 : 3;
          var n = parseInt(buf, 10);
          if (buf.length === 1) {
            if (n > first) { setVal(pad2(n)); buf = ''; advance(); touched(d); }
            else setVal(buf);
          } else {
            if (n >= meta.min && n <= meta.max) { setVal(pad2(n)); buf = ''; advance(); touched(d); }
            else { buf = k; setVal(k); }
          }
        } else if (k === 'Backspace' || k === 'Delete') {
          e.preventDefault(); buf = ''; setVal('');
        } else if (k === 'ArrowUp' || k === 'ArrowDown') {
          e.preventDefault();
          var cur = parseInt(inp.value, 10);
          var base = p === 'Y' ? new Date().getFullYear() : meta.min;
          if (isNaN(cur)) cur = base; else cur += k === 'ArrowUp' ? 1 : -1;
          if (p !== 'Y') { if (cur > meta.max) cur = meta.min; if (cur < meta.min) cur = meta.max; }
          setVal(p === 'Y' ? String(cur) : pad2(cur)); buf = '';
        } else if (k === '/' || k === '-' || k === '.') {
          e.preventDefault(); if (buf.length === 1 && p !== 'Y' && buf !== '0') setVal(pad2(buf)); buf = ''; advance();
        } else if (k === 'ArrowRight') {
          if (inputs[idx + 1]) { e.preventDefault(); inputs[idx + 1].focus(); }
        } else if (k === 'ArrowLeft') {
          if (inputs[idx - 1]) { e.preventDefault(); inputs[idx - 1].focus(); }
        } else if (k.length === 1) {
          e.preventDefault();
        }
      });
      inp.addEventListener('input', function () {
        // Programmatic or IME input: keep digits only.
        var digits = inp.value.replace(/\D/g, '').slice(0, meta.len);
        if (p !== 'Y' && digits.length === 1 && digits !== '0' && parseInt(digits, 10) > (p === 'M' ? 1 : 3)) digits = pad2(digits);
        setVal(digits);
        touched(d);
      });
      inp.addEventListener('blur', function () {
        if (p !== 'Y' && inp.value.length === 1) setVal(inp.value === '0' ? '' : pad2(inp.value));
        buf = '';
      });
      inputs.push(inp);
      group.appendChild(inp);
    });
    var icon = h('button', { type: 'button', class: 'wd-date-icon', 'data-automation-id': 'dateIcon', 'aria-label': 'Calendar', id: id + '-dateIcon' }, '▦');
    group.appendChild(icon);
    icon.addEventListener('click', function (e) {
      e.preventDefault();
      if (popupOpenFor(icon)) { closePopup(); return; }
      openCalendar();
    });
    function openCalendar() {
      var now = todayParts();
      var y = parseInt(o.get('Y'), 10) || +now.Y;
      var m = parseInt(o.get('M'), 10) || +now.M;
      var cal = h('div', { class: 'wd-cal', 'data-automation-id': 'datePicker' });
      function pick(vals) {
        Object.keys(vals).forEach(function (p) { if (setters[p]) setters[p](vals[p]); });
        closePopup(); touched(d); inputs[inputs.length - 1].focus();
      }
      function draw() {
        cal.innerHTML = '';
        var head = h('div', { class: 'wd-cal-head' });
        var grid;
        if (o.parts === 'Y') {
          var start = y - (y % 12);
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Previous Years', 'data-automation-id': 'datePickerPrevious', onclick: function () { y -= 12; draw(); } }, '‹'));
          head.appendChild(h('span', { 'data-automation-id': 'datePickerTitle' }, start + ' - ' + (start + 11)));
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Next Years', 'data-automation-id': 'datePickerNext', onclick: function () { y += 12; draw(); } }, '›'));
          grid = h('div', { class: 'wd-cal-grid years', role: 'grid' });
          for (var i = 0; i < 12; i++) {
            (function (yy) { grid.appendChild(h('button', { type: 'button', 'aria-selected': String(yy) === o.get('Y') ? 'true' : 'false', 'data-automation-id': 'datePickerYear', onclick: function () { pick({ Y: String(yy) }); } }, String(yy))); })(start + i);
          }
        } else if (o.parts === 'MY') {
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Previous Year', 'data-automation-id': 'datePickerPrevious', onclick: function () { y -= 1; draw(); } }, '‹'));
          head.appendChild(h('span', { 'data-automation-id': 'datePickerTitle' }, String(y)));
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Next Year', 'data-automation-id': 'datePickerNext', onclick: function () { y += 1; draw(); } }, '›'));
          grid = h('div', { class: 'wd-cal-grid months', role: 'grid' });
          MONTHS.forEach(function (name, j) {
            grid.appendChild(h('button', { type: 'button', 'data-automation-id': 'datePickerMonth', 'aria-label': name + ' ' + y,
              'aria-selected': (pad2(j + 1) === o.get('M') && String(y) === o.get('Y')) ? 'true' : 'false', onclick: function () { pick({ M: pad2(j + 1), Y: String(y) }); } }, name));
          });
        } else {
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Previous Month', 'data-automation-id': 'datePickerPrevious', onclick: function () { m -= 1; if (m < 1) { m = 12; y -= 1; } draw(); } }, '‹'));
          head.appendChild(h('span', { 'data-automation-id': 'datePickerTitle' }, MONTHS[m - 1] + ' ' + y));
          head.appendChild(h('button', { type: 'button', 'aria-label': 'Next Month', 'data-automation-id': 'datePickerNext', onclick: function () { m += 1; if (m > 12) { m = 1; y += 1; } draw(); } }, '›'));
          grid = h('div', { class: 'wd-cal-grid days', role: 'grid' });
          ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (w) { grid.appendChild(h('span', { style: 'text-align:center;color:#5e6a75;font-size:12px' }, w)); });
          var lead = new Date(y, m - 1, 1).getDay();
          for (var b = 0; b < lead; b++) grid.appendChild(h('span'));
          for (var dd = 1; dd <= daysIn(m, y); dd++) {
            (function (day) {
              grid.appendChild(h('button', { type: 'button', 'data-automation-id': 'datePickerDay', 'aria-label': MONTHS[m - 1] + ' ' + day + ', ' + y,
                'aria-selected': (pad2(day) === o.get('D') && pad2(m) === o.get('M') && String(y) === o.get('Y')) ? 'true' : 'false',
                onclick: function () { pick({ M: pad2(m), D: pad2(day), Y: String(y) }); } }, String(day)));
            })(dd);
          }
        }
        cal.appendChild(head);
        cal.appendChild(grid);
      }
      draw();
      openPopup(icon, cal, { aid: 'datePickerPopup' });
    }
    var wrap = h('div', { class: 'wd-field', 'data-automation-id': 'formField-' + o.aid, 'data-fkey': o.key });
    wrap.appendChild(h('div', { class: 'wd-label', id: id + '-label' }, o.label, o.required ? h('abbr', { title: 'required' }, '*') : null));
    wrap.appendChild(group);
    if (o.hint) wrap.appendChild(h('div', { class: 'wd-hint' }, o.hint));
    function allEmpty() { return parts.every(function (p) { return !o.get(p); }); }
    function partsValid() {
      var M = o.get('M'); var D = o.get('D'); var Y = o.get('Y');
      if (parts.indexOf('Y') >= 0 && !/^\d{4}$/.test(Y || '')) return false;
      if (parts.indexOf('Y') >= 0 && (+Y < 1900 || +Y > 2100)) return false;
      if (parts.indexOf('M') >= 0 && !(+M >= 1 && +M <= 12)) return false;
      if (parts.indexOf('D') >= 0 && !(+D >= 1 && +D <= daysIn(M, Y))) return false;
      return true;
    }
    d = reg({ key: o.key, label: o.label, wrap: wrap, required: o.required,
      empty: allEmpty,
      check: function () { if (!partsValid()) return 'Enter a valid date for ' + o.label + ' (' + parts.map(function (p) { return PART[p].ph; }).join('/') + ').'; return o.check ? o.check() : null; },
      focus: function () { inputs[0].focus(); } });
    return wrap;
  }

  /** Workday file upload: drop zone, "Select files", uploaded file rows with delete. */
  var ACCEPT = ['pdf', 'doc', 'docx', 'rtf', 'txt'];
  function fmtSize(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function uploadField(o) {
    var wrap = h('div', { class: 'wd-field wd-wide', 'data-automation-id': 'formField-' + o.aid, 'data-fkey': o.key });
    wrap.appendChild(h('div', { class: 'wd-label', id: o.key + '-label' }, o.label, o.required ? h('abbr', { title: 'required' }, '*') : null));
    var input = h('input', { type: 'file', 'data-automation-id': 'file-upload-input-ref', id: o.key + '-input', accept: '.pdf,.doc,.docx,.rtf,.txt', style: 'display:none', 'aria-labelledby': o.key + '-label' });
    var selectBtn = h('button', { type: 'button', class: 'wd-btn', 'data-automation-id': 'select-files', 'aria-describedby': o.key + '-label' }, 'Select files');
    var zone = h('div', { class: 'wd-dropzone', 'data-automation-id': 'file-upload-drop-zone' }, h('p', null, 'Drop file here'), h('p', null, 'or'), selectBtn, input);
    var list = h('div', { 'data-automation-id': 'file-upload-list', 'aria-live': 'polite' });
    var status = h('div', { 'data-automation-id': 'file-upload-status', class: 'wd-hint' }, 'Max file size: 5 MB. Accepted file types: PDF, DOC, DOCX, RTF, TXT.');
    wrap.appendChild(zone); wrap.appendChild(status); wrap.appendChild(list);
    var d;
    selectBtn.addEventListener('click', function () { input.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('wd-drag'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('wd-drag'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('wd-drag'); if (e.dataTransfer && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
    input.addEventListener('change', function () { var f = input.files && input.files[0]; if (f) handle(f); input.value = ''; });
    function paint(state, file, extra) {
      list.innerHTML = '';
      var meta = o.get();
      if (state === 'uploading') {
        list.appendChild(h('div', { class: 'wd-file', 'data-automation-id': 'file-upload-item' },
          h('div', null, h('div', { class: 'wd-file-name', 'data-automation-id': 'file-upload-item-name' }, file.name), h('div', { class: 'wd-file-meta' }, extra || 'Uploading...'))));
        return;
      }
      if (meta) {
        list.appendChild(h('div', { class: 'wd-file', 'data-automation-id': 'file-upload-successful', 'data-file-id': meta.id },
          h('div', null,
            h('div', { class: 'wd-file-name', 'data-automation-id': 'file-upload-item-name' }, meta.fileName),
            h('div', { class: 'wd-file-meta' }, fmtSize(meta.size)),
            h('div', { class: 'wd-file-status', 'data-automation-id': 'file-upload-item-status' }, extra || 'Successfully Uploaded')),
          h('button', { type: 'button', class: 'wd-btn', 'data-automation-id': 'delete-file', 'aria-label': 'Delete ' + meta.fileName, onclick: remove }, 'Delete')));
      }
    }
    async function remove() {
      var meta = o.get();
      if (!meta) return;
      o.set(null, null);
      paint();
      touched(d);
      await api('DELETE', CXS + '/attachments/' + meta.id);
      if (o.onDelete) o.onDelete();
    }
    async function handle(file) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ACCEPT.indexOf(ext) < 0) { paintError(d, 'The file type .' + ext + ' is not supported. Upload a PDF, DOC, DOCX, RTF or TXT file.'); return; }
      if (file.size > 5 * 1024 * 1024) { paintError(d, 'The file ' + file.name + ' exceeds the maximum file size of 5 MB.'); return; }
      S.uploading = true;
      paintError(d, null);
      paint('uploading', file);
      var fd = new FormData();
      fd.append('file', file, file.name);
      var r = await api('POST', CXS + '/attachments', fd);
      if (!r.ok) {
        S.uploading = false;
        paint();
        paintError(d, (r.data.errors && r.data.errors[0] && r.data.errors[0].message) || 'The file could not be uploaded. Try again.');
        return;
      }
      var old = o.get();
      if (old && old.id !== r.data.id) api('DELETE', CXS + '/attachments/' + old.id);
      o.set({ id: r.data.id, fileName: r.data.fileName, size: r.data.size, contentType: r.data.contentType }, file);
      if (o.afterUpload) {
        paint('uploading', file, o.afterUploadText || 'Processing...');
        var msg = await o.afterUpload(r.data, file);
        S.uploading = false;
        paint(null, null, msg);
      } else {
        S.uploading = false;
        paint();
      }
      touched(d);
    }
    paint(null, null, o.initialStatus);
    d = reg({ key: o.key, label: o.label, wrap: wrap, required: o.required, empty: function () { return !o.get(); }, focus: function () { selectBtn.focus(); } });
    return wrap;
  }

  function section(title, aid, children) {
    return h('div', { class: 'wd-section', role: 'group', 'aria-labelledby': aid + '-heading', 'data-automation-id': aid },
      title ? h('h3', { id: aid + '-heading' }, title) : null, children);
  }
  function addButton(count, what, onAdd) {
    var label = count ? 'Add Another' : 'Add';
    return h('button', { type: 'button', class: 'wd-btn', 'data-automation-id': label, 'aria-label': label + ' ' + what, onclick: onAdd }, label);
  }
  function panel(aid, title, onDelete, children) {
    return h('div', { class: 'wd-panel', role: 'group', 'aria-labelledby': aid + '-panel', 'data-automation-id': aid },
      h('h4', { id: aid + '-panel' }, title),
      h('button', { type: 'button', class: 'wd-btn wd-delete', 'data-automation-id': 'panel-set-delete-button', 'aria-label': 'Delete ' + title, onclick: onDelete }, 'Delete'),
      children);
  }
  function wdSubmit(aid, text, onClick) {
    var btn = h('button', { type: 'button', class: 'wd-btn wd-btn-primary', 'data-automation-id': aid }, text);
    var filter = h('div', { class: 'wd-click-filter', 'data-automation-id': 'click_filter', role: 'button', tabindex: '0', 'aria-label': text });
    btn.addEventListener('click', onClick);
    filter.addEventListener('click', onClick);
    filter.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    return h('div', { class: 'wd-submit-wrap' }, btn, filter);
  }

  // ------------------------------------------------------------------ chrome
  function header() {
    var util = h('div', { class: 'wd-utility', 'data-automation-id': 'utilityMenu' });
    if (!S.session) {
      util.appendChild(h('button', { type: 'button', class: 'wd-utility-btn', 'data-automation-id': 'utilityButtonSignIn', onclick: function () { viewAuth('signIn'); } }, 'Sign In'));
    } else {
      util.appendChild(h('button', { type: 'button', class: 'wd-utility-btn', 'data-automation-id': 'utilityButtonCandidateHome', onclick: function () { go(SITE + '/userHome'); } }, 'Candidate Home'));
      var menuBtn = h('button', { type: 'button', class: 'wd-utility-btn', 'data-automation-id': 'utilityMenuButton', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, S.session.email + ' ▾');
      var menu = h('ul', { class: 'wd-menu', role: 'menu', hidden: true, 'data-automation-id': 'utilityMenuPopup' },
        h('li', { role: 'none' }, h('button', { type: 'button', role: 'menuitem', 'data-automation-id': 'candidateHomeLink', onclick: function () { go(SITE + '/userHome'); } }, 'Candidate Home')),
        h('li', { role: 'none' }, h('button', { type: 'button', role: 'menuitem', 'data-automation-id': 'signOutLink', onclick: signOut }, 'Sign Out')));
      menuBtn.addEventListener('click', function () {
        var hidden = menu.hasAttribute('hidden');
        if (hidden) menu.removeAttribute('hidden'); else menu.setAttribute('hidden', '');
        menuBtn.setAttribute('aria-expanded', hidden ? 'true' : 'false');
      });
      util.appendChild(menuBtn);
      util.appendChild(menu);
    }
    return h('header', { class: 'wd-header', 'data-automation-id': 'header' },
      h('a', { class: 'wd-logo', href: SITE, 'data-automation-id': 'logoLink', onclick: function (e) { e.preventDefault(); go(SITE); } },
        h('span', { html: '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="14" fill="#0b5394"/><path d="M8 21 15 7l7 14h-3.2L15 13.2 11.2 21z" fill="#fff"/></svg>' }),
        'Atlas Mutual Careers'),
      util);
  }
  function layout(content, footer) {
    closePopup();
    FIELDS = [];
    root.innerHTML = '';
    root.appendChild(header());
    root.appendChild(h('main', { class: 'wd-main', id: 'mainContent', 'data-automation-id': 'mainContent' }, content));
    if (footer) root.appendChild(footer);
  }
  async function signOut() {
    await api('POST', AUTH + '/signOut', {});
    S.session = null;
    resetApplication();
    go(JOB_URL);
  }

  // ------------------------------------------------------------------ router
  function go(url) { history.pushState({}, '', url); route(); }
  window.addEventListener('popstate', function () { route(); });
  function route() {
    var p = location.pathname.replace(/\/+$/, '');
    if (p.indexOf('/__confirm/') === 0) return viewConfirmation();
    if (p === SITE) return viewJobList();
    if (p === SITE + '/login') return S.session ? go(SITE + '/userHome') : viewAuth('signIn');
    if (p === SITE + '/userHome') return viewUserHome();
    if (p === JOB_URL) return viewJob(false);
    if (p === JOB_URL + '/apply') return viewJob(true);
    var m = p.match(/\/apply\/(autofillWithResume|applyManually|useMyLastApplication)$/);
    if (m && p.indexOf(JOB_URL) === 0) return startApply(m[1]);
    layout(h('div', { class: 'wd-card' }, h('h2', null, 'Page Not Found'), h('p', null, 'The page you are looking for doesn\'t exist.'), h('a', { href: SITE }, 'Search for Jobs')));
  }

  // ------------------------------------------------------------------ job pages
  async function loadJob() {
    if (S.job) return S.job;
    var r = await api('GET', CXS + '/job/' + CFG.jobPath);
    S.job = r.ok ? r.data.jobPostingInfo : { title: 'Associate Software Engineer', location: 'Remote - Pakistan', timeType: 'Full time', postedOn: '', jobReqId: REQ, jobDescription: '' };
    document.title = S.job.title + ' - Atlas Mutual Careers';
    return S.job;
  }
  function metaRow(aid, dt, dd) {
    return h('div', { 'data-automation-id': aid }, h('dl', { style: 'margin:4px 0' }, h('dt', { class: 'wd-sr' }, dt), h('dd', { style: 'margin:0' }, dd)));
  }
  async function viewJobList() {
    var job = await loadJob();
    layout(h('div', { class: 'wd-card' },
      h('h2', null, '1 JOB FOUND'),
      h('ul', { role: 'list', 'aria-label': 'Page 1 of 1', style: 'list-style:none;padding:0' },
        h('li', { class: 'wd-section' },
          h('h3', null, h('a', { 'data-automation-id': 'jobTitle', href: JOB_URL, onclick: function (e) { e.preventDefault(); go(JOB_URL); } }, job.title)),
          metaRow('locations', 'locations', job.location), metaRow('postedOn', 'posted on', job.postedOn), h('ul', { 'data-automation-id': 'subtitle', style: 'list-style:none;padding:0;color:#5e6a75' }, h('li', null, job.jobReqId))))));
  }
  async function viewJob(withDialog) {
    var job = await loadJob();
    var apply = h('a', { role: 'button', class: 'wd-btn wd-btn-primary', 'data-automation-id': 'adventureButton', href: JOB_URL + '/apply', onclick: function (e) { e.preventDefault(); go(JOB_URL + '/apply'); } }, 'Apply');
    var page = h('div', { class: 'wd-card', 'data-automation-id': 'jobPostingPage' },
      h('div', { class: 'wd-job-header' },
        h('h2', { 'data-automation-id': 'jobPostingHeader' }, job.title),
        h('div', { style: 'margin:0 0 16px' }, apply),
        h('div', { class: 'wd-job-meta' },
          metaRow('locations', 'locations', job.location),
          metaRow('time', 'time type', job.timeType),
          metaRow('postedOn', 'posted on', job.postedOn),
          metaRow('requisitionId', 'job requisition id', job.jobReqId))),
      h('div', { class: 'wd-job-desc', 'data-automation-id': 'jobPostingDescription', html: job.jobDescription }));
    layout(page);
    if (withDialog) startDialog();
  }
  function startDialog() {
    function choose(mode) { return function (e) { e.preventDefault(); document.removeEventListener('keydown', esc); go(JOB_URL + '/apply/' + mode); }; }
    function close() { overlay.remove(); document.removeEventListener('keydown', esc); history.replaceState({}, '', JOB_URL); }
    function esc(e) {
      if (!overlay.isConnected) { document.removeEventListener('keydown', esc); return; }
      if (e.key === 'Escape') close();
    }
    var overlay = h('div', { class: 'wd-overlay', 'data-automation-id': 'wd-Popup' },
      h('div', { class: 'wd-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'startApplicationHeading', 'data-automation-id': 'wd-Popup-body' },
        h('button', { type: 'button', class: 'wd-close', 'data-automation-id': 'closeButton', 'aria-label': 'Close', onclick: close }, '×'),
        h('h2', { id: 'startApplicationHeading', 'data-automation-id': 'startApplicationHeading' }, 'Start Your Application'),
        h('div', { class: 'wd-modal-actions' },
          h('a', { role: 'button', class: 'wd-btn wd-btn-primary', 'data-automation-id': 'autofillWithResume', href: JOB_URL + '/apply/autofillWithResume', onclick: choose('autofillWithResume') }, 'Autofill with Resume'),
          h('a', { role: 'button', class: 'wd-btn', 'data-automation-id': 'applyManually', href: JOB_URL + '/apply/applyManually', onclick: choose('applyManually') }, 'Apply Manually'),
          h('a', { role: 'button', class: 'wd-btn', 'data-automation-id': 'useMyLastApplication', href: JOB_URL + '/apply/useMyLastApplication', onclick: choose('useMyLastApplication') }, 'Use My Last Application'))));
    document.addEventListener('keydown', esc);
    root.appendChild(overlay);
    overlay.querySelector('[data-automation-id=autofillWithResume]').focus();
  }

  // ------------------------------------------------------------------ account views
  function applyHeader() {
    return h('h2', { class: 'wd-apply-title', 'data-automation-id': 'jobPostingHeader' }, S.job ? S.job.title : 'Associate Software Engineer');
  }
  function serverErrors(r, generalBox) {
    var errs = (r.data && r.data.errors) || [{ message: 'Something went wrong. Try again.' }];
    var byField = {};
    var general = [];
    errs.forEach(function (e) { if (e.field) (byField[e.field] = byField[e.field] || []).push(e.message); else general.push(e.message); });
    FIELDS.forEach(function (d) { if (byField[d.key]) paintError(d, byField[d.key]); else if (Object.keys(byField).length) paintError(d, null); });
    Object.keys(byField).forEach(function (k) { if (!FIELDS.some(function (d) { return d.key === k; })) general = general.concat(byField[k]); });
    generalBox.innerHTML = '';
    if (general.length) {
      general.forEach(function (m) { generalBox.appendChild(h('div', { class: 'wd-error', 'data-automation-id': 'errorMessage', role: 'alert' }, h('p', null, m))); });
    }
  }
  function authCard(kind, children) {
    return h('div', null, S.mode ? applyHeader() : null, h('div', { class: 'wd-card wd-auth', 'data-automation-id': kind }, children));
  }
  async function viewAuth(kind, message) {
    if (!S.job) await loadJob();
    if (kind === 'createAccount') return viewCreateAccount(message);
    if (kind === 'verify') return viewVerify(message);
    return viewSignIn(message);
  }
  function viewCreateAccount(message) {
    var A = S.auth;
    var general = h('div', { 'data-automation-id': 'formErrors' });
    async function submit() {
      if (busy) return;
      var ok = true;
      FIELDS.forEach(function (d) { var m = evaluate(d); paintError(d, m); if (m) ok = false; });
      general.innerHTML = '';
      if (!ok) return;
      busy = true;
      var r = await api('POST', AUTH + '/createAccount', { email: A.email.trim(), password: A.password, verifyPassword: A.verifyPassword, acceptTerms: A.terms });
      busy = false;
      if (r.ok) {
        A.pendingEmail = r.data.email; A.masked = r.data.maskedEmail; A.password = ''; A.verifyPassword = '';
        return viewAuth('verify');
      }
      serverErrors(r, general);
    }
    var content = [
      h('h2', { 'data-automation-id': 'createAccountHeader' }, 'Create Account'),
      h('p', { class: 'wd-auth-switch' }, 'Already have an account? ', h('button', { type: 'button', class: 'wd-btn-link', 'data-automation-id': 'signInLink', onclick: function () { viewAuth('signIn'); } }, 'Sign In')),
      message ? h('div', { class: 'wd-auth-msg', role: 'status' }, message) : null,
      general
    ];
    layout(authCard('createAccountPage', content));
    var card = root.querySelector('[data-automation-id=createAccountPage]');
    card.appendChild(textField({ key: 'email', label: 'Email Address', aid: 'email', id: 'input-email', type: 'email', autocomplete: 'email', required: true, get: function () { return A.email; }, set: function (v) { A.email = v; }, onEnter: submit,
      check: function () { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(A.email.trim()) ? null : 'Enter a valid email address. For example: name@example.com.'; } }));
    card.appendChild(textField({ key: 'password', label: 'Password', aid: 'password', id: 'input-password', type: 'password', autocomplete: 'new-password', required: true, get: function () { return A.password; }, set: function (v) { A.password = v; }, onEnter: submit }));
    card.appendChild(h('ul', { class: 'wd-pw-rules', 'data-automation-id': 'passwordRequirements' },
      h('li', null, 'At least 8 characters'), h('li', null, 'An uppercase alpha character'), h('li', null, 'A lowercase alpha character'),
      h('li', null, 'A numeric character'), h('li', null, 'A special character (for example ! @ # $ % ^ & *)')));
    card.appendChild(textField({ key: 'verifyPassword', label: 'Verify New Password', aid: 'verifyPassword', id: 'input-verifyPassword', type: 'password', autocomplete: 'new-password', required: true, get: function () { return A.verifyPassword; }, set: function (v) { A.verifyPassword = v; }, onEnter: submit }));
    card.appendChild(checkField({ key: 'createAccountCheckbox', aid: 'createAccountCheckbox', id: 'input-createAccountCheckbox', required: true,
      label: 'Yes, I have read and consent to the Atlas Mutual Candidate Privacy Statement', get: function () { return A.terms; }, set: function (v) { A.terms = v; } }));
    card.appendChild(wdSubmit('createAccountSubmitButton', 'Create Account', submit));
  }
  function viewSignIn(message) {
    var A = S.auth;
    var general = h('div', { 'data-automation-id': 'formErrors' });
    async function submit() {
      if (busy) return;
      var ok = true;
      FIELDS.forEach(function (d) { var m = evaluate(d); paintError(d, m); if (m) ok = false; });
      general.innerHTML = '';
      if (!ok) return;
      busy = true;
      var r = await api('POST', AUTH + '/signIn', { email: A.email.trim(), password: A.password });
      busy = false;
      if (r.ok) { A.password = ''; S.session = { email: r.data.email }; return afterAuth(); }
      if (r.data.errorCode === 'VERIFICATION_REQUIRED') { A.pendingEmail = r.data.email; A.masked = r.data.maskedEmail; return viewAuth('verify', r.data.errors[0].message); }
      serverErrors(r, general);
    }
    var content = [
      h('h2', { 'data-automation-id': 'signInHeader' }, 'Sign In'),
      message ? h('div', { class: 'wd-auth-msg', role: 'status' }, message) : null,
      general
    ];
    layout(authCard('signInPage', content));
    var card = root.querySelector('[data-automation-id=signInPage]');
    card.appendChild(textField({ key: 'email', label: 'Email Address', aid: 'email', id: 'input-email', type: 'email', autocomplete: 'email', required: true, get: function () { return A.email; }, set: function (v) { A.email = v; }, onEnter: submit }));
    card.appendChild(textField({ key: 'password', label: 'Password', aid: 'password', id: 'input-password', type: 'password', autocomplete: 'current-password', required: true, get: function () { return A.password; }, set: function (v) { A.password = v; }, onEnter: submit }));
    card.appendChild(h('p', null, h('button', { type: 'button', class: 'wd-btn-link', 'data-automation-id': 'forgotPasswordLink', onclick: async function () {
      var r = await api('POST', AUTH + '/forgotPassword', { email: A.email });
      general.innerHTML = '';
      general.appendChild(h('div', { class: 'wd-auth-msg', role: 'status' }, r.data.message || 'If an account exists for this email address, you will receive an email with instructions.'));
    } }, 'Forgot your password?')));
    card.appendChild(wdSubmit('signInSubmitButton', 'Sign In', submit));
    card.appendChild(h('p', { class: 'wd-auth-switch', style: 'margin-top:20px' }, 'Don\'t have an account yet? ',
      h('button', { type: 'button', class: 'wd-btn-link', 'data-automation-id': 'createAccountLink', onclick: function () { viewAuth('createAccount'); } }, 'Create Account')));
  }
  function viewVerify(message) {
    var A = S.auth;
    var code = { v: '' };
    var general = h('div', { 'data-automation-id': 'formErrors' });
    async function submit() {
      if (busy) return;
      var ok = true;
      FIELDS.forEach(function (d) { var m = evaluate(d); paintError(d, m); if (m) ok = false; });
      general.innerHTML = '';
      if (!ok) return;
      busy = true;
      var r = await api('POST', AUTH + '/verifyAccount', { email: A.pendingEmail, code: code.v.trim() });
      busy = false;
      if (r.ok) { S.session = { email: r.data.email }; A.pendingEmail = ''; return afterAuth(); }
      serverErrors(r, general);
    }
    var content = [
      h('h2', { 'data-automation-id': 'verifyAccountHeader' }, 'Verify Your Account'),
      message ? h('div', { class: 'wd-auth-msg', role: 'status' }, message) : null,
      h('p', { 'data-automation-id': 'verifyAccountInstructions' }, 'We sent a 6-digit verification code to ', h('b', null, A.masked || A.pendingEmail),
        '. Enter the code below to verify your account. The code expires in 10 minutes.'),
      general
    ];
    layout(authCard('verifyAccountPage', content));
    var card = root.querySelector('[data-automation-id=verifyAccountPage]');
    card.appendChild(textField({ key: 'verificationCode', label: 'Verification Code', aid: 'verificationCode', id: 'input-verificationCode', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', required: true,
      get: function () { return code.v; }, set: function (v) { code.v = v; }, onEnter: submit,
      check: function () { return /^\d{6}$/.test(code.v.trim()) ? null : 'Enter the 6-digit code from the email we sent you.'; } }));
    card.appendChild(wdSubmit('verifyAccountSubmitButton', 'Verify', submit));
    card.appendChild(h('p', { style: 'margin-top:20px' },
      'Didn\'t get the email? ',
      h('button', { type: 'button', class: 'wd-btn-link', 'data-automation-id': 'resendVerificationCodeLink', onclick: async function () {
        await api('POST', AUTH + '/resendVerification', { email: A.pendingEmail });
        general.innerHTML = '';
        general.appendChild(h('div', { class: 'wd-auth-msg', role: 'status' }, 'We sent a new verification code to ' + (A.masked || A.pendingEmail) + '.'));
      } }, 'Resend Code'),
      ' · ',
      h('button', { type: 'button', class: 'wd-btn-link', 'data-automation-id': 'signInLink', onclick: function () { viewAuth('signIn'); } }, 'Back to Sign In')));
  }
  function afterAuth() {
    var p = location.pathname;
    if (p.indexOf(JOB_URL) === 0 && /\/apply\//.test(p)) return route();
    if (p.indexOf(JOB_URL) === 0) return route();
    go(SITE + '/userHome');
  }

  // ------------------------------------------------------------------ application start
  async function startApply(mode) {
    await loadJob();
    S.mode = mode;
    if (!S.session) return viewAuth('createAccount');
    resetApplication();
    S.mode = mode;
    var d = await api('GET', CXS + '/applications/' + REQ + '/draft');
    if (d.ok && d.data && d.data.data && d.data.data.v) {
      restore(d.data.data);
      S.notice = 'We restored the application you started earlier. Continue where you left off.';
      return viewStep();
    }
    if (mode === 'autofillWithResume') return viewAutofill();
    if (mode === 'useMyLastApplication') {
      var l = await api('GET', CXS + '/applications/last');
      if (l.ok && l.data.snapshot) {
        restore(l.data.snapshot);
        S.mode = mode; S.step = 0; S.maxStep = 0;
        S.v.agreementCheckbox = false;
        S.v['selfIdentifiedDisabilityData--dateSignedOn::M'] = ''; S.v['selfIdentifiedDisabilityData--dateSignedOn::D'] = ''; S.v['selfIdentifiedDisabilityData--dateSignedOn::Y'] = '';
        S.notice = 'We filled in this application with the information from your last application. Review each page before you submit.';
      } else {
        S.notice = 'You don\'t have a previous application to use. Enter your information manually or go back and select Autofill with Resume.';
        S.mode = 'applyManually';
      }
    }
    S.step = 0;
    viewStep();
  }

  function applyParse(p) {
    var mi = p.myInformation || {};
    Object.keys(mi).forEach(function (k) { S.v[k] = mi[k]; });
    var me = p.myExperience || {};
    S.work = (me.workExperience || []).map(function (w) { var x = emptyWork(); Object.keys(w).forEach(function (k) { x[k] = w[k]; }); return x; });
    S.edu = (me.education || []).map(function (e) {
      var x = emptyEdu();
      if (e.school) {
        var s = typeof e.school === 'string' ? { label: e.school } : e.school;
        var known = SCHOOLS.indexOf(s.label) >= 0;
        x.school = [{ label: s.label, value: s.label, unmatched: !known }];
      }
      x.degree = DEGREES.indexOf(e.degree) >= 0 ? e.degree : '';
      x.fieldOfStudy = e.fieldOfStudy ? [{ label: e.fieldOfStudy, value: e.fieldOfStudy }] : [];
      x.gradeAverage = e.gradeAverage || '';
      x.firstYearAttended = e.firstYearAttended || '';
      x.lastYearAttended = e.lastYearAttended || '';
      return x;
    });
    S.skills = (me.skills || []).map(function (s) { return { label: s, value: s }; });
    S.web = (me.websites || []).slice();
    S.v.linkedinQuestion = me.linkedin || '';
  }

  function viewAutofill() {
    S.view = 'autofill';
    var bannerSlot = h('div', { id: 'wd-banner-slot' });
    var page = h('div', { class: 'wd-card wd-page', 'data-automation-id': 'applyFlowAutoFillPage' },
      h('h2', { 'data-automation-id': 'pageHeader' }, 'Autofill with Resume'),
      h('p', null, 'Upload your resume and we\'ll use it to fill in your application. You can review and change the information before you submit.'),
      bannerSlot);
    var footer = h('div', { class: 'wd-footer', 'data-automation-id': 'pageFooter' },
      h('button', { type: 'button', class: 'wd-btn', 'data-automation-id': 'bottom-navigation-back-button', onclick: function () { go(JOB_URL + '/apply'); } }, 'Back'),
      h('button', { type: 'button', class: 'wd-btn wd-btn-primary', 'data-automation-id': 'bottom-navigation-next-button', onclick: async function () {
        if (busy) return;
        if (S.uploading) { infoBanner('Wait until your file has finished uploading.'); return; }
        if (!validatePage()) return;
        S.step = 0;
        busy = true; await saveDraft(); busy = false;
        viewStep();
      } }, 'Continue'));
    layout(h('div', null, applyHeader(), page), footer);
    page.appendChild(uploadField({ key: 'resumeAttachments', aid: 'resumeAttachments', label: 'Upload a file (5MB max)', required: true,
      get: function () { return S.resume; }, set: function (meta, file) { S.resume = meta; S.resumeFile = file || null; },
      initialStatus: S.parse ? 'Successfully Uploaded!' : null,
      afterUploadText: 'Reading your resume...',
      afterUpload: async function (meta) {
        var r = await api('POST', CXS + '/resumeParse', { attachmentId: meta.id });
        if (!r.ok) { S.parse = null; return (r.data.errors && r.data.errors[0].message) || 'We could not read your resume.'; }
        S.parse = r.data;
        applyParse(r.data);
        return 'Successfully Uploaded!';
      },
      onDelete: function () { S.parse = null; } }));
  }

  // ------------------------------------------------------------------ wizard
  function progressBar() {
    return h('div', null,
      h('ol', { class: 'wd-progress', 'data-automation-id': 'progressBar', 'aria-label': 'Application progress' },
        STEPS.map(function (s, i) {
          var aid = i === S.step ? 'progressBarActiveStep' : (i < S.step ? 'progressBarCompletedStep' : 'progressBarInactiveStep');
          return h('li', { 'data-automation-id': aid, 'aria-current': i === S.step ? 'step' : null },
            h('div', { class: 'wd-sr' }, (i === S.step ? 'current step ' : (i < S.step ? 'completed step ' : 'step ')) + (i + 1) + ' of ' + STEPS.length),
            h('label', null, s.title));
        })),
      h('div', { class: 'wd-step-counter', 'data-automation-id': 'progressBarStepCounter' }, 'Step ' + (S.step + 1) + ' of ' + STEPS.length));
  }
  function viewStep() {
    S.view = 'step';
    var st = STEPS[S.step];
    var body = h('div');
    var page = h('div', { class: 'wd-card wd-page', 'data-automation-id': st.aid },
      h('h2', { 'data-automation-id': 'pageHeader', tabindex: '-1' }, st.title),
      S.step < 5 ? h('p', { class: 'wd-req-note' }, h('abbr', { title: 'required', style: 'color:#de2e21;text-decoration:none' }, '*'), ' Indicates a required field') : null,
      h('div', { id: 'wd-banner-slot' }),
      body);
    var footer = h('div', { class: 'wd-footer', 'data-automation-id': 'pageFooter' },
      (S.step > 0 || S.mode === 'autofillWithResume') ? h('button', { type: 'button', class: 'wd-btn', 'data-automation-id': 'bottom-navigation-back-button', onclick: back }, 'Back') : null,
      h('button', { type: 'button', class: 'wd-btn wd-btn-primary', 'data-automation-id': 'bottom-navigation-next-button', onclick: next }, S.step === 5 ? 'Submit' : 'Save and Continue'));
    layout(h('div', null, applyHeader(), progressBar(), page), footer);
    var renderers = [renderMyInformation, renderMyExperience, renderQuestions, renderVoluntary, renderSelfIdentify, renderReview];
    append(body, renderers[S.step]());
    if (S.notice) { var n = S.notice; S.notice = null; var slot = document.getElementById('wd-banner-slot'); slot.appendChild(h('div', { class: 'wd-banner wd-info', role: 'status', 'data-automation-id': 'infoBanner' }, n)); }
  }
  function rerender() {
    var y = window.scrollY;
    var errKeys = errorFields().map(function (d) { return d.key; });
    var hadBanner = !!document.querySelector('[data-automation-id=errorBanner]');
    viewStep();
    window.scrollTo(0, y);
    FIELDS.forEach(function (d) { if (errKeys.indexOf(d.key) >= 0) paintError(d, evaluate(d)); });
    if (hadBanner) paintBanner(errorFields().map(function (d) { return { label: d.label, msg: evaluate(d), focus: d.focus }; }));
  }
  function back() {
    closePopup();
    if (S.step === 0) { if (S.mode === 'autofillWithResume') viewAutofill(); return; }
    S.step -= 1;
    viewStep();
    window.scrollTo(0, 0);
  }
  async function next() {
    if (busy) return;
    closePopup();
    if (S.uploading) { infoBanner('Wait until your file has finished uploading.'); return; }
    if (S.step === 5) return submitApplication();
    if (!validatePage()) return;
    busy = true;
    var nextBtn = document.querySelector('[data-automation-id=bottom-navigation-next-button]');
    if (nextBtn) nextBtn.setAttribute('aria-disabled', 'true');
    var st = STEPS[S.step];
    var r = await FX.postJson(CFG.formId, collectStep(S.step), st.id);
    if (!r || r.ok === false) {
      busy = false;
      if (nextBtn) nextBtn.removeAttribute('aria-disabled');
      infoBanner('We couldn\'t save this page. ' + ((r && r.errors && r.errors.join(' ')) || 'Try again.'));
      return;
    }
    S.step += 1;
    S.maxStep = Math.max(S.maxStep, S.step);
    await saveDraft();
    busy = false;
    viewStep();
    window.scrollTo(0, 0);
    var hd = document.querySelector('[data-automation-id=pageHeader]');
    if (hd) hd.focus({ preventScroll: true });
  }

  // --- step 1: My Information
  function bindV(key) { return { get: function () { return S.v[key]; }, set: function (v) { S.v[key] = v; } }; }
  function withB(o, key) { var b = bindV(key); o.key = key; o.get = b.get; o.set = b.set; return o; }
  function phoneCodeValue() { var a = S.v['country-phone-code'] || []; return a.length ? a[0].value : ''; }
  function phoneCheck() {
    var num = String(S.v['phone-number'] || '').trim();
    if (!/^[\d\s\-().]+$/.test(num)) return 'Phone Number can contain only numbers, spaces, hyphens and parentheses. Select the country phone code separately.';
    var digits = num.replace(/\D/g, '');
    var code = phoneCodeValue();
    if (/\(\+92\)$/.test(code)) {
      if (digits.charAt(0) === '0') return 'The phone number is not valid for Pakistan (+92). Do not include the leading 0 (national prefix).';
      if (digits.length < 9 || digits.length > 10) return 'The phone number is not valid for Pakistan (+92). Enter 9 or 10 digits, for example 3001234567.';
    } else if (digits.length < 6 || digits.length > 14) return 'Enter a valid phone number.';
    return null;
  }
  function postalCheck() {
    var pc = String(S.v.addressSection_postalCode || '').trim();
    var c = S.v.countryDropdown;
    if (c === 'Pakistan' && !/^\d{5}$/.test(pc)) return 'Enter a valid postal code for Pakistan. Postal codes in Pakistan have 5 digits.';
    if (c === 'United States of America' && !/^\d{5}(-\d{4})?$/.test(pc)) return 'Enter a valid postal code. For example: 12345 or 12345-6789.';
    if (pc.length > 12) return 'Enter a valid postal code.';
    return null;
  }
  function renderMyInformation() {
    var v = S.v;
    var out = [];
    out.push(promptField({ key: 'source', label: 'How Did You Hear About Us?', wrapAid: 'formField-source', id: 'source--source', inputAid: 'searchBox', required: true,
      tree: buildSourceTree(), get: function () { return v.source; }, set: function (x) { v.source = x; } }));
    out.push(radioField(withB({ label: 'Have you previously worked for Atlas Mutual?', aid: 'candidateIsPreviousWorker', required: true,
      options: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }], onChange: function () { rerender(); } }, 'candidateIsPreviousWorker')));
    if (v.candidateIsPreviousWorker === 'Yes') {
      out.push(textField(withB({ label: 'Employee ID', aid: 'previousWorker-employeeId', id: 'previousWorker--employeeId', hint: 'If you don\'t remember your employee ID, leave this blank.' }, 'previousWorker--employeeId')));
    }
    out.push(selectField(withB({ label: 'Country', aid: 'countryDropdown', id: 'country--country', required: true, options: COUNTRIES.map(function (c) { return c[0]; }),
      onChange: function () { v.addressSection_countryRegion = ''; rerender(); } }, 'countryDropdown')));
    out.push(section('Legal Name', 'legalNameSection', [
      textField(withB({ label: 'First Name', aid: 'legalNameSection_firstName', id: 'name--legalName--firstName', required: true, autocomplete: 'given-name' }, 'legalNameSection_firstName')),
      textField(withB({ label: 'Middle Name', aid: 'legalNameSection_middleName', id: 'name--legalName--middleName', autocomplete: 'additional-name' }, 'legalNameSection_middleName')),
      textField(withB({ label: 'Last Name', aid: 'legalNameSection_lastName', id: 'name--legalName--lastName', required: true, autocomplete: 'family-name' }, 'legalNameSection_lastName')),
      checkField({ key: 'preferredNameCheckbox', aid: 'preferredNameCheckbox', id: 'name--preferredCheck', label: 'I have a preferred name',
        get: function () { return v.preferredNameCheckbox; }, set: function (x) { v.preferredNameCheckbox = x; }, onChange: function () { rerender(); } }),
      v.preferredNameCheckbox ? textField(withB({ label: 'Preferred First Name', aid: 'preferredNameSection_firstName', id: 'name--preferredName--firstName', required: true }, 'preferredNameSection_firstName')) : null,
      v.preferredNameCheckbox ? textField(withB({ label: 'Preferred Last Name', aid: 'preferredNameSection_lastName', id: 'name--preferredName--lastName' }, 'preferredNameSection_lastName')) : null
    ]));
    var regionSpec = REGIONS[v.countryDropdown];
    out.push(section('Address', 'addressSection', [
      textField(withB({ label: 'Address Line 1', aid: 'addressSection_addressLine1', id: 'address--addressLine1', required: true, autocomplete: 'address-line1' }, 'addressSection_addressLine1')),
      textField(withB({ label: 'Address Line 2', aid: 'addressSection_addressLine2', id: 'address--addressLine2', autocomplete: 'address-line2' }, 'addressSection_addressLine2')),
      textField(withB({ label: 'City', aid: 'addressSection_city', id: 'address--city', required: true, autocomplete: 'address-level2' }, 'addressSection_city')),
      regionSpec ? selectField(withB({ label: regionSpec.label, aid: 'addressSection_countryRegion', id: 'address--countryRegion', required: true, options: regionSpec.list }, 'addressSection_countryRegion')) : null,
      textField(withB({ label: 'Postal Code', aid: 'addressSection_postalCode', id: 'address--postalCode', required: true, autocomplete: 'postal-code', check: postalCheck }, 'addressSection_postalCode'))
    ]));
    out.push(section('Email Address', 'emailSection', [
      textField({ key: 'email', label: 'Email Address', aid: 'email', id: 'emailAddress--emailAddress', readOnly: true, get: function () { return v.email; }, set: function () { /* read-only */ },
        hint: 'This is the email address for your candidate account.' })
    ]));
    out.push(section('Phone', 'phoneSection', [
      selectField(withB({ label: 'Phone Device Type', aid: 'phone-device-type', id: 'phoneNumber--phoneType', required: true, options: DEVICE_TYPES }, 'phone-device-type')),
      promptField({ key: 'country-phone-code', label: 'Country Phone Code', wrapAid: 'formField-countryPhoneCode', id: 'phoneNumber--countryPhoneCode', inputAid: 'country-phone-code', required: true,
        tree: PHONE_TREE, get: function () { return v['country-phone-code']; }, set: function (x) { v['country-phone-code'] = x; } }),
      textField(withB({ label: 'Phone Number', aid: 'phone-number', id: 'phoneNumber--phoneNumber', required: true, autocomplete: 'tel-national', inputmode: 'tel', check: phoneCheck }, 'phone-number')),
      textField(withB({ label: 'Phone Extension', aid: 'phone-extension', id: 'phoneNumber--extension' }, 'phone-extension'))
    ]));
    return out;
  }

  // --- step 2: My Experience
  function ymNum(m, y) { return (+y) * 12 + (+m); }
  function nowYM() { var t = todayParts(); return ymNum(t.M, t.Y); }
  function renderMyExperience() {
    var out = [];
    var workPanels = S.work.map(function (w, i) {
      var n = i + 1;
      var base = 'workExperience-' + n;
      function bw(field) { return { get: function () { return w[field]; }, set: function (x) { w[field] = x; } }; }
      function wf(o, field) { var b = bw(field); o.key = base + '--' + field; o.id = base + '--' + field; o.get = b.get; o.set = b.set; return o; }
      var fields = [
        textField(wf({ label: 'Job Title', aid: 'jobTitle', required: true }, 'jobTitle')),
        textField(wf({ label: 'Company', aid: 'company', required: true }, 'company')),
        textField(wf({ label: 'Location', aid: 'location' }, 'location')),
        checkField({ key: base + '--currentlyWorkHere', id: base + '--currentlyWorkHere', aid: 'currentlyWorkHere', label: 'I currently work here',
          get: function () { return w.currentlyWorkHere; }, set: function (x) { w.currentlyWorkHere = x; if (x) { w.endMonth = ''; w.endYear = ''; } }, onChange: function () { rerender(); } }),
        dateField({ key: base + '--startDate', id: base + '--startDate', aid: 'startDate', label: 'From', parts: 'MY', required: true,
          get: function (p) { return p === 'M' ? w.startMonth : w.startYear; }, set: function (p, x) { if (p === 'M') w.startMonth = x; else w.startYear = x; },
          check: function () { return ymNum(w.startMonth, w.startYear) > nowYM() ? 'The From date cannot be in the future.' : null; } })
      ];
      if (!w.currentlyWorkHere) {
        fields.push(dateField({ key: base + '--endDate', id: base + '--endDate', aid: 'endDate', label: 'To', parts: 'MY', required: true,
          get: function (p) { return p === 'M' ? w.endMonth : w.endYear; }, set: function (p, x) { if (p === 'M') w.endMonth = x; else w.endYear = x; },
          check: function () {
            if (w.startMonth && /^\d{4}$/.test(w.startYear) && ymNum(w.endMonth, w.endYear) < ymNum(w.startMonth, w.startYear)) return 'The To date must be on or after the From date.';
            if (ymNum(w.endMonth, w.endYear) > nowYM()) return 'The To date cannot be in the future. If you still work here, select I currently work here.';
            return null;
          } }));
      }
      fields.push(textField(wf({ label: 'Role Description', aid: 'description', multiline: true, wide: true }, 'roleDescription')));
      return panel(base, 'Work Experience ' + n, function () { S.work.splice(i, 1); rerender(); }, fields);
    });
    out.push(section('Work Experience', 'workExperienceSection', [workPanels, addButton(S.work.length, 'Work Experience', function () {
      S.work.push(emptyWork()); rerender();
      var f = document.getElementById('workExperience-' + S.work.length + '--jobTitle'); if (f) f.focus();
    })]));

    var eduPanels = S.edu.map(function (e, i) {
      var n = i + 1;
      var base = 'education-' + n;
      return panel(base, 'Education ' + n, function () { S.edu.splice(i, 1); rerender(); }, [
        promptField({ key: base + '--school', id: base + '--schoolName', wrapAid: 'formField-schoolName', inputAid: 'school', label: 'School or University', required: true,
          tree: leafTree(SCHOOLS), get: function () { return e.school; }, set: function (x) { e.school = x; } }),
        selectField({ key: base + '--degree', id: base + '--degree', aid: 'degree', label: 'Degree', required: true, options: DEGREES,
          get: function () { return e.degree; }, set: function (x) { e.degree = x; } }),
        promptField({ key: base + '--fieldOfStudy', id: base + '--fieldOfStudy', wrapAid: 'formField-fieldOfStudy', inputAid: 'fieldOfStudy', label: 'Field of Study',
          tree: leafTree(FIELDS_OF_STUDY), get: function () { return e.fieldOfStudy; }, set: function (x) { e.fieldOfStudy = x; } }),
        textField({ key: base + '--gradeAverage', id: base + '--gradeAverage', aid: 'gpa', label: 'Overall Result (GPA)', get: function () { return e.gradeAverage; }, set: function (x) { e.gradeAverage = x; } }),
        dateField({ key: base + '--firstYearAttended', id: base + '--firstYearAttended', aid: 'firstYearAttended', label: 'From', parts: 'Y',
          get: function () { return e.firstYearAttended; }, set: function (p, x) { e.firstYearAttended = x; } }),
        dateField({ key: base + '--lastYearAttended', id: base + '--lastYearAttended', aid: 'lastYearAttended', label: 'To (Actual or Expected)', parts: 'Y',
          get: function () { return e.lastYearAttended; }, set: function (p, x) { e.lastYearAttended = x; },
          check: function () { return (/^\d{4}$/.test(e.firstYearAttended) && +e.lastYearAttended < +e.firstYearAttended) ? 'The To (Actual or Expected) year must be on or after the From year.' : null; } })
      ]);
    });
    out.push(section('Education', 'educationSection', [eduPanels, addButton(S.edu.length, 'Education', function () { S.edu.push(emptyEdu()); rerender(); })]));

    out.push(section('Skills', 'skillsSection', [
      promptField({ key: 'skills', id: 'skills--skills', wrapAid: 'formField-skills', inputAid: 'skillsPrompt', label: 'Type to Add Skills', multi: true,
        tree: leafTree(SKILLS), get: function () { return S.skills; }, set: function (x) { S.skills = x; } })
    ]));

    out.push(section('Resume/CV', 'resumeSection', [
      uploadField({ key: 'resumeAttachments', aid: 'resumeAttachments', label: 'Resume/CV', required: true,
        get: function () { return S.resume; }, set: function (meta, file) { S.resume = meta; S.resumeFile = file || null; } })
    ]));

    var webPanels = S.web.map(function (url, i) {
      var n = i + 1;
      var base = 'website-' + n;
      return panel(base, 'Website ' + n, function () { S.web.splice(i, 1); rerender(); }, [
        textField({ key: base + '--url', id: base + '--url', aid: 'website', label: 'URL', required: true, type: 'url',
          get: function () { return S.web[i]; }, set: function (x) { S.web[i] = x; },
          check: function () { return /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(String(S.web[i]).trim()) ? null : 'Enter a valid URL. For example: https://www.example.com.'; } })
      ]);
    });
    out.push(section('Websites', 'websiteSection', [webPanels, addButton(S.web.length, 'Websites', function () {
      S.web.push(''); rerender();
      var f = document.getElementById('website-' + S.web.length + '--url'); if (f) f.focus();
    })]));

    out.push(section('Social Network URLs', 'socialNetworkSection', [
      textField(withB({ label: 'LinkedIn', aid: 'linkedinQuestion', id: 'socialNetworkAccounts--linkedInAccount', type: 'url',
        check: function () { return /linkedin\.com\/(in|pub)\/[\w%-]+/i.test(S.v.linkedinQuestion) ? null : 'Enter a valid LinkedIn profile URL. For example: https://www.linkedin.com/in/yourname.'; } }, 'linkedinQuestion'))
    ]));
    return out;
  }

  // --- step 3: Application Questions
  function renderQuestions() {
    var fields = QUESTIONS.map(function (q) {
      var key = 'primaryQuestionnaire--' + q.id;
      var o = { key: key, id: key, name: key, label: q.label, wrapAid: 'formField-' + q.id, required: true, get: bindV(key).get, set: bindV(key).set, wide: true };
      if (q.type === 'select') { o.options = q.options; return selectField(o); }
      o.aid = 'textInputBox';
      o.check = function () { return /\d/.test(S.v[key]) ? null : 'Enter an amount, for example 30000.'; };
      return textField(o);
    });
    return h('div', { 'data-automation-id': 'primaryQuestionnaire' }, fields);
  }

  // --- step 4: Voluntary Disclosures
  function renderVoluntary() {
    return [
      h('p', { 'data-automation-id': 'voluntaryDisclosuresIntro' }, 'Atlas Mutual is an equal opportunity employer. Providing this information is voluntary and declining to provide it will not subject you to any adverse treatment. The information is kept confidential and used only for reporting.'),
      selectField(withB({ label: 'Gender', aid: 'gender', id: 'personalInfoUS--gender', required: true, options: GENDERS }, 'gender')),
      selectField(withB({ label: 'Race/Ethnicity', aid: 'ethnicityDropdown', id: 'personalInfoUS--ethnicity', required: true, options: ETHNICITIES, wide: true }, 'ethnicityDropdown')),
      selectField(withB({ label: 'Veteran Status', aid: 'veteranStatus', id: 'personalInfoUS--veteranStatus', required: true, options: VETERAN, wide: true }, 'veteranStatus')),
      section('Terms and Conditions', 'termsAndConditionsSection', [
        h('div', { 'data-automation-id': 'termsAndConditionsText', style: 'max-height:140px;overflow:auto;border:1px solid #ced3d9;border-radius:4px;padding:10px 14px;margin:0 0 14px;font-size:13px' },
          h('p', null, 'By submitting this application you confirm that the information you provide is true and complete. Atlas Mutual will process your personal data to evaluate your application, as described in the Candidate Privacy Statement, and may retain it for up to 24 months to consider you for other roles.'),
          h('p', null, 'You understand that any false statement or omission may disqualify you from employment or lead to dismissal.')),
        checkField({ key: 'agreementCheckbox', aid: 'agreementCheckbox', id: 'termsAndConditions--acceptTermsAndAgreements', required: true,
          groupLabel: 'I consent', label: 'Yes, I have read and consent to the terms and conditions',
          get: function () { return S.v.agreementCheckbox; }, set: function (x) { S.v.agreementCheckbox = x; } })
      ])
    ];
  }

  // --- step 5: Self Identify
  function renderSelfIdentify() {
    var dk = 'selfIdentifiedDisabilityData--dateSignedOn';
    var statusKey = 'selfIdentifiedDisabilityData--disabilityStatus';
    var fs = h('fieldset', { class: 'wd-field wd-wide', 'data-automation-id': 'formField-disabilityStatus', 'data-fkey': statusKey, 'aria-required': 'true' },
      h('legend', null, 'Please check one of the boxes below:', h('abbr', { title: 'required' }, '*')));
    var boxes = DISABILITY.map(function (label, i) {
      var id = 'disabilityStatus-' + i;
      var cb = h('input', { type: 'checkbox', id: id, name: 'disabilityStatus', value: label, checked: S.v[statusKey] === label, 'data-automation-id': 'disabilityStatusCheckbox' });
      fs.appendChild(h('div', { class: 'wd-check-row' }, cb, h('label', { for: id }, label)));
      return cb;
    });
    var dStatus = reg({ key: statusKey, label: 'Please check one of the boxes below', wrap: fs, required: true, empty: function () { return !S.v[statusKey]; }, focus: function () { boxes[0].focus(); } });
    boxes.forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) { boxes.forEach(function (o) { if (o !== cb) o.checked = false; }); S.v[statusKey] = cb.value; }
        else S.v[statusKey] = '';
        touched(dStatus);
      });
    });
    return [
      h('div', { 'data-automation-id': 'selfIdentificationIntro' },
        h('h3', { style: 'margin:0 0 4px' }, 'Voluntary Self-Identification of Disability'),
        h('p', { style: 'color:#5e6a75;font-size:12px;margin:0 0 10px' }, 'Form CC-305 · OMB Control Number 1250-0005'),
        h('p', null, 'We are a federal contractor or subcontractor. The law requires us to provide equal employment opportunity to qualified people with disabilities. Completing this form is voluntary, and we hope you will choose to do so. Your answer will be kept private and will not be used against you in any way.')),
      textField(withB({ label: 'Name', aid: 'name', id: 'selfIdentifiedDisabilityData--name', required: true }, 'selfIdentifiedDisabilityData--name')),
      textField(withB({ label: 'Employee ID (if applicable)', aid: 'employeeId', id: 'selfIdentifiedDisabilityData--employeeId' }, 'selfIdentifiedDisabilityData--employeeId')),
      dateField({ key: dk, id: dk, aid: 'dateSignedOn', label: 'Date', parts: 'MDY', required: true,
        get: function (p) { return S.v[dk + '::' + p]; }, set: function (p, x) { S.v[dk + '::' + p] = x; },
        check: function () {
          var t = todayParts();
          var a = S.v[dk + '::Y'] + S.v[dk + '::M'] + S.v[dk + '::D'];
          return a > t.Y + t.M + t.D ? 'The date cannot be in the future.' : null;
        } }),
      fs
    ];
  }

  // --- collect (flat submission keys)
  function promptVal(arr) { return arr && arr.length ? arr[0].value : ''; }
  function collectStep(i) {
    var v = S.v;
    var o = {};
    if (i === 0) {
      o.source = promptVal(v.source);
      o.candidateIsPreviousWorker = v.candidateIsPreviousWorker;
      if (v.candidateIsPreviousWorker === 'Yes') o['previousWorker--employeeId'] = v['previousWorker--employeeId'];
      o.countryDropdown = v.countryDropdown;
      o.legalNameSection_firstName = v.legalNameSection_firstName;
      o.legalNameSection_middleName = v.legalNameSection_middleName;
      o.legalNameSection_lastName = v.legalNameSection_lastName;
      o.preferredNameCheckbox = v.preferredNameCheckbox ? 'true' : 'false';
      if (v.preferredNameCheckbox) { o.preferredNameSection_firstName = v.preferredNameSection_firstName; o.preferredNameSection_lastName = v.preferredNameSection_lastName; }
      o.addressSection_addressLine1 = v.addressSection_addressLine1;
      o.addressSection_addressLine2 = v.addressSection_addressLine2;
      o.addressSection_city = v.addressSection_city;
      o.addressSection_countryRegion = REGIONS[v.countryDropdown] ? v.addressSection_countryRegion : '';
      o.addressSection_postalCode = v.addressSection_postalCode;
      o.email = v.email;
      o['phone-device-type'] = v['phone-device-type'];
      o['country-phone-code'] = promptVal(v['country-phone-code']);
      o['phone-number'] = v['phone-number'];
      o['phone-extension'] = v['phone-extension'];
    } else if (i === 1) {
      S.work.forEach(function (w, j) {
        var b = 'workExperience-' + (j + 1) + '--';
        o[b + 'jobTitle'] = w.jobTitle;
        o[b + 'company'] = w.company;
        o[b + 'location'] = w.location;
        o[b + 'currentlyWorkHere'] = w.currentlyWorkHere ? 'true' : 'false';
        o[b + 'startDate-dateSectionMonth-input'] = w.startMonth;
        o[b + 'startDate-dateSectionYear-input'] = w.startYear;
        o[b + 'endDate-dateSectionMonth-input'] = w.currentlyWorkHere ? '' : w.endMonth;
        o[b + 'endDate-dateSectionYear-input'] = w.currentlyWorkHere ? '' : w.endYear;
        o[b + 'roleDescription'] = w.roleDescription;
      });
      S.edu.forEach(function (e, j) {
        var b = 'education-' + (j + 1) + '--';
        o[b + 'school'] = promptVal(e.school);
        o[b + 'degree'] = e.degree;
        o[b + 'fieldOfStudy'] = promptVal(e.fieldOfStudy);
        o[b + 'gradeAverage'] = e.gradeAverage;
        o[b + 'firstYearAttended-dateSectionYear-input'] = e.firstYearAttended;
        o[b + 'lastYearAttended-dateSectionYear-input'] = e.lastYearAttended;
      });
      o.skills = S.skills.map(function (s) { return s.value; });
      if (S.resume) { o['resumeAttachments--fileName'] = S.resume.fileName; o['resumeAttachments--id'] = S.resume.id; }
      S.web.forEach(function (u, j) { o['website-' + (j + 1) + '--url'] = u; });
      o.linkedinQuestion = v.linkedinQuestion;
    } else if (i === 2) {
      QUESTIONS.forEach(function (q) { o['primaryQuestionnaire--' + q.id] = v['primaryQuestionnaire--' + q.id]; });
    } else if (i === 3) {
      o.gender = v.gender;
      o.ethnicityDropdown = v.ethnicityDropdown;
      o.veteranStatus = v.veteranStatus;
      o.agreementCheckbox = v.agreementCheckbox ? 'true' : 'false';
    } else if (i === 4) {
      var dk = 'selfIdentifiedDisabilityData--dateSignedOn';
      o['selfIdentifiedDisabilityData--name'] = v['selfIdentifiedDisabilityData--name'];
      o['selfIdentifiedDisabilityData--employeeId'] = v['selfIdentifiedDisabilityData--employeeId'];
      o[dk] = v[dk + '::M'] && v[dk + '::D'] && v[dk + '::Y'] ? v[dk + '::M'] + '/' + v[dk + '::D'] + '/' + v[dk + '::Y'] : '';
      o['selfIdentifiedDisabilityData--disabilityStatus'] = v['selfIdentifiedDisabilityData--disabilityStatus'];
    }
    Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === null) o[k] = ''; });
    return o;
  }
  function collectAll() {
    var all = {};
    for (var i = 0; i < 5; i++) { var o = collectStep(i); Object.keys(o).forEach(function (k) { all[k] = o[k]; }); }
    return all;
  }

  // --- step 6: Review
  function renderReview() {
    function row(label, value) {
      return h('div', { class: 'wd-review-row', 'data-automation-id': 'reviewRow' },
        h('div', { class: 'wd-review-label' }, label), h('div', { class: 'wd-review-value', 'data-automation-id': 'reviewValue' }, value === '' || value === undefined || value === null ? '—' : String(value)));
    }
    function sec(i, children) {
      return h('div', { class: 'wd-review-section', 'data-automation-id': 'reviewSection-' + STEPS[i].id },
        h('h3', null, STEPS[i].title), children);
    }
    var v = S.v;
    var src = v.source[0];
    var mi = sec(0, [
      row('How Did You Hear About Us?', src ? src.value : ''),
      row('Have you previously worked for Atlas Mutual?', v.candidateIsPreviousWorker),
      row('Country', v.countryDropdown),
      row('Legal Name', [v.legalNameSection_firstName, v.legalNameSection_middleName, v.legalNameSection_lastName].filter(Boolean).join(' ')),
      v.preferredNameCheckbox ? row('Preferred Name', [v.preferredNameSection_firstName, v.preferredNameSection_lastName].filter(Boolean).join(' ')) : null,
      row('Address', [v.addressSection_addressLine1, v.addressSection_addressLine2, v.addressSection_city, REGIONS[v.countryDropdown] ? v.addressSection_countryRegion : '', v.addressSection_postalCode].filter(Boolean).join('\n')),
      row('Email Address', v.email),
      row('Phone', [v['phone-device-type'], promptVal(v['country-phone-code']), v['phone-number'], v['phone-extension'] ? 'ext. ' + v['phone-extension'] : ''].filter(Boolean).join(' '))
    ]);
    var me = sec(1, [
      S.work.map(function (w, i) {
        return [h('h4', null, 'Work Experience ' + (i + 1)), row('Job Title', w.jobTitle), row('Company', w.company), row('Location', w.location),
          row('I currently work here', w.currentlyWorkHere ? 'Yes' : 'No'), row('From', w.startMonth + '/' + w.startYear),
          row('To', w.currentlyWorkHere ? 'Present' : w.endMonth + '/' + w.endYear), row('Role Description', w.roleDescription)];
      }),
      S.edu.map(function (e, i) {
        return [h('h4', null, 'Education ' + (i + 1)), row('School or University', promptVal(e.school)), row('Degree', e.degree), row('Field of Study', promptVal(e.fieldOfStudy)),
          row('Overall Result (GPA)', e.gradeAverage), row('From', e.firstYearAttended), row('To (Actual or Expected)', e.lastYearAttended)];
      }),
      h('h4', null, 'Skills'), row('Skills', S.skills.map(function (s) { return s.label; }).join(', ')),
      h('h4', null, 'Resume/CV'), row('Resume/CV', S.resume ? S.resume.fileName : ''),
      h('h4', null, 'Websites'), S.web.length ? S.web.map(function (u, i) { return row('Website ' + (i + 1), u); }) : row('Websites', ''),
      h('h4', null, 'Social Network URLs'), row('LinkedIn', v.linkedinQuestion)
    ]);
    var aq = sec(2, QUESTIONS.map(function (q) { return row(q.label, v['primaryQuestionnaire--' + q.id]); }));
    var vd = sec(3, [row('Gender', v.gender), row('Race/Ethnicity', v.ethnicityDropdown), row('Veteran Status', v.veteranStatus),
      row('Terms and Conditions', v.agreementCheckbox ? 'Yes, I have read and consent to the terms and conditions' : 'Not accepted')]);
    var dk = 'selfIdentifiedDisabilityData--dateSignedOn';
    var si = sec(4, [row('Name', v['selfIdentifiedDisabilityData--name']), row('Employee ID', v['selfIdentifiedDisabilityData--employeeId']),
      row('Date', v[dk + '::M'] ? v[dk + '::M'] + '/' + v[dk + '::D'] + '/' + v[dk + '::Y'] : ''), row('Disability Status', v['selfIdentifiedDisabilityData--disabilityStatus'])]);
    return h('div', { 'data-automation-id': 'reviewJobApplicationPage' }, mi, me, aq, vd, si);
  }

  async function resumeBlob() {
    if (S.resumeFile) return S.resumeFile;
    if (!S.resume) return null;
    var res = await fetch(CXS + '/attachments/' + S.resume.id, { credentials: 'include' });
    if (!res.ok) return null;
    var blob = await res.blob();
    return new File([blob], S.resume.fileName, { type: S.resume.contentType || blob.type });
  }
  async function submitApplication() {
    if (busy) return;
    busy = true;
    var btn = document.querySelector('[data-automation-id=bottom-navigation-next-button]');
    if (btn) { btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Submitting...'; }
    var fail = function (msg) {
      busy = false;
      if (btn) { btn.removeAttribute('aria-disabled'); btn.textContent = 'Submit'; }
      infoBanner(msg);
    };
    var all = collectAll();
    var fd = new FormData();
    Object.keys(all).forEach(function (k) {
      var val = all[k];
      if (Array.isArray(val)) val.forEach(function (x) { fd.append(k, x); }); else fd.append(k, val);
    });
    fd.append('jobReqId', REQ);
    fd.append('applicationMode', S.mode || '');
    var file = await resumeBlob();
    if (!file) return fail('Your resume could not be attached. Go back to My Experience and upload it again.');
    fd.append('resumeAttachments', file, file.name);
    var r = await FX.postForm(CFG.formId, fd);
    if (!r || !r.ok) return fail('Your application could not be submitted. ' + ((r && r.errors && r.errors.join('; ')) || 'Try again.'));
    await api('POST', CXS + '/applications/' + REQ + '/submitted', { snapshot: serialize() });
    if (!FX.finish(r)) fail('Your application was received, but we could not open the confirmation page.');
  }

  // ------------------------------------------------------------------ candidate home + confirmation
  async function viewUserHome(justSubmitted) {
    await loadJob();
    if (!S.session) { S.mode = null; return viewAuth('signIn', 'Sign in to see your applications.'); }
    var r = await api('GET', CXS + '/applications');
    var apps = (r.ok && r.data.applications) || [];
    var table = h('table', { class: 'wd-table', 'data-automation-id': 'applicationsTable' },
      h('thead', null, h('tr', null, h('th', null, 'Job Title'), h('th', null, 'Job Requisition ID'), h('th', null, 'Status'), h('th', null, 'Date Submitted'))),
      h('tbody', null, apps.length ? apps.slice().reverse().map(function (a) {
        return h('tr', { 'data-automation-id': 'applicationRow' }, h('td', null, a.jobTitle), h('td', null, a.jobReqId), h('td', null, a.status), h('td', null, new Date(a.submittedOn).toLocaleDateString('en-US')));
      }) : h('tr', null, h('td', { colspan: '4' }, 'You have no applications.'))));
    var content = h('div', null);
    if (justSubmitted) content.appendChild(justSubmitted);
    content.appendChild(h('div', { class: 'wd-card', 'data-automation-id': 'candidateHomePage' },
      h('h2', { 'data-automation-id': 'pageHeader' }, 'My Applications'),
      h('p', null, h('a', { href: SITE, 'data-automation-id': 'findJobsLink', onclick: function (e) { e.preventDefault(); go(SITE); } }, 'Search for Jobs')),
      table));
    layout(content);
  }
  async function viewConfirmation() {
    await loadJob();
    var name = '';
    if (S.session) {
      var l = await api('GET', CXS + '/applications/last');
      if (l.ok && l.data.snapshot && l.data.snapshot.v) name = l.data.snapshot.v.legalNameSection_firstName || '';
    }
    var card = h('div', { class: 'wd-card wd-success', 'data-automation-id': 'applicationSubmittedPage', style: 'margin-bottom:20px' },
      h('div', { class: 'wd-tick', 'aria-hidden': 'true' }, '✓'),
      h('h2', { 'data-automation-id': 'applicationSubmittedHeader' }, 'Application Submitted'),
      h('p', { 'data-automation-id': 'applicationSubmittedMessage' }, 'Congratulations' + (name ? ', ' + name : '') + '! Your application for ' + S.job.title + ' (' + S.job.jobReqId + ') has been submitted.'),
      h('p', null, 'We\'ll review your application and contact you if your qualifications match the role. You can check the status of your application at any time in Candidate Home.'),
      h('p', null, h('a', { class: 'wd-btn wd-btn-primary', role: 'button', href: SITE + '/userHome', 'data-automation-id': 'viewMyApplicationsLink',
        onclick: function (e) { e.preventDefault(); go(SITE + '/userHome'); } }, 'View My Applications')));
    if (S.session) return viewUserHome(card);
    layout(card);
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    var r = await api('GET', AUTH + '/session');
    S.session = r.ok && r.data.signedIn ? { email: r.data.email } : null;
    resetApplication();
    await route();
  }
  boot();
})();

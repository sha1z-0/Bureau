/*
 * Fixture renderer for the Greenhouse "job-boards" Remix app
 * (job-boards.greenhouse.io/<board>/jobs/<id> and /embed/job_app).
 *
 * The real page server-renders the application form from the job post JSON in
 * window.__remixContext and hydrates it with React; this script plays both
 * parts. It renders the same DOM the real app emits (field-wrapper /
 * input-wrapper markup, ids first_name, last_name, email, phone,
 * candidate-location, resume, cover_letter, question_<id>, gender, ...), and
 * re-implements react-select v5 behaviour for every dropdown: select__control,
 * select__value-container, select__input (role=combobox) with aria-expanded /
 * aria-controls / aria-activedescendant, a select__menu > select__menu-list
 * (role=listbox) of select__option rows (react-select-<id>-option-<n>),
 * wrap-around arrow keys, Enter / Tab to select, Escape to close, typing to
 * filter, Backspace to drop the last chip of a multi-select, and the hidden
 * opacity:0 "requiredInput" that makes the browser block submit natively
 * until a required dropdown has a value.
 *
 * On submit it validates like the app (aria-invalid + "<id>-error" helper text)
 * and sends multipart FormData with fetch, then follows the server redirect.
 * When loaderData.root.embedded is true it also reports its height to the
 * parent page with postMessage, as the embed's iframe-resizer handshake does.
 */
(function () {
  'use strict';

  var ctx = window.__remixContext;
  var root = ctx.state.loaderData.root;
  var route = ctx.state.loaderData['routes/$url_token_.jobs_.$job_post_id'];
  var jp = route.jobPost;
  var FORM_ID = window.__FX_FORM_ID;
  var embedded = !!root.embedded;

  var ICON_CARET = '<svg class="svg-icon" fill="none" height="20" width="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="icon--primary-color" d="M11.4534 16.0667L5.90983 9.13729C5.54316 8.67895 5.86948 8 6.45644 8H17.5436C18.1305 8 18.4568 8.67895 18.0902 9.13729L12.5466 16.0667C12.2664 16.417 11.7336 16.417 11.4534 16.0667Z"></path></svg>';
  var ICON_PIN = '<svg class="svg-icon" fill="none" height="20" width="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="icon--primary-color" d="M12 1.5a7.8 7.8 0 0 0-7.8 7.8c0 3.9 4.3 9.5 6.4 12.3.3.4.6.8.8 1.1.3.4.9.4 1.2 0l.8-1.1c2-2.8 6.4-8.4 6.4-12.3A7.8 7.8 0 0 0 12 1.5Zm0 10.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2Z"></path></svg>';
  var ICON_X = '<svg class="svg-icon" fill="none" height="20" width="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="icon--primary-color" d="M16.6 6.2 12 10.8 7.4 6.2a.75.75 0 1 0-1.1 1.1l4.6 4.6-4.6 4.6a.75.75 0 1 0 1.1 1.1l4.6-4.6 4.6 4.6a.75.75 0 1 0 1.1-1.1L13 11.9l4.6-4.6a.75.75 0 1 0-1-1.1Z"></path></svg>';
  var ICON_FILE = '<svg class="svg-icon" fill="none" height="20" width="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path class="icon--primary-color" d="M6 2h8l4 4v16H6V2Zm7 1.5V7h3.5L13 3.5Z"></path></svg>';
  var ICON_ERR = '<svg class="svg-icon" fill="none" height="16" width="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#b3261e" d="M12 1.2a10.8 10.8 0 1 0 0 21.6 10.8 10.8 0 0 0 0-21.6Zm.7 13.2h-1.4V6.5h1.4v7.9Zm-.7 3.8a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"></path></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c];
    });
  }
  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function star(required) {
    return required ? '<span aria-hidden="true">*</span>' : '';
  }

  // ------------------------------------------------------------------------
  // Field errors: aria-invalid on the control and a helper-text--error node
  // with id "<id>-error" (the control's aria-errormessage target).
  // ------------------------------------------------------------------------
  function setError(id, anchor, msg) {
    var ctl = document.getElementById(id);
    var old = document.getElementById(id + '-error');
    if (old) old.remove();
    if (ctl) ctl.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) {
      var p = h('<p id="' + esc(id) + '-error" class="helper-text helper-text--error">' + ICON_ERR + '<span></span></p>');
      p.lastChild.textContent = msg;
      anchor.appendChild(p);
    }
  }

  // ------------------------------------------------------------------------
  // react-select look-alike
  // ------------------------------------------------------------------------
  var instances = {};

  function Select(o) {
    this.o = o;
    this.value = o.multi ? [] : null;
    this.isOpen = false;
    this.focusedIdx = -1;
    this.inputValue = '';
    this.items = [];
    this.loading = false;
    this.asyncResults = [];
    this.build();
    instances[o.id] = this;
  }
  Select.prototype.build = function () {
    var o = this.o;
    var id = o.id;
    var self = this;
    var ph = o.placeholder === undefined ? 'Select...' : o.placeholder;
    this.el = h(
      '<div class="select"><div class="select__container">' +
        '<label id="' + id + '-label" for="' + id + '" class="label select__label">' + esc(o.label) + star(o.required) + '</label>' +
        '<div class="select-shell remix-css-b62m3t-container">' +
        '<span id="react-select-' + id + '-live-region" class="remix-css-7pg0cj-a11yText"></span>' +
        '<span aria-live="polite" aria-atomic="false" aria-relevant="additions text" role="log" class="remix-css-7pg0cj-a11yText"></span>' +
        '<div><div class="select__control remix-css-13cymwt-control">' +
        '<div class="select__value-container' + (o.multi ? ' select__value-container--is-multi' : '') + ' remix-css-hlgwow">' +
        '<div class="select__placeholder remix-css-1jqq78o-placeholder" id="react-select-' + id + '-placeholder">' + esc(ph) + '</div>' +
        '<div class="select__input-container remix-css-19bb58m" data-value="">' +
        '<input class="select__input" autocapitalize="none" autocomplete="off" autocorrect="off" id="' + id + '" spellcheck="false" tabindex="0" type="text" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true" aria-errormessage="' + id + '-error" aria-invalid="false" aria-labelledby="' + id + '-label" aria-required="' + (o.required ? 'true' : 'false') + '" role="combobox" aria-activedescendant="" aria-describedby="react-select-' + id + '-placeholder" enterkeyhint="done" value="">' +
        '</div></div>' +
        '<div class="select__indicators remix-css-1wy0on6">' + (o.noIndicator ? '' : '<button type="button" class="icon-button icon-button--sm" aria-label="Toggle flyout" tabindex="-1">' + ICON_CARET + '</button>') + '</div>' +
        '</div></div>' +
        '</div></div></div>'
    );
    this.shell = this.el.querySelector('.select-shell');
    this.control = this.el.querySelector('.select__control');
    this.valueContainer = this.el.querySelector('.select__value-container');
    this.inputContainer = this.el.querySelector('.select__input-container');
    this.input = this.el.querySelector('input.select__input');
    this.placeholder = this.el.querySelector('.select__placeholder');
    this.live = this.el.querySelector('#react-select-' + id + '-live-region');
    this.container = this.el.querySelector('.select__container');
    if (!ph) this.placeholder.textContent = '';
    this.syncRequired();

    this.control.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var onIndicator = e.target.closest('.select__indicators');
      if (e.target === self.input) {
        if (!self.isOpen) self.openMenu('first');
        return;
      }
      if (e.target.closest('.select__multi-value__remove')) return;
      e.preventDefault();
      if (document.activeElement !== self.input) {
        self.input.focus();
        self.openMenu('first');
      } else if (!self.isOpen) {
        self.openMenu('first');
      } else if (onIndicator || e.target !== self.input) {
        self.closeMenu();
      }
    });
    this.input.addEventListener('focus', function () {
      self.control.classList.add('select__control--is-focused');
    });
    this.input.addEventListener('blur', function () {
      self.control.classList.remove('select__control--is-focused');
      self.closeMenu();
      self.setInput('');
    });
    this.input.addEventListener('input', function () {
      self.setInput(self.input.value);
      self.focusedIdx = 0;
      if (self.o.loadOptions) self.load();
      self.openMenu(null);
    });
    this.input.addEventListener('keydown', function (e) {
      self.onKey(e);
    });
  };
  Select.prototype.hasValue = function () {
    return this.o.multi ? this.value.length > 0 : !!this.value;
  };
  Select.prototype.syncRequired = function () {
    var ri = this.shell.querySelector('.remix-css-1a0ro4n-requiredInput');
    var need = this.o.required && !this.hasValue();
    if (need && !ri) {
      this.shell.appendChild(h('<input required="" tabindex="-1" aria-hidden="true" class="remix-css-1a0ro4n-requiredInput" value="">'));
    } else if (!need && ri) ri.remove();
  };
  Select.prototype.setInput = function (v) {
    this.inputValue = v;
    if (this.input.value !== v) this.input.value = v;
    this.inputContainer.setAttribute('data-value', v);
    this.renderValue();
  };
  Select.prototype.options = function () {
    var self = this;
    var src = this.o.loadOptions ? this.asyncResults : this.o.options;
    var q = this.inputValue.trim().toLowerCase();
    return src.filter(function (opt) {
      if (self.o.multi && self.value.some(function (v) { return String(v.value) === String(opt.value); })) return false;
      if (self.o.loadOptions) return true;
      return !q || (opt.label + ' ' + opt.value).toLowerCase().indexOf(q) !== -1;
    });
  };
  Select.prototype.load = function () {
    var self = this;
    var q = this.inputValue;
    this.loading = true;
    this.asyncResults = [];
    clearTimeout(this._t);
    this._t = setTimeout(function () {
      self.o.loadOptions(q, function (list) {
        if (q !== self.inputValue) return;
        self.loading = false;
        self.asyncResults = list;
        self.focusedIdx = list.length ? 0 : -1;
        self.renderMenu();
      });
    }, 300);
  };
  Select.prototype.openMenu = function (where) {
    this.isOpen = true;
    this.items = this.options();
    if (where === 'first') this.focusedIdx = this.items.length ? 0 : -1;
    else if (where === 'last') this.focusedIdx = this.items.length - 1;
    else if (this.focusedIdx >= this.items.length) this.focusedIdx = this.items.length ? 0 : -1;
    this.renderMenu();
  };
  Select.prototype.closeMenu = function () {
    this.isOpen = false;
    this.focusedIdx = -1;
    this.renderMenu();
  };
  Select.prototype.optionId = function (i) {
    return 'react-select-' + this.o.id + '-option-' + i;
  };
  Select.prototype.renderMenu = function () {
    var self = this;
    var menu = this.shell.querySelector('.select__menu');
    if (menu) menu.remove();
    this.input.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
    if (!this.isOpen) {
      this.input.removeAttribute('aria-controls');
      this.input.setAttribute('aria-activedescendant', '');
      return;
    }
    this.items = this.options();
    var listId = 'react-select-' + this.o.id + '-listbox';
    this.input.setAttribute('aria-controls', listId);
    menu = h('<div class="select__menu remix-css-1nmdiq5-menu"><div class="select__menu-list remix-css-1n6sfyn-MenuList" role="listbox" aria-multiselectable="' + (this.o.multi ? 'true' : 'false') + '" id="' + listId + '"></div></div>');
    var list = menu.firstChild;
    if (this.o.loadOptions && (this.loading || !this.inputValue)) {
      if (this.loading) list.appendChild(h('<div class="select__menu-notice select__menu-notice--loading remix-css-1cfhyq5-loadingMessage">Loading...</div>'));
      else list.appendChild(h('<div class="select__menu-notice select__menu-notice--no-options remix-css-1cfhyq5-noOptionsMessage">Start typing...</div>'));
    } else if (!this.items.length) {
      list.appendChild(h('<div class="select__menu-notice select__menu-notice--no-options remix-css-1cfhyq5-noOptionsMessage">No options</div>'));
    } else {
      this.items.forEach(function (opt, i) {
        var selected = !self.o.multi && self.value && String(self.value.value) === String(opt.value);
        var cls = 'select__option' + (i === self.focusedIdx ? ' select__option--is-focused' : '') + (selected ? ' select__option--is-selected' : '');
        var row = h('<div class="' + cls + ' remix-css-' + (i === self.focusedIdx ? 'd7l1ni' : '10wo9uf') + '-option" aria-disabled="false" id="' + self.optionId(i) + '" tabindex="-1" role="option" aria-selected="' + (selected ? 'true' : 'false') + '"></div>');
        row.textContent = opt.label;
        row.addEventListener('mousemove', function () {
          if (self.focusedIdx !== i) self.focus(i);
        });
        row.addEventListener('mouseover', function () {
          if (self.focusedIdx !== i) self.focus(i);
        });
        row.addEventListener('click', function () {
          self.select(opt);
        });
        list.appendChild(row);
      });
    }
    menu.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (document.activeElement !== self.input) self.input.focus();
    });
    this.shell.appendChild(menu);
    var cur = this.focusedIdx >= 0 ? list.children[this.focusedIdx] : null;
    this.input.setAttribute('aria-activedescendant', cur && cur.id ? cur.id : '');
    if (cur && cur.scrollIntoView && list.scrollHeight > list.clientHeight) {
      var top = cur.offsetTop;
      if (top < list.scrollTop || top + cur.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - 4;
    }
    if (cur) this.live.textContent = 'option ' + this.items[this.focusedIdx].label + ' focused, ' + (this.focusedIdx + 1) + ' of ' + this.items.length + '. ' + this.items.length + ' results available. Use Up and Down to choose options, press Enter to select the currently focused option, press Escape to exit the menu, press Tab to select the option and exit the menu.';
  };
  Select.prototype.focus = function (i) {
    this.focusedIdx = i;
    this.renderMenu();
  };
  Select.prototype.renderValue = function () {
    var self = this;
    var vc = this.valueContainer;
    vc.querySelectorAll('.select__single-value,.select__multi-value').forEach(function (n) { n.remove(); });
    if (this.placeholder.parentNode) this.placeholder.remove();
    if (this.o.multi) {
      this.value.forEach(function (v, idx) {
        var chip = h('<div class="select__multi-value remix-css-1p3m7a8-multiValue"><div class="select__multi-value__label remix-css-9jq23d"></div><div role="button" class="select__multi-value__remove remix-css-v7duua" aria-label="Remove ' + esc(v.label) + '">' + ICON_X + '</div></div>');
        chip.firstChild.textContent = v.label;
        chip.lastChild.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
        });
        chip.lastChild.addEventListener('click', function () {
          self.value.splice(idx, 1);
          self.changed();
        });
        vc.insertBefore(chip, self.inputContainer);
      });
      if (!this.value.length && !this.inputValue) vc.insertBefore(this.placeholder, this.inputContainer);
    } else if (this.value && !this.inputValue) {
      var sv = h('<div class="select__single-value remix-css-1dimb5e-singleValue"></div>');
      sv.textContent = this.value.label;
      vc.insertBefore(sv, this.inputContainer);
    } else if (!this.inputValue) {
      vc.insertBefore(this.placeholder, this.inputContainer);
    }
    this.input.setAttribute('aria-describedby', this.hasValue() || this.inputValue ? '' : 'react-select-' + this.o.id + '-placeholder');
    if (!this.input.getAttribute('aria-describedby')) this.input.removeAttribute('aria-describedby');
  };
  Select.prototype.changed = function () {
    this.renderValue();
    this.syncRequired();
    if (this.hasValue()) setError(this.o.id, this.container, '');
    if (this.o.onChange) this.o.onChange(this.value);
  };
  Select.prototype.select = function (opt) {
    if (this.o.multi) this.value.push(opt);
    else this.value = opt;
    this.live.textContent = 'option ' + opt.label + ', selected.';
    this.isOpen = false;
    this.focusedIdx = -1;
    this.setInput('');
    this.renderMenu();
    this.changed();
  };
  Select.prototype.clear = function () {
    this.value = this.o.multi ? [] : null;
    this.changed();
  };
  Select.prototype.onKey = function (e) {
    var n = this.items.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!this.isOpen) return this.openMenu('first');
        if (n) this.focus((this.focusedIdx + 1) % n);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (!this.isOpen) return this.openMenu('last');
        if (n) this.focus((this.focusedIdx - 1 + n) % n);
        return;
      case 'Enter':
        if (e.keyCode === 229) return;
        if (this.isOpen) {
          if (this.focusedIdx < 0 || !this.items[this.focusedIdx]) return;
          e.preventDefault();
          this.select(this.items[this.focusedIdx]);
        }
        return; // closed menu: Enter falls through to implicit form submission, as in react-select
      case 'Tab':
        if (e.shiftKey || !this.isOpen || this.focusedIdx < 0 || !this.items[this.focusedIdx]) return;
        this.select(this.items[this.focusedIdx]);
        return;
      case 'Escape':
        if (this.isOpen) {
          e.preventDefault();
          this.closeMenu();
          this.setInput('');
        }
        return;
      case ' ':
        if (this.inputValue) return;
        e.preventDefault();
        if (!this.isOpen) return this.openMenu('first');
        if (this.items[this.focusedIdx]) this.select(this.items[this.focusedIdx]);
        return;
      case 'Backspace':
        if (this.inputValue) return;
        if (this.o.multi && this.value.length) {
          this.value.pop();
          this.changed();
          if (this.isOpen) this.renderMenu();
        }
        return;
    }
  };

  // ------------------------------------------------------------------------
  // Location control (Pelias geocoder in production; a local table here)
  // ------------------------------------------------------------------------
  var PLACES = [
    ['Lahore, Punjab, Pakistan', 31.5204, 74.3587],
    ['Lahore Cantonment, Punjab, Pakistan', 31.5165, 74.3712],
    ['Karachi, Sindh, Pakistan', 24.8607, 67.0011],
    ['Islamabad, Islamabad Capital Territory, Pakistan', 33.6844, 73.0479],
    ['Lagos, Lagos, Nigeria', 6.5244, 3.3792],
    ['Lahaina, Hawaii, United States', 20.8783, -156.6825],
    ['London, England, United Kingdom', 51.5072, -0.1276],
    ['Berlin, Berlin, Germany', 52.52, 13.405],
    ['Dubai, Dubai, United Arab Emirates', 25.2048, 55.2708],
    ['San Francisco, California, United States', 37.7749, -122.4194],
    ['New York, New York, United States', 40.7128, -74.006],
    ['Toronto, Ontario, Canada', 43.6532, -79.3832],
    ['Amsterdam, North Holland, Netherlands', 52.3676, 4.9041],
  ];
  function geocode(q, cb) {
    q = q.trim().toLowerCase();
    var out = q.length < 2 ? [] : PLACES.filter(function (p) { return p[0].toLowerCase().indexOf(q) !== -1; }).slice(0, 7);
    cb(out.map(function (p) { return { label: p[0], value: p[0], lat: p[1], lng: p[2] }; }));
  }

  var COUNTRIES = [
    ['US', 'United States', '1'], ['CA', 'Canada', '1'], ['GB', 'United Kingdom', '44'], ['DE', 'Germany', '49'],
    ['NL', 'Netherlands', '31'], ['IE', 'Ireland', '353'], ['IN', 'India', '91'], ['PK', 'Pakistan', '92'],
    ['AE', 'United Arab Emirates', '971'], ['SA', 'Saudi Arabia', '966'], ['NG', 'Nigeria', '234'], ['KE', 'Kenya', '254'],
    ['EG', 'Egypt', '20'], ['TR', 'Turkey', '90'], ['BR', 'Brazil', '55'], ['MX', 'Mexico', '52'],
    ['AU', 'Australia', '61'], ['SG', 'Singapore', '65'], ['PH', 'Philippines', '63'], ['BD', 'Bangladesh', '880'],
    ['PL', 'Poland', '48'], ['ES', 'Spain', '34'], ['FR', 'France', '33'], ['PT', 'Portugal', '351'],
  ];

  // ------------------------------------------------------------------------
  // Page skeleton
  // ------------------------------------------------------------------------
  var mount = document.getElementById('fx-app');
  var cfg = root.boardConfiguration;
  var shell = h(
    '<main class="main font-secondary job-post"><div class="' + (embedded ? 'job__embedded-wrapper' : 'job-post-container') + '">' +
      '<div class="image-container"><a href="' + esc(cfg.logo.href) + '" target="_blank" rel="noreferrer" class="logo"><span class="logo-mark" aria-hidden="true">' + esc(jp.company_name.charAt(0)) + '</span><span class="logo-text">' + esc(jp.company_name) + '</span></a></div>' +
      '<div>' +
      (embedded ? '<a class="link back-link" target="_top" href="' + esc(cfg.job_board_public_url) + '">&larr; Back to jobs</a>' : '') +
      '<div class="job__tags"></div>' +
      '<div class="job__header"><div class="job__title"><h1 class="section-header section-header--large font-primary"></h1><div class="job__location">' + ICON_PIN + '<div></div></div></div>' +
      '<button type="button" class="btn btn--' + cfg.button_shape + '" aria-label="Apply">Apply</button></div>' +
      '<div class="job__description body"></div>' +
      '<div class="application--container">' +
      '<div class="application--header"><h2 class="section-header section-header--medium font-primary">Apply for this job</h2><div class="required-legend"><span aria-hidden="true">*</span> indicates a required field</div></div>' +
      '<div class="error-banner" role="alert" hidden></div>' +
      '<form method="get" action="/' + esc(route.urlToken) + '/jobs/' + esc(route.jobPostId) + '" id="application-form" class="application--form" data-discover="true">' +
      '<div class="application--questions" id="fx-main-questions"></div>' +
      '<div class="application--questions" id="fx-custom-questions"><hr></div>' +
      '<div class="application--submit"><button type="submit" class="btn btn--' + cfg.button_shape + '" aria-disabled="false">Submit application</button></div>' +
      '</form></div>' +
      '</div></div></main>'
  );
  shell.querySelector('h1').textContent = jp.title;
  shell.querySelector('.job__location div').textContent = jp.job_post_location;
  var desc = shell.querySelector('.job__description');
  desc.innerHTML = '<div>' + jp.content + '</div>';
  (jp.pay_ranges || []).forEach(function (pr) {
    var box = h('<div class="pay-range"><div class="title"></div><div class="range"></div></div>');
    box.firstChild.textContent = pr.title;
    box.lastChild.textContent = pr.min + ' — ' + pr.max + ' ' + pr.currency_type;
    desc.appendChild(box);
  });
  mount.appendChild(shell);
  mount.appendChild(h('<footer class="footer" dir="ltr"><div class="footer-row"><p class="body">Powered by</p><a class="footer-logo-link" target="_blank" href="https://www.greenhouse.com" rel="noreferrer"><strong>greenhouse</strong></a></div></footer>'));

  var form = shell.querySelector('#application-form');
  var mainQ = shell.querySelector('#fx-main-questions');
  var customQ = shell.querySelector('#fx-custom-questions');
  var banner = shell.querySelector('.error-banner');
  shell.querySelector('.job__header .btn').addEventListener('click', function () {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = document.getElementById('first_name');
    if (first) first.focus({ preventScroll: true });
  });

  var validators = [];
  var collectors = [];

  // ------------------------------------------------------------------------
  // Field renderers
  // ------------------------------------------------------------------------
  var AUTOCOMPLETE = { first_name: 'given-name', last_name: 'family-name', preferred_name: 'nickname', email: 'email' };

  function textField(q, f, multiline) {
    var id = f.name;
    var aria = 'aria-label="' + esc(q.label) + '" aria-describedby="' + id + '-description ' + id + '-error ' + id + '-help" aria-invalid="false" aria-errormessage="' + id + '-error" aria-required="' + (q.required ? 'true' : 'false') + '"';
    var control = multiline
      ? '<textarea id="' + id + '" class="input input__multi-line" ' + aria + ' rows="4"></textarea>'
      : '<input id="' + id + '" class="input input__single-line" ' + aria + ' type="' + (id === 'phone' ? 'tel' : 'text') + '" maxlength="255"' + (AUTOCOMPLETE[id] ? ' autocomplete="' + AUTOCOMPLETE[id] + '"' : '') + ' value="">';
    var w = h(
      '<div class="field-wrapper' + (multiline ? ' field-wrapper--multiline' : '') + '"><div class="text-input-wrapper"><div class="input-wrapper' + (multiline ? ' input-wrapper__multi-line' : '') + '">' +
        '<label id="' + id + '-label" for="' + id + '" class="label label">' + esc(q.label) + star(q.required) + '</label>' + control +
        (q.description ? '<p id="' + id + '-description" class="helper-text">' + esc(q.description) + '</p>' : '') +
        '</div></div></div>'
    );
    var el = w.querySelector('#' + CSS.escape(id));
    var anchor = w.querySelector('.input-wrapper');
    el.addEventListener('input', function () {
      if (el.getAttribute('aria-invalid') === 'true' && el.value.trim()) setError(id, anchor, '');
    });
    validators.push(function () {
      var v = el.value.trim();
      var msg = '';
      if (q.required && !v) msg = 'This field is required.';
      else if (id === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) msg = 'Enter a valid email address.';
      setError(id, anchor, msg);
      return msg ? el : null;
    });
    if (id !== 'phone') collectors.push(function (fd) {
      fd.append(id, el.value.trim());
    });
    return w;
  }

  function selectField(q, f, extra) {
    var s = new Select(Object.assign({
      id: f.name,
      label: q.label,
      required: q.required,
      multi: f.type === 'multi_value_multi_select',
      options: (f.values || []).map(function (v) { return { label: v.label, value: v.value }; }),
    }, extra || {}));
    var w = h('<div class="field-wrapper"></div>');
    w.appendChild(s.el);
    if (q.description) {
      var d = h('<p id="' + f.name + '-description" class="helper-text"></p>');
      d.textContent = q.description;
      s.container.appendChild(d);
    }
    validators.push(function () {
      var bad = q.required && !s.hasValue();
      setError(f.name, s.container, bad ? 'This field is required.' : '');
      if (bad) s.control.classList.add('select__control--invalid');
      else s.control.classList.remove('select__control--invalid');
      return bad ? s.input : null;
    });
    collectors.push(function (fd) {
      if (s.o.multi) s.value.forEach(function (v) { fd.append(f.name + '[]', String(v.value)); });
      else if (s.value) fd.append(f.name, String(s.value.value));
    });
    return { wrapper: w, select: s };
  }

  function phoneField(q) {
    var wrap = h('<div><fieldset class="phone-input"><legend class="visually-hidden">Phone</legend><div class="phone-input__country"></div><div class="phone-input__phone"></div></fieldset></div>');
    var country = new Select({
      id: 'country',
      label: 'Country',
      required: false,
      placeholder: '',
      options: COUNTRIES.map(function (c) { return { label: c[1] + ' +' + c[2], value: c[0], dial: c[2] }; }),
    });
    wrap.querySelector('.phone-input__country').appendChild(country.el);
    var tf = textField(q, { name: 'phone' }, false);
    wrap.querySelector('.phone-input__phone').appendChild(tf.querySelector('.text-input-wrapper'));
    var el = wrap.querySelector('#phone');
    collectors.push(function (fd) {
      var v = el.value.trim();
      if (v && v.charAt(0) !== '+' && country.value) v = '+' + country.value.dial + ' ' + v.replace(/^0+/, '');
      fd.append('phone', v);
    });
    return wrap;
  }

  function locationField(q) {
    var res = selectField(q, { name: 'candidate-location' }, { placeholder: '', noIndicator: true, loadOptions: geocode });
    var s = res.select;
    var locate = h('<button type="button" class="btn--tertiary">Locate me</button>');
    locate.addEventListener('click', function () {
      var p = h('<p class="helper-text" role="status">We couldn\'t determine your location. Please type your city.</p>');
      s.container.appendChild(p);
      setTimeout(function () { p.remove(); }, 4000);
    });
    res.wrapper.appendChild(locate);
    collectors.pop();
    collectors.push(function (fd) {
      if (!s.value) return;
      fd.append('candidate_location', s.value.label);
      fd.append('latitude', String(s.value.lat));
      fd.append('longitude', String(s.value.lng));
    });
    return res.wrapper;
  }

  function fileField(q, fileName, textName) {
    var label = q.label;
    var types = 'pdf, doc, docx, txt, rtf';
    var w = h(
      '<div class="field-wrapper"><div role="group" aria-labelledby="upload-label-' + fileName + '" aria-required="' + (q.required ? 'true' : 'false') + '" class="file-upload" data-allow-s3="false">' +
        '<div id="upload-label-' + fileName + '" class="label upload-label">' + esc(label) + (q.required ? '<span class="required">*</span>' : '') + '</div>' +
        '<div class="file-upload__wrapper"><div class="button-container">' +
        '<div class="secondary-button"><div><button type="button" class="btn btn--' + cfg.button_shape + '">Attach</button><label class="visually-hidden" for="' + fileName + '">Attach</label><input id="' + fileName + '" class="visually-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.rtf"></div></div>' +
        (cfg.enable_dropbox ? '<div class="secondary-button"><button type="button" class="btn btn--' + cfg.button_shape + '" data-testid="' + fileName + '-dropbox">Dropbox</button></div>' : '') +
        (cfg.google_drive_enabled ? '<div class="secondary-button"><button type="button" class="btn btn--' + cfg.button_shape + '">Google Drive</button></div>' : '') +
        '<div class="secondary-button"><div><button type="button" class="btn btn--' + cfg.button_shape + '" data-testid="' + fileName + '-text">Enter manually</button><label class="visually-hidden" for="' + textName + '">Enter manually</label></div></div>' +
        '<p id="accepted-filetypes" class="file-upload__filetypes">Accepted file types: ' + types + '</p>' +
        '</div></div></div></div>'
    );
    var group = w.querySelector('.file-upload');
    var wrapper = w.querySelector('.file-upload__wrapper');
    var buttons = w.querySelector('.button-container');
    var input = w.querySelector('input[type=file]');
    var mode = null; // 'file' | 'text'
    var textEl = null;
    var chip = null;

    function reset() {
      mode = null;
      input.value = '';
      if (chip) chip.remove();
      chip = null;
      var t = wrapper.querySelector('.file-upload__text');
      if (t) t.remove();
      textEl = null;
      buttons.hidden = false;
    }
    w.querySelector('.secondary-button button').addEventListener('click', function () {
      input.click();
    });
    w.querySelectorAll('.secondary-button button').forEach(function (b) {
      if (b.textContent === 'Dropbox' || b.textContent === 'Google Drive') {
        b.addEventListener('click', function () {
          alert(b.textContent + ' is unavailable in this environment.');
        });
      }
    });
    w.querySelector('[data-testid="' + fileName + '-text"]').addEventListener('click', function () {
      reset();
      mode = 'text';
      buttons.hidden = true;
      var t = h('<div class="file-upload__text"><div class="text-input-wrapper"><div class="input-wrapper input-wrapper__multi-line"><label class="visually-hidden" for="' + textName + '">' + esc(label) + '</label><textarea id="' + textName + '" class="input input__multi-line" aria-invalid="false" aria-required="' + (q.required ? 'true' : 'false') + '" rows="8"></textarea></div></div><button type="button" class="btn--tertiary" aria-label="Remove">Remove</button></div>');
      t.querySelector('button').addEventListener('click', reset);
      wrapper.appendChild(t);
      textEl = t.querySelector('textarea');
      textEl.focus();
    });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      if (['pdf', 'doc', 'docx', 'txt', 'rtf'].indexOf(ext) === -1) {
        input.value = '';
        setError(fileName, group, 'File type not supported. Accepted file types: ' + types);
        return;
      }
      if (f.size > 100 * 1024 * 1024) {
        input.value = '';
        setError(fileName, group, 'File exceeds the maximum upload size of 100MB.');
        return;
      }
      mode = 'file';
      buttons.hidden = true;
      if (chip) chip.remove();
      chip = h('<div class="file-upload__filename">' + ICON_FILE + '<span class="filename"></span><button type="button" class="icon-button icon-button--sm" aria-label="Remove file">' + ICON_X + '</button></div>');
      chip.querySelector('.filename').textContent = f.name;
      chip.querySelector('button').addEventListener('click', reset);
      wrapper.insertBefore(chip, buttons);
      group.classList.remove('file-upload--invalid');
      setError(fileName, group, '');
    });
    validators.push(function () {
      var ok = mode === 'file' ? !!(input.files && input.files.length) : mode === 'text' ? !!(textEl && textEl.value.trim()) : false;
      var bad = q.required && !ok;
      group.classList.toggle('file-upload--invalid', bad);
      setError(fileName, group, bad ? 'This field is required.' : '');
      return bad ? w.querySelector('.secondary-button button') : null;
    });
    collectors.push(function (fd) {
      if (mode === 'file' && input.files[0]) fd.append(fileName, input.files[0], input.files[0].name);
      else if (mode === 'text' && textEl) fd.append(textName, textEl.value);
    });
    return w;
  }

  // ------------------------------------------------------------------------
  // Build the questions
  // ------------------------------------------------------------------------
  var MAIN = { first_name: 1, last_name: 1, preferred_name: 1, email: 1, phone: 1, candidate_location: 1, resume: 1, cover_letter: 1 };
  jp.questions.forEach(function (q) {
    var f = q.fields[0];
    var target = MAIN[f.name] ? mainQ : customQ;
    var node;
    if (f.name === 'phone') node = phoneField(q);
    else if (f.name === 'candidate_location') node = locationField(q);
    else if (f.type === 'input_file') node = fileField(q, f.name, q.fields[1] ? q.fields[1].name : f.name + '_text');
    else if (f.type === 'input_text') node = textField(q, f, false);
    else if (f.type === 'textarea') node = textField(q, f, true);
    else if (f.type === 'multi_value_single_select' || f.type === 'multi_value_multi_select') node = selectField(q, f).wrapper;
    if (node) target.appendChild(node);
  });

  // EEOC (U.S. voluntary self-identification)
  if (jp.enable_eeoc && jp.eeoc_sections) {
    var eeoc = h('<div class="eeoc__container body"><div class="divider" role="separator"></div></div>');
    var raceWrap = null;
    var raceSelect = null;
    jp.eeoc_sections.forEach(function (sec) {
      eeoc.appendChild(h('<div>' + sec.description + '</div>'));
      sec.questions.forEach(function (q) {
        var f = q.fields[0];
        var res = selectField(q, f);
        var wrap = h('<div class="eeoc__question__wrapper"></div>');
        wrap.appendChild(res.select.el);
        eeoc.appendChild(wrap);
        if (f.name === 'hispanic_ethnicity') {
          res.select.o.onChange = function (v) {
            // Greenhouse asks for race only when the candidate answers "No".
            var show = v && v.value === 'No';
            raceWrap.hidden = !show;
            if (!show && raceSelect.hasValue()) raceSelect.clear();
          };
        }
        if (f.name === 'race') {
          raceWrap = wrap;
          raceSelect = res.select;
          wrap.hidden = true;
        }
      });
    });
    form.insertBefore(eeoc, form.querySelector('.application--submit'));
  }

  // ------------------------------------------------------------------------
  // Submit: validate, then multipart FormData via fetch
  // ------------------------------------------------------------------------
  var submitBtn = form.querySelector('.application--submit button');
  function runValidators() {
    var firstBad = null;
    validators.forEach(function (v) {
      var bad = v();
      if (bad && !firstBad) firstBad = bad;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }
  // The app validates when the button is pressed (inline "This field is required."
  // on every missing field). An implicit submit (Enter in a text input) skips this
  // and meets the browser's native check on the react-select required inputs instead.
  submitBtn.addEventListener('click', function (e) {
    if (submitBtn.getAttribute('aria-disabled') === 'true') return;
    if (!runValidators()) e.preventDefault();
  });
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (submitBtn.getAttribute('aria-disabled') === 'true') return;
    banner.hidden = true;
    if (!runValidators()) return;
    var fd = new FormData();
    fd.append('mapped_url_token', route.urlToken);
    fd.append('job_post_id', String(route.jobPostId));
    fd.append('fingerprint', jp.fingerprint);
    fd.append('embedded', embedded ? 'true' : 'false');
    collectors.forEach(function (c) { c(fd); });
    submitBtn.setAttribute('aria-disabled', 'true');
    submitBtn.textContent = 'Submitting...';
    try {
      var result = await FX.postForm(FORM_ID, fd);
      if (FX.finish(result)) return;
      banner.textContent = 'There was a problem submitting your application: ' + ((result && result.errors) || []).join('; ');
      banner.hidden = false;
    } catch (err) {
      banner.textContent = 'There was a problem submitting your application. Please try again.';
      banner.hidden = false;
    }
    submitBtn.setAttribute('aria-disabled', 'false');
    submitBtn.textContent = 'Submit application';
  });

  // ------------------------------------------------------------------------
  // Embedded: keep the parent's iframe as tall as this document
  // ------------------------------------------------------------------------
  if (embedded && window.parent !== window) {
    var last = 0;
    var post = function () {
      var hgt = Math.ceil(document.documentElement.scrollHeight);
      if (hgt !== last) {
        last = hgt;
        window.parent.postMessage(hgt, '*');
      }
    };
    window.addEventListener('message', function (e) {
      if (e.data === 'resize') {
        last = 0;
        post();
      }
    });
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.body);
    window.addEventListener('load', post);
    post();
  }
})();

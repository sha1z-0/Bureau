/*
 * Local stand-in for SmartRecruiters' "spl-core-components" (the Lit-based
 * design-system web components the OneClick apply UI is built from).
 * Every component renders into an OPEN shadow root, like the real ones, and
 * reproduces the parts of their DOM a form engine has to deal with:
 *
 *   spl-input / spl-textarea      <spl-internal-form-field> (itself a shadow host)
 *                                 > label.c-spl-form-field-label[for] + input.c-spl-input
 *                                 aria-invalid / aria-required on the inner control,
 *                                 error text in span[role=alert].c-spl-form-field-error-live
 *   spl-phone-field               country-code combobox (listbox + search) + tel input
 *   spl-autocomplete              combobox input, minQueryLength, async options, listbox in shadow
 *   spl-select                    button[role=combobox] + listbox; options from light <spl-select-option>
 *   spl-radio-group / spl-radio   NO native radios: hosts carry role=radio + aria-checked
 *   spl-checkbox                  native checkbox inside shadow, label from slot "label-content"
 *   spl-dropzone                  "Choose a file / or drop it here", hidden file input, file list
 *   spl-button                    native <button> inside shadow
 *
 * Inner `change` events are not composed, so (as with the real library) only
 * `input` and the custom `spl-change` / `spl-upload` / `spl-delete` events reach
 * the host's listeners. Vanilla JS, no dependencies.
 */
(function () {
  'use strict';

  var CSS =
    ':host{display:block;font-family:Arial,Helvetica,sans-serif;color:#383c38}' +
    '.c-spl-form-field-label{display:block;font-size:14px;font-weight:600;margin:0 0 4px}' +
    '.c-spl-form-field-required-mark{color:#cf1500;margin-left:2px}' +
    '.c-spl-form-field-description{display:block;font-size:12px;color:#6a6e6a;margin:0 0 4px}' +
    '.c-spl-input-wrapper{position:relative}' +
    '.c-spl-input,.c-spl-textarea,.c-spl-select-trigger{box-sizing:border-box;width:100%;min-height:40px;padding:8px 12px;border:1px solid #9a9e9a;border-radius:4px;font:14px Arial,Helvetica,sans-serif;background:#fff;color:#383c38}' +
    '.c-spl-textarea{min-height:120px;resize:vertical}' +
    '.c-spl-input:focus,.c-spl-textarea:focus,.c-spl-select-trigger:focus{outline:2px solid #0850b2;outline-offset:1px}' +
    '.c-spl-input--error,.c-spl-select-trigger--error{border-color:#cf1500}' +
    '.c-spl-select-trigger{display:flex;align-items:center;justify-content:space-between;cursor:pointer;text-align:left}' +
    '.c-spl-select-placeholder{color:#6a6e6a}' +
    '.c-spl-dropdown{position:absolute;z-index:50;left:0;right:0;top:100%;margin-top:2px;background:#fff;border:1px solid #c4c8c4;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.15);max-height:240px;overflow:auto;padding:4px 0}' +
    '.c-spl-dropdown[hidden]{display:none}' +
    '.c-spl-dropdown-item{padding:8px 12px;cursor:pointer;font-size:14px}' +
    '.c-spl-dropdown-item[aria-selected=true],.c-spl-dropdown-item--active{background:#e8f0fd}' +
    '.c-spl-dropdown-status{padding:8px 12px;color:#6a6e6a;font-size:13px}' +
    '.c-spl-phone{display:flex;gap:8px}.c-spl-phone .c-spl-select-trigger{width:132px;flex:none}' +
    '.c-spl-dropdown-search{box-sizing:border-box;width:calc(100% - 16px);margin:4px 8px;padding:6px 8px;border:1px solid #9a9e9a;border-radius:4px}' +
    '.c-spl-checkbox-wrapper{display:flex;align-items:flex-start;gap:8px;font-size:14px}' +
    '.c-spl-checkbox__input{width:18px;height:18px;margin:2px 0 0}' +
    '.c-spl-radio-group{display:flex;gap:16px;flex-wrap:wrap}' +
    '.c-spl-dropzone-wrapper{display:flex;flex-direction:column;align-items:center;padding:24px;border:2px dashed #0b66e4;border-radius:4px;background:#fff;position:relative;cursor:pointer}' +
    '.c-spl-dropzone--dragover{background:#e8f0fd}' +
    '.c-spl-dropzone-label{font-size:14px}.c-spl-dropzone-label-browse{color:#0b66e4;font-weight:700;margin-right:4px}' +
    '.c-spl-dropzone-label-restriction{display:block;color:#6a6e6a;font-size:12px;margin-top:6px}' +
    '.c-spl-dropzone-wrapper input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}' +
    '.c-spl-file-list{list-style:none;margin:0;padding:0}.c-spl-file-list-item{display:grid;grid-template-columns:auto 80px;margin-top:16px;align-items:center}' +
    '.c-spl-file-list-item-name{display:block;font-size:14px}.c-spl-file-list-item-size{display:block;font-size:12px;color:#6a6e6a}' +
    '.c-spl-button{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 20px;border-radius:4px;border:1px solid #0b66e4;background:#0b66e4;color:#fff;font:600 14px Arial,Helvetica,sans-serif;cursor:pointer}' +
    '.c-spl-button--secondary{background:#fff;color:#0b66e4}.c-spl-button--tertiary{background:transparent;border-color:transparent;color:#0b66e4}' +
    '.c-spl-button:disabled{opacity:.5;cursor:not-allowed}';

  var FIELD_CSS =
    ':host{display:block}.c-spl-form-field{display:block;margin-bottom:4px}' +
    '.c-spl-form-field-error{display:block;color:#cf1500;font-size:12px;line-height:16px}' +
    '.c-spl-form-field-error--spaced{min-height:20px}';

  var uid = 0;
  function nextId(p) {
    uid += 1;
    return p + '-' + uid;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function bool(el, name) {
    return el.hasAttribute(name) && el.getAttribute(name) !== 'false';
  }
  function emit(el, type, detail) {
    el.dispatchEvent(new CustomEvent(type, { detail: detail, bubbles: true, composed: true }));
  }
  function labelHtml(id, text, required) {
    if (!text) return '';
    return (
      '<label class="c-spl-form-field-label" slot="label" for="' + id + '" id="' + id + '-label" data-sr-id="fieldLabelWrapper">' +
      '<spl-typography-label variant="md"><span class="c-spl-form-field-label-wrapper" data-sr-id="fieldLabel">' +
      '<span class="c-spl-form-field-label-required-group">' + esc(text) +
      (required ? '<span class="c-spl-form-field-required-mark" aria-hidden="true">*</span>' : '') +
      '</span><span class="c-spl-form-field-label-suffix"><slot name="label-suffix"></slot></span></span></spl-typography-label></label>'
    );
  }

  /* ------------------------------------------------------------ form field */
  class SplInternalFormField extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._msg = '';
      this.shadowRoot.innerHTML =
        '<style>' + FIELD_CSS + '</style><div class="c-spl-form-field c-spl-form-field--vertical"><slot name="label"></slot><slot name="description"></slot><slot></slot>' +
        '<spl-typography-body variant="sm" class="c-spl-form-field-error c-spl-form-field-error--spaced"><span class="c-spl-form-field-error-wrapper"><slot name="error-msg"></slot></span></spl-typography-body></div>';
      this._err = this.shadowRoot.querySelector('.c-spl-form-field-error-wrapper');
    }
    set errorMsg(m) {
      this._msg = m || '';
      var old = this._err.querySelector('.c-spl-form-field-error-live');
      if (old) old.remove();
      if (this._msg) {
        var s = document.createElement('span');
        s.setAttribute('role', 'alert');
        s.className = 'c-spl-form-field-error-live';
        s.textContent = this._msg;
        this._err.appendChild(s);
      }
      this.shadowRoot.querySelector('.c-spl-form-field').classList.toggle('c-spl-form-field--invalid', !!this._msg);
    }
    get errorMsg() {
      return this._msg;
    }
  }

  /* Shared behaviour for value-holding components. */
  class SplField extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._errorMsg = '';
    }
    get label() {
      return this.getAttribute('label') || '';
    }
    get required() {
      return bool(this, 'required');
    }
    set required(v) {
      if (v) this.setAttribute('required', '');
      else this.removeAttribute('required');
    }
    get inputId() {
      if (!this._iid) this._iid = this.getAttribute('id') || nextId('spl-input');
      return this._iid;
    }
    set errorMsg(m) {
      this._errorMsg = m || '';
      var f = this.shadowRoot && this.shadowRoot.querySelector('spl-internal-form-field');
      if (f) f.errorMsg = this._errorMsg;
      this._paintError(!!this._errorMsg);
    }
    get errorMsg() {
      return this._errorMsg;
    }
    _paintError() {}
  }

  /* ------------------------------------------------------------ input */
  class SplInput extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var type = this.getAttribute('type') || 'text';
      var desc = this.getAttribute('description');
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required) +
        (desc ? '<span slot="description" class="c-spl-form-field-description" id="' + id + '-description">' + esc(desc) + '</span>' : '') +
        '<div class="c-spl-input-grid"><div class="c-spl-input-slot c-spl-input-slot-hidden"><slot name="before"></slot></div><div class="c-spl-input-wrapper">' +
        '<input class="c-spl-input" id="' + id + '" type="' + esc(type) + '" placeholder="' + esc(this.getAttribute('placeholder') || '') + '"' +
        (this.getAttribute('autocomplete') ? ' autocomplete="' + esc(this.getAttribute('autocomplete')) + '"' : '') +
        (this.getAttribute('maxlength') ? ' maxlength="' + esc(this.getAttribute('maxlength')) + '"' : '') +
        ' aria-invalid="false"' + (this.required ? ' aria-required="true"' : '') + (desc ? ' aria-describedby="' + id + '-description"' : '') +
        ' data-sr-id="' + esc((this.getAttribute('data-sr-id') || 'spl-input') + '-input') + '"></div></div></spl-internal-form-field>';
      this.input = this.shadowRoot.querySelector('input');
      if (this._pending != null) this.input.value = this._pending;
      var self = this;
      var fire = function () {
        emit(self, 'spl-change', { value: self.input.value });
      };
      this.input.addEventListener('input', fire);
      this.input.addEventListener('change', fire);
      this.input.addEventListener('blur', function () {
        emit(self, 'spl-blur', {});
        if (!self._touched) {
          self._touched = true;
          emit(self, 'spl-touched', {});
        }
      });
    }
    get value() {
      return this.input ? this.input.value : this._pending || '';
    }
    set value(v) {
      if (this.input) this.input.value = v == null ? '' : v;
      else this._pending = v;
    }
    focus() {
      if (this.input) this.input.focus();
    }
    _paintError(on) {
      if (!this.input) return;
      this.input.classList.toggle('c-spl-input--error', on);
      this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }

  /* ------------------------------------------------------------ textarea */
  class SplTextarea extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required) +
        '<textarea class="c-spl-textarea" id="' + id + '" rows="' + esc(this.getAttribute('rows') || '5') + '"' +
        (this.getAttribute('maxlength') ? ' maxlength="' + esc(this.getAttribute('maxlength')) + '"' : '') +
        ' aria-invalid="false"' + (this.required ? ' aria-required="true"' : '') + ' placeholder="' + esc(this.getAttribute('placeholder') || '') + '"></textarea></spl-internal-form-field>';
      this.input = this.shadowRoot.querySelector('textarea');
      var self = this;
      this.input.addEventListener('input', function () {
        emit(self, 'spl-change', { value: self.input.value });
      });
    }
    get value() {
      return this.input ? this.input.value : '';
    }
    set value(v) {
      if (this.input) this.input.value = v == null ? '' : v;
    }
    _paintError(on) {
      if (this.input) this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }

  /* --------------------------------------------- listbox helper (shadow) */
  function Listbox(host, root, opts) {
    this.host = host;
    this.root = root;
    this.box = root.querySelector('.c-spl-dropdown');
    this.list = root.querySelector('[role=listbox]');
    this.items = [];
    this.active = -1;
    this.onPick = opts.onPick;
    this.prefix = nextId('spl-option');
  }
  Listbox.prototype.render = function (items, selectedValue, status) {
    var self = this;
    this.items = items;
    this.list.innerHTML = '';
    if (status) {
      var st = document.createElement('div');
      st.className = 'c-spl-dropdown-status';
      st.setAttribute('role', 'status');
      st.textContent = status;
      this.list.appendChild(st);
    }
    items.forEach(function (it, i) {
      var o = document.createElement('div');
      o.className = 'c-spl-dropdown-item';
      o.setAttribute('role', 'option');
      o.id = self.prefix + '-' + i;
      o.setAttribute('data-value', it.value);
      o.setAttribute('aria-selected', String(it.value === selectedValue));
      o.textContent = it.label;
      o.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
      o.addEventListener('click', function () {
        self.onPick(it);
      });
      o.addEventListener('mousemove', function () {
        self.setActive(i);
      });
      self.list.appendChild(o);
    });
    this.active = -1;
  };
  Listbox.prototype.setActive = function (i, ctl) {
    this.active = i;
    var opts = this.list.querySelectorAll('[role=option]');
    opts.forEach(function (o, j) {
      o.classList.toggle('c-spl-dropdown-item--active', j === i);
    });
    if (ctl) {
      if (opts[i]) {
        ctl.setAttribute('aria-activedescendant', opts[i].id);
        opts[i].scrollIntoView({ block: 'nearest' });
      } else ctl.removeAttribute('aria-activedescendant');
    }
  };
  Listbox.prototype.open = function (ctl) {
    this.box.hidden = false;
    ctl.setAttribute('aria-expanded', 'true');
  };
  Listbox.prototype.close = function (ctl) {
    this.box.hidden = true;
    ctl.setAttribute('aria-expanded', 'false');
    ctl.removeAttribute('aria-activedescendant');
    this.active = -1;
  };
  Listbox.prototype.isOpen = function () {
    return !this.box.hidden;
  };
  Listbox.prototype.key = function (e, ctl) {
    var n = this.items.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.isOpen()) return 'open';
      this.setActive(Math.min(n - 1, this.active + 1), ctl);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setActive(Math.max(0, this.active - 1), ctl);
    } else if (e.key === 'Enter') {
      if (this.isOpen() && this.items[this.active]) {
        e.preventDefault();
        this.onPick(this.items[this.active]);
      } else if (this.isOpen() && n === 1) {
        e.preventDefault();
        this.onPick(this.items[0]);
      }
    } else if (e.key === 'Escape') {
      this.close(ctl);
    }
    return null;
  };

  /* ------------------------------------------------------------ select */
  class SplSelect extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var self = this;
      this._value = this.getAttribute('value') || '';
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required) +
        '<div class="c-spl-input-wrapper"><button type="button" class="c-spl-select-trigger" id="' + id + '" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-listbox" aria-labelledby="' + id + '-label ' + id + '"' +
        (this.required ? ' aria-required="true"' : '') + ' aria-invalid="false"><span class="c-spl-select-value"></span><span aria-hidden="true">&#9662;</span></button>' +
        '<div class="c-spl-dropdown" hidden><div role="listbox" id="' + id + '-listbox" aria-labelledby="' + id + '-label"></div></div></div></spl-internal-form-field>';
      this.trigger = this.shadowRoot.querySelector('button');
      this.lb = new Listbox(this, this.shadowRoot, {
        onPick: function (it) {
          self._set(it.value);
          self.lb.close(self.trigger);
          self.trigger.focus();
        },
      });
      this._paint();
      this.trigger.addEventListener('click', function () {
        if (self.lb.isOpen()) self.lb.close(self.trigger);
        else self._open();
      });
      this.trigger.addEventListener('keydown', function (e) {
        if (!self.lb.isOpen() && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
          e.preventDefault();
          self._open();
          return;
        }
        if (self.lb.isOpen() && e.key === ' ') {
          e.preventDefault();
          if (self.lb.items[self.lb.active]) self.lb.onPick(self.lb.items[self.lb.active]);
          return;
        }
        if (self.lb.isOpen() && e.key.length === 1 && /\S/.test(e.key)) {
          var k = e.key.toLowerCase();
          var idx = self.lb.items.findIndex(function (it) {
            return it.label.toLowerCase().indexOf(k) === 0;
          });
          if (idx >= 0) self.lb.setActive(idx, self.trigger);
          return;
        }
        self.lb.key(e, self.trigger);
      });
      this.trigger.addEventListener('blur', function () {
        setTimeout(function () {
          if (self.shadowRoot.activeElement !== self.trigger) self.lb.close(self.trigger);
        }, 150);
      });
    }
    get options() {
      return Array.prototype.map.call(this.querySelectorAll('spl-select-option'), function (o) {
        return { value: o.getAttribute('value'), label: o.getAttribute('label') || o.textContent.trim() };
      });
    }
    _open() {
      this.lb.render(this.options, this._value);
      this.lb.open(this.trigger);
      var i = this.options.findIndex((o) => o.value === this._value);
      this.lb.setActive(i < 0 ? 0 : i, this.trigger);
    }
    _set(v) {
      this._value = v;
      this._paint();
      emit(this, 'spl-change', { value: v });
    }
    _paint() {
      var o = this.options.find((x) => x.value === this._value);
      var span = this.shadowRoot.querySelector('.c-spl-select-value');
      span.textContent = o ? o.label : this.getAttribute('placeholder') || 'Select';
      span.classList.toggle('c-spl-select-placeholder', !o);
    }
    get value() {
      return this._value || '';
    }
    set value(v) {
      this._value = v;
      if (this._rendered) this._paint();
    }
    _paintError(on) {
      if (!this.trigger) return;
      this.trigger.classList.toggle('c-spl-select-trigger--error', on);
      this.trigger.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }
  class SplSelectOption extends HTMLElement {
    connectedCallback() {
      this.hidden = true;
    }
  }

  /* ------------------------------------------------------- autocomplete */
  class SplAutocomplete extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var self = this;
      this.minQueryLength = Number(this.getAttribute('min-query-length') || '3');
      this._selected = null;
      var desc = this.getAttribute('description');
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required) +
        (desc ? '<span slot="description" class="c-spl-form-field-description" id="' + id + '-description">' + esc(desc) + '</span>' : '') +
        '<div class="c-spl-input-wrapper spl-autocomplete-trigger"><input class="c-spl-input" id="' + id + '" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-listbox" autocomplete="off"' +
        (this.required ? ' aria-required="true"' : '') + ' aria-invalid="false" placeholder="' + esc(this.getAttribute('placeholder') || '') + '"' + (desc ? ' aria-describedby="' + id + '-description"' : '') +
        ' data-sr-id="' + esc(this.getAttribute('data-sr-id') || 'autocomplete') + '-input">' +
        '<div class="c-spl-dropdown spl-autocomplete-dropdown" hidden><div role="listbox" id="' + id + '-listbox" aria-label="' + esc(this.label) + '"></div></div></div></spl-internal-form-field>';
      this.input = this.shadowRoot.querySelector('input');
      this.lb = new Listbox(this, this.shadowRoot, {
        onPick: function (it) {
          self._selected = it;
          self.input.value = it.label;
          self.lb.close(self.input);
          emit(self, 'spl-change', { value: it });
        },
      });
      var timer = null;
      var seq = 0;
      this.input.addEventListener('input', function () {
        if (self._selected) {
          self._selected = null;
          emit(self, 'spl-change', { value: null });
        }
        clearTimeout(timer);
        var q = self.input.value.trim();
        if (q.length < self.minQueryLength) {
          self.lb.render([], null, q.length ? 'Please enter at least ' + self.minQueryLength + ' characters' : '');
          if (q.length) self.lb.open(self.input);
          else self.lb.close(self.input);
          return;
        }
        self.lb.render([], null, 'Loading...');
        self.lb.open(self.input);
        var my = ++seq;
        timer = setTimeout(function () {
          Promise.resolve(self.searchMethod ? self.searchMethod(q) : []).then(function (items) {
            if (my !== seq) return;
            self.lb.render(items, null, items.length ? '' : self.getAttribute('no-matches-label') || 'No results found');
            self.lb.open(self.input);
          });
        }, 250);
      });
      this.input.addEventListener('keydown', function (e) {
        self.lb.key(e, self.input);
      });
      this.input.addEventListener('blur', function () {
        setTimeout(function () {
          self.lb.close(self.input);
        }, 150);
      });
    }
    get value() {
      return this._selected;
    }
    set value(v) {
      this._selected = v || null;
      if (this.input) this.input.value = v ? v.label : '';
    }
    _paintError(on) {
      if (!this.input) return;
      this.input.classList.toggle('c-spl-input--error', on);
      this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }

  /* ------------------------------------------------------- phone field */
  var COUNTRIES = [
    ['US', 'United States', '1'],
    ['PK', 'Pakistan', '92'],
    ['GB', 'United Kingdom', '44'],
    ['DE', 'Germany', '49'],
    ['NL', 'Netherlands', '31'],
    ['PL', 'Poland', '48'],
    ['IN', 'India', '91'],
    ['AE', 'United Arab Emirates', '971'],
    ['NG', 'Nigeria', '234'],
    ['CA', 'Canada', '1'],
  ];
  class SplPhoneField extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var self = this;
      this.country = COUNTRIES.find((c) => c[0] === (this.getAttribute('default-country') || 'US')) || COUNTRIES[0];
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required) +
        '<div class="c-spl-phone c-spl-input-wrapper"><button type="button" class="c-spl-select-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="' + id + '-cc" aria-label="Country/region code"><span class="c-spl-select-value"></span><span aria-hidden="true">&#9662;</span></button>' +
        '<input class="c-spl-input" id="' + id + '" type="tel" autocomplete="' + esc(this.getAttribute('autocomplete') || 'tel') + '" aria-invalid="false"' + (this.required ? ' aria-required="true"' : '') + '>' +
        '<div class="c-spl-dropdown" hidden><input class="c-spl-dropdown-search" type="search" placeholder="Search by country/region or code" aria-label="Search by country/region or code"><div role="listbox" id="' + id + '-cc"></div></div></div></spl-internal-form-field>';
      this.trigger = this.shadowRoot.querySelector('button');
      this.input = this.shadowRoot.querySelector('input[type=tel]');
      this.search = this.shadowRoot.querySelector('.c-spl-dropdown-search');
      this.lb = new Listbox(this, this.shadowRoot, {
        onPick: function (it) {
          self.country = COUNTRIES[Number(it.value)];
          self._paint();
          self.lb.close(self.trigger);
          self.input.focus();
          self._fire();
        },
      });
      this._paint();
      var draw = function () {
        var q = self.search.value.trim().toLowerCase().replace(/^\+/, '');
        self.lb.render(
          COUNTRIES.map((c, i) => ({ value: String(i), label: c[1] + ' +' + c[2] })).filter((o) => !q || o.label.toLowerCase().indexOf(q) !== -1),
          null,
          '',
        );
      };
      this.trigger.addEventListener('click', function () {
        if (self.lb.isOpen()) return self.lb.close(self.trigger);
        self.search.value = '';
        draw();
        self.lb.open(self.trigger);
        self.search.focus();
      });
      this.search.addEventListener('input', draw);
      this.search.addEventListener('keydown', function (e) {
        self.lb.key(e, self.trigger);
      });
      this.input.addEventListener('input', function () {
        var v = self.input.value.replace(/[\s()-]/g, '');
        if (v.charAt(0) === '+') {
          var digits = v.slice(1);
          var hit = COUNTRIES.slice()
            .sort((a, b) => b[2].length - a[2].length)
            .find((c) => digits.indexOf(c[2]) === 0);
          if (hit && hit !== self.country) {
            self.country = hit;
            self._paint();
          }
        }
        self._fire();
      });
    }
    _paint() {
      this.trigger.querySelector('.c-spl-select-value').textContent = this.country[0] + ' +' + this.country[2];
    }
    _fire() {
      emit(this, 'spl-change', { value: this.value });
    }
    get value() {
      if (!this.input) return '';
      var raw = this.input.value.replace(/[^\d+]/g, '');
      if (!raw) return '';
      if (raw.charAt(0) === '+') return raw;
      return '+' + this.country[2] + raw.replace(/^0+/, '');
    }
    get nationalDigits() {
      var v = this.value.replace(/^\+/, '');
      return v.indexOf(this.country[2]) === 0 ? v.slice(this.country[2].length) : v;
    }
    _paintError(on) {
      if (!this.input) return;
      this.input.classList.toggle('c-spl-input--error', on);
      this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }

  /* ------------------------------------------------------------ checkbox */
  class SplCheckbox extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var self = this;
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field><div class="c-spl-checkbox-wrapper"><input type="checkbox" class="c-spl-checkbox__input" id="' + id + '" aria-invalid="false"' +
        (this.required ? ' aria-required="true"' : '') + '><label for="' + id + '" class="c-spl-checkbox__label">' + esc(this.label) + '<slot name="label-content"></slot>' +
        (this.required ? '<span class="c-spl-form-field-required-mark" aria-hidden="true">*</span>' : '') + '</label></div></spl-internal-form-field>';
      this.input = this.shadowRoot.querySelector('input');
      this.input.addEventListener('change', function () {
        emit(self, 'spl-change', { value: self.input.checked });
      });
    }
    get checked() {
      return !!(this.input && this.input.checked);
    }
    set checked(v) {
      if (this.input) this.input.checked = !!v;
    }
    get value() {
      return this.checked;
    }
    _paintError(on) {
      if (this.input) this.input.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }

  /* --------------------------------------------------------- radio group */
  class SplRadioGroup extends SplField {
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var id = this.inputId;
      var self = this;
      this.setAttribute('role', 'radiogroup');
      this.setAttribute('aria-labelledby', id + '-label');
      if (this.required) this.setAttribute('aria-required', 'true');
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><spl-internal-form-field>' + labelHtml(id, this.label, this.required).replace('<label ', '<label data-group="true" ').replace(' for="' + id + '"', '') +
        '<div class="c-spl-radio-group"><slot></slot></div></spl-internal-form-field>';
      // The group's label lives in this shadow root; expose its text for aria-labelledby users.
      this.setAttribute('aria-label', this.label);
      this.removeAttribute('aria-labelledby');
      this.addEventListener('spl-radio-select', function (e) {
        self._select(e.target);
      });
      this.addEventListener('keydown', function (e) {
        var radios = self.radios;
        var i = radios.indexOf(e.target);
        if (i < 0) return;
        var n = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % radios.length;
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + radios.length) % radios.length;
        if (n !== null) {
          e.preventDefault();
          radios[n].focus();
          self._select(radios[n]);
        }
      });
      this._roving();
    }
    get radios() {
      return Array.prototype.slice.call(this.querySelectorAll('spl-radio'));
    }
    _select(r) {
      this.radios.forEach(function (x) {
        x.checked = x === r;
      });
      this._roving();
      emit(this, 'spl-change', { value: r.getAttribute('value') });
    }
    _roving() {
      var radios = this.radios;
      var sel = radios.find((r) => r.checked);
      radios.forEach(function (r, i) {
        r.tabIndex = (sel ? r === sel : i === 0) ? 0 : -1;
      });
    }
    get value() {
      var r = this.radios.find((x) => x.checked);
      return r ? r.getAttribute('value') : '';
    }
    _paintError(on) {
      this.setAttribute('aria-invalid', on ? 'true' : 'false');
    }
  }
  class SplRadio extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var self = this;
      this.setAttribute('role', 'radio');
      this.setAttribute('aria-checked', 'false');
      if (!this.hasAttribute('tabindex')) this.tabIndex = -1;
      this.shadowRoot.innerHTML =
        '<style>:host{display:inline-flex;cursor:pointer;font:14px Arial,Helvetica,sans-serif;color:#383c38}:host(:focus){outline:2px solid #0850b2;outline-offset:2px}' +
        '.c-spl-radio-wrapper{display:flex;align-items:center;gap:8px}.c-spl-radio{width:18px;height:18px;border:2px solid #6a6e6a;border-radius:50%;box-sizing:border-box;display:flex;align-items:center;justify-content:center}' +
        '.c-spl-radio--checked{border-color:#0b66e4}.c-spl-radio--checked .c-spl-radio__ring{width:8px;height:8px;border-radius:50%;background:#0b66e4}</style>' +
        '<spl-internal-form-field><div class="c-spl-radio-wrapper"><label class="c-spl-form-field-label"><spl-typography-label variant="md"><span class="c-spl-form-field-label-wrapper">' +
        esc(this.getAttribute('label') || '') + '</span></spl-typography-label></label><div class="c-spl-radio"><div class="c-spl-radio__ring"></div></div></div></spl-internal-form-field>';
      // label first in DOM but visually after the ring
      this.shadowRoot.querySelector('.c-spl-radio-wrapper').style.flexDirection = 'row-reverse';
      this.shadowRoot.querySelector('.c-spl-radio-wrapper').style.justifyContent = 'flex-end';
      this.addEventListener('click', function () {
        emit(self, 'spl-radio-select', {});
      });
      this.addEventListener('keyup', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          emit(self, 'spl-radio-select', {});
        }
      });
      this.addEventListener('keydown', function (e) {
        if (e.key === ' ') e.preventDefault();
      });
    }
    get checked() {
      return this.getAttribute('aria-checked') === 'true';
    }
    set checked(v) {
      this.setAttribute('aria-checked', v ? 'true' : 'false');
      var d = this.shadowRoot.querySelector('.c-spl-radio');
      if (d) d.classList.toggle('c-spl-radio--checked', !!v);
    }
  }

  /* ------------------------------------------------------------ dropzone */
  function fmtSize(n) {
    return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  }
  class SplDropzone extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.files = [];
    }
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var self = this;
      var id = nextId('spl-dropzone');
      var exts = (this.getAttribute('allowed-extensions') || '').split(',').filter(Boolean);
      this._exts = exts;
      this._max = Number(this.getAttribute('allowed-size') || '0');
      var restriction =
        (exts.length ? 'Supported files: ' + exts.map((e) => e.toUpperCase()).join(', ') : '') + (this._max ? ' · size limit ' + Math.round(this._max / 1048576) + ' MB' : '');
      this.shadowRoot.innerHTML =
        '<style>' + CSS + '</style><div class="c-spl-dropzone-wrapper c-spl-dropzone" tabindex="0" role="button" aria-label="' + esc(this.getAttribute('aria-label') || 'Upload file') + '">' +
        '<slot name="icon"></slot><label for="' + id + '"><span class="c-spl-dropzone-label c-spl-dropzone-label-browse">' + esc(this.getAttribute('browse-label') || 'Choose a file') +
        '</span><span class="c-spl-dropzone-label">' + esc(this.getAttribute('label') || 'or drop it here') + '</span></label>' +
        '<input type="file" id="' + id + '" accept="' + esc(exts.map((e) => '.' + e).join(',')) + '" aria-describedby="' + id + '-restriction">' +
        '<span id="' + id + '-restriction" class="c-spl-dropzone-label c-spl-dropzone-label-restriction">' + esc(restriction) + '</span></div><ul class="c-spl-file-list"></ul>';
      this.input = this.shadowRoot.querySelector('input');
      this.zone = this.shadowRoot.querySelector('.c-spl-dropzone');
      this.input.addEventListener('change', function () {
        self._take(Array.prototype.slice.call(self.input.files || []));
        self.input.value = '';
      });
      this.zone.addEventListener('click', function (e) {
        if (e.target === self.input || e.target.closest('label')) return;
        self.input.click();
      });
      this.zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          self.input.click();
        }
      });
      ['dragenter', 'dragover'].forEach(function (t) {
        self.zone.addEventListener(t, function (e) {
          e.preventDefault();
          self.zone.classList.add('c-spl-dropzone--dragover');
        });
      });
      this.zone.addEventListener('dragleave', function () {
        self.zone.classList.remove('c-spl-dropzone--dragover');
      });
      this.zone.addEventListener('drop', function (e) {
        e.preventDefault();
        self.zone.classList.remove('c-spl-dropzone--dragover');
        self._take(Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []));
      });
    }
    _take(files) {
      var self = this;
      var ok = [];
      var rejected = [];
      files.forEach(function (f) {
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if ((self._exts.length && self._exts.indexOf(ext) === -1) || (self._max && f.size > self._max)) rejected.push(f);
        else ok.push(f);
      });
      if (rejected.length) emit(this, 'spl-rejected', { files: rejected });
      if (!ok.length) return;
      this.files = this.hasAttribute('multiple') ? this.files.concat(ok) : [ok[0]];
      this._list();
      emit(this, 'spl-upload', { files: ok });
    }
    _list() {
      var self = this;
      var ul = this.shadowRoot.querySelector('.c-spl-file-list');
      ul.innerHTML = '';
      this.files.forEach(function (f, i) {
        var li = document.createElement('li');
        li.className = 'c-spl-file-list-item';
        li.innerHTML =
          '<div class="c-spl-file-list-item-label-container"><span class="c-spl-file-list-item-name"></span><span class="c-spl-file-list-item-size"></span></div>' +
          '<div class="c-spl-file-list-item-actions"><button type="button" class="c-spl-button c-spl-button--tertiary c-spl-file-list-item-delete-button"></button></div>';
        li.querySelector('.c-spl-file-list-item-name').textContent = f.name;
        li.querySelector('.c-spl-file-list-item-size').textContent = fmtSize(f.size);
        var b = li.querySelector('button');
        b.textContent = 'Delete';
        b.setAttribute('aria-label', 'Delete file ' + f.name);
        b.addEventListener('click', function () {
          self.files.splice(i, 1);
          self._list();
          emit(self, 'spl-delete', { index: i });
        });
        ul.appendChild(li);
      });
    }
    set disabled(v) {
      if (this.input) this.input.disabled = !!v;
    }
  }

  /* ------------------------------------------------------------ button */
  class SplButton extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    connectedCallback() {
      if (this._rendered) return;
      this._rendered = true;
      var type = this.getAttribute('type') || 'primary';
      var aria = this.getAttribute('attr-aria-label');
      this.shadowRoot.innerHTML =
        '<style>' + CSS + ':host{display:inline-block}</style><button type="button" class="c-spl-button c-spl-button--' + esc(type) + '"' + (aria ? ' aria-label="' + esc(aria) + '"' : '') +
        (this.hasAttribute('attr-aria-expanded') ? ' aria-expanded="' + esc(this.getAttribute('attr-aria-expanded')) + '"' : '') + '><slot></slot></button>';
      this.button = this.shadowRoot.querySelector('button');
      this.disabled = this.hasAttribute('disabled');
    }
    get disabled() {
      return !!(this.button && this.button.disabled);
    }
    set disabled(v) {
      if (this.button) this.button.disabled = !!v;
      if (v) this.setAttribute('disabled', '');
      else this.removeAttribute('disabled');
    }
  }

  var defs = {
    'spl-internal-form-field': SplInternalFormField,
    'spl-input': SplInput,
    'spl-textarea': SplTextarea,
    'spl-select': SplSelect,
    'spl-select-option': SplSelectOption,
    'spl-autocomplete': SplAutocomplete,
    'spl-phone-field': SplPhoneField,
    'spl-checkbox': SplCheckbox,
    'spl-radio-group': SplRadioGroup,
    'spl-radio': SplRadio,
    'spl-dropzone': SplDropzone,
    'spl-button': SplButton,
  };
  Object.keys(defs).forEach(function (k) {
    if (!customElements.get(k)) customElements.define(k, defs[k]);
  });
})();

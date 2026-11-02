/*
 * Local stand-in for hCaptcha's api.js (js.hcaptcha.com/1/api.js?render=explicit&onload=...)
 * as Lever uses it: an explicit, data-size="invisible" widget. render() leaves the
 * same footprint as the real widget (a hidden checkbox-invisible iframe plus the
 * h-captcha-response / g-recaptcha-response textareas) and execute() resolves
 * passively with a token after a short delay. No challenge is ever shown, and the
 * token is not a "human-" token: the fixture server does not check it for Lever.
 */
(function () {
  'use strict';
  var widgets = {};
  var seq = 0;

  function rid() {
    return Math.random().toString(36).slice(2, 12);
  }

  function render(container, params) {
    var el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) throw new Error('[hCaptcha] container not found');
    var id = '0' + rid();
    var frame = document.createElement('iframe');
    frame.src = 'about:blank';
    frame.title = 'Widget containing checkbox for hCaptcha security challenge';
    frame.tabIndex = -1;
    frame.setAttribute('frameborder', '0');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('data-hcaptcha-widget-id', id);
    frame.setAttribute('data-hcaptcha-response', '');
    frame.style.cssText = 'pointer-events:none;width:0;height:0;border:0;display:none';
    var ta = document.createElement('textarea');
    ta.id = 'h-captcha-response-' + id;
    ta.name = 'h-captcha-response';
    ta.style.display = 'none';
    var ga = document.createElement('textarea');
    ga.id = 'g-recaptcha-response-' + id;
    ga.name = 'g-recaptcha-response';
    ga.style.display = 'none';
    el.appendChild(frame);
    el.appendChild(ta);
    el.appendChild(ga);
    el.setAttribute('data-hcaptcha-widget-id', id);
    widgets[id] = { params: params || {}, frame: frame, ta: ta, ga: ga, token: '' };
    seq++;
    return id;
  }

  function execute(id) {
    var w = widgets[id] || widgets[Object.keys(widgets)[0]];
    if (!w) throw new Error('[hCaptcha] no widget');
    setTimeout(function () {
      var token = 'P1_fx-passive.' + rid() + rid();
      w.token = token;
      w.ta.value = token;
      w.ga.value = token;
      w.frame.setAttribute('data-hcaptcha-response', token);
      if (typeof w.params.callback === 'function') w.params.callback(token);
    }, 350);
  }

  function getResponse(id) {
    var w = widgets[id] || widgets[Object.keys(widgets)[0]];
    return w ? w.token : '';
  }

  function reset(id) {
    var w = widgets[id];
    if (!w) return;
    w.token = '';
    w.ta.value = '';
    w.ga.value = '';
  }

  window.hcaptcha = { render: render, execute: execute, getResponse: getResponse, reset: reset, getRespKey: function () { return ''; } };
})();

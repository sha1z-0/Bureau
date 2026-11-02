/*
 * Fixture: Greenhouse embed loader (boards.greenhouse.io/embed/job_board/js?for=<board>),
 * served from origin B. Same shape as the real script: Grnhse.Settings /
 * Grnhse.Const / Grnhse.Config / Grnhse.UriHelper / Grnhse.Iframe, an
 * <iframe id="grnhse_iframe" scrolling="no"> injected into #grnhse_app whose
 * src is applicationURI + validityToken + token=<job id> (from the gh_jid query
 * parameter or Grnhse.Iframe.load(jobId)), and the postMessage handlers: the
 * frame reports its document height and the loader sets the iframe height
 * (only for messages from targetDomain), window resizes are forwarded to the
 * frame as 'resize', and {scrollTo} requests scroll the host page.
 */
var Grnhse = Grnhse || {};

Grnhse.Settings = {
  targetDomain: '{{ORIGIN_B}}',
  scrollOnLoad: true,
  autoLoad: false,
  boardURI: '{{ORIGIN_B}}/job-boards.greenhouse.io/embed/job_board?for=orchardrobotics',
  applicationURI: '{{ORIGIN_B}}/job-boards.greenhouse.io/embed/job_app?for=orchardrobotics',
  baseURI: '',
  iFrameWidth: '100%',
  useEmbeddedInternalBoard: false,
  trustedAutofillUrl: '{{ORIGIN_B}}',
  trustedJobSeekersUrl: 'https://my.greenhouse.io',
  embedToken: 'fx-Q2hvY29sYXRlQ2hpcENvb2tpZS1vcmNoYXJkcm9ib3RpY3M'
};

Grnhse.Const = {
  JOB_ID: 'gh_jid',
  SOURCE_TOKEN: 'gh_src',
  PROGRAMMATIC_SOURCING_TRACKING: 'ccuid'
};

Grnhse.Config = {
  IframeDefault: {
    id: 'grnhse_iframe',
    width: Grnhse.Settings.iFrameWidth,
    frameborder: '0',
    scrolling: 'no',
    allow: 'geolocation',
    onload: undefined,
    title: 'Greenhouse Job Board'
  }
};

Grnhse.UriHelper = {
  base: function () {
    var location = Grnhse.UriHelper.currentLocation();
    return window && location ? Grnhse.UriHelper.pathFromLocation(location) : Grnhse.Settings.boardURI;
  },
  currentLocation: function () {
    return window.top.location;
  },
  getParam: function (name) {
    var uri = Grnhse.UriHelper.currentLocation().href;
    var start = uri.indexOf(name);
    if (start === -1) return null;
    start += name.length + 1;
    var end = uri.substr(start).search(/(&|#|$|;)/);
    return uri.substr(start, end);
  },
  pathFromLocation: function (location) {
    return encodeURIComponent(location.protocol + '//' + location.host + location.pathname);
  }
};

Grnhse.Iframe = function (jobId, source, ccuid) {
  this.jobId = jobId || Grnhse.UriHelper.getParam(Grnhse.Const.JOB_ID) || '';
  this.source = source || Grnhse.UriHelper.getParam(Grnhse.Const.SOURCE_TOKEN) || '';
  this.ccuid = ccuid || Grnhse.UriHelper.getParam(Grnhse.Const.PROGRAMMATIC_SOURCING_TRACKING) || '';
  this.queryParams = { token: this.jobId, t: this.source, ccuid: this.ccuid };
  this.iframeElement = null;
  this.registerEventHandlers();
  this.pathToLoad = this.jobId ? this.applicationUrl() : this.boardUrl();
  this.iframeElement = this.render();
};

Grnhse.Iframe.prototype.boardUrl = function () {
  var url = new URL(Grnhse.Settings.boardURI);
  url.searchParams.set('validityToken', Grnhse.Settings.embedToken);
  if (this.source) url.searchParams.set('t', this.source);
  return url.href;
};

Grnhse.Iframe.prototype.applicationUrl = function () {
  var url = new URL(Grnhse.Settings.applicationURI);
  var self = this;
  Object.keys(this.queryParams).forEach(function (key) {
    if (self.queryParams[key]) url.searchParams.set(key, self.queryParams[key]);
  });
  url.searchParams.set('validityToken', Grnhse.Settings.embedToken);
  return url.href;
};

Grnhse.Iframe.prototype.build = function () {
  var iframe = document.createElement('iframe');
  var attributes = Grnhse.Config.IframeDefault;
  Object.keys(attributes).forEach(function (attribute) {
    if (attributes[attribute] !== undefined) iframe.setAttribute(attribute, attributes[attribute]);
  });
  iframe.setAttribute('src', this.pathToLoad);
  return iframe;
};

Grnhse.Iframe.prototype.render = function () {
  var container = document.getElementById('grnhse_app');
  var iframeElement = this.build();
  container.innerHTML = '';
  container.appendChild(iframeElement);
  return iframeElement;
};

Grnhse.Iframe.prototype.registerEventHandlers = function () {
  var resizeEvent = null;
  var instance = this;

  window.addEventListener('message', resize, false);
  window.addEventListener('resize', windowResize, false);
  window.addEventListener('message', scrollTo, false);

  function windowResize() {
    clearTimeout(resizeEvent);
    resizeEvent = setTimeout(triggerResize, 200);
  }
  function triggerResize() {
    if (window.postMessage && instance.iframeElement) instance.iframeElement.contentWindow.postMessage('resize', '*');
  }
  function resize(e) {
    if (instance.iframeElement && e.origin === Grnhse.Settings.targetDomain && e.data > 0) {
      instance.iframeElement.setAttribute('height', e.data);
    }
  }
  function scrollTo(e) {
    if (e.origin === Grnhse.Settings.targetDomain && e.data && e.data.scrollTo) window.scrollTo(e.data.scrollTo);
  }
};

Grnhse.Iframe.load = function (jobId, source, ccuid) {
  return new Grnhse.Iframe(jobId, source, ccuid);
};

Grnhse.Iframe.autoLoad = function () {
  Grnhse.Iframe.load();
};

(function () {
  if (Grnhse.Settings.autoLoad) addEventListener('load', Grnhse.Iframe.autoLoad);
})();

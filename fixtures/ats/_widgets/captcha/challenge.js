/*
 * Image-grid challenge shared by the CAPTCHA mocks (reCAPTCHA bframe, hCaptcha
 * challenge frame, Turnstile interactive step). Runs inside the cross-origin
 * captcha iframe (origin B), never in the host page.
 *
 * Why automation cannot get past it (by design, for the needs_you fixtures):
 *  - tiles are <canvas> drawings with randomised colours and positions; which
 *    tiles match is kept only in this closure (no DOM text, alt or data hints);
 *  - every tile click and the Verify click must be trusted (event.isTrusted);
 *    a single synthetic event poisons the attempt;
 *  - the attempt also needs human-like pointer activity: at least 25 trusted
 *    mousemove events and 2 s on the challenge before Verify;
 *  - navigator.webdriver (set by Playwright/Puppeteer/Selenium) always fails.
 * A person in an ordinary browser solves it in a few seconds. A failed attempt
 * shows "Please try again." and redraws a fresh grid.
 */
(function () {
  'use strict';

  var CATEGORIES = ['traffic lights', 'bicycles', 'buses', 'fire hydrants', 'trees', 'houses'];

  function rnd(n) {
    return Math.floor(Math.random() * n);
  }
  function hsl(h, s, l) {
    return 'hsl(' + h + ',' + s + '%,' + l + '%)';
  }

  function backdrop(g, w, h) {
    var sky = rnd(40) + 190;
    g.fillStyle = hsl(sky, 30 + rnd(30), 70 + rnd(15));
    g.fillRect(0, 0, w, h);
    g.fillStyle = hsl(rnd(60) + 20, 10 + rnd(20), 35 + rnd(25));
    g.fillRect(0, h * (0.6 + Math.random() * 0.2), w, h);
    for (var i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(' + rnd(255) + ',' + rnd(255) + ',' + rnd(255) + ',0.08)';
      g.fillRect(rnd(w), rnd(h), 4 + rnd(14), 4 + rnd(14));
    }
  }

  var DRAW = {
    'traffic lights': function (g, x, y, s) {
      g.fillStyle = '#222';
      g.fillRect(x + s * 0.12, y + s * 0.55, s * 0.06, s * 0.45);
      g.fillRect(x, y, s * 0.3, s * 0.6);
      ['#e33', '#eb3', '#3c4'].forEach(function (c, i) {
        g.fillStyle = c;
        g.beginPath();
        g.arc(x + s * 0.15, y + s * (0.1 + i * 0.19), s * 0.07, 0, Math.PI * 2);
        g.fill();
      });
    },
    bicycles: function (g, x, y, s) {
      g.strokeStyle = hsl(rnd(360), 60, 30);
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x + s * 0.2, y + s * 0.6, s * 0.18, 0, Math.PI * 2);
      g.arc(x + s * 0.75, y + s * 0.6, s * 0.18, 0, Math.PI * 2);
      g.moveTo(x + s * 0.2, y + s * 0.6);
      g.lineTo(x + s * 0.45, y + s * 0.3);
      g.lineTo(x + s * 0.75, y + s * 0.6);
      g.stroke();
    },
    buses: function (g, x, y, s) {
      g.fillStyle = hsl(rnd(60) + 30, 80, 50);
      g.fillRect(x, y + s * 0.2, s, s * 0.5);
      g.fillStyle = '#cde';
      for (var i = 0; i < 4; i++) g.fillRect(x + s * (0.05 + i * 0.24), y + s * 0.27, s * 0.18, s * 0.15);
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(x + s * 0.2, y + s * 0.72, s * 0.08, 0, Math.PI * 2);
      g.arc(x + s * 0.8, y + s * 0.72, s * 0.08, 0, Math.PI * 2);
      g.fill();
    },
    'fire hydrants': function (g, x, y, s) {
      g.fillStyle = hsl(rnd(15), 80, 45);
      g.fillRect(x + s * 0.3, y + s * 0.25, s * 0.4, s * 0.7);
      g.beginPath();
      g.arc(x + s * 0.5, y + s * 0.25, s * 0.2, Math.PI, 0);
      g.fill();
      g.fillRect(x + s * 0.15, y + s * 0.45, s * 0.7, s * 0.12);
    },
    trees: function (g, x, y, s) {
      g.fillStyle = '#6b4';
      g.fillStyle = hsl(90 + rnd(50), 50, 30 + rnd(15));
      g.beginPath();
      g.arc(x + s * 0.5, y + s * 0.35, s * 0.33, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#5a3a1a';
      g.fillRect(x + s * 0.44, y + s * 0.6, s * 0.12, s * 0.4);
    },
    houses: function (g, x, y, s) {
      g.fillStyle = hsl(rnd(360), 30, 60);
      g.fillRect(x + s * 0.1, y + s * 0.45, s * 0.8, s * 0.55);
      g.fillStyle = hsl(rnd(30), 50, 35);
      g.beginPath();
      g.moveTo(x, y + s * 0.47);
      g.lineTo(x + s * 0.5, y + s * 0.05);
      g.lineTo(x + s, y + s * 0.47);
      g.fill();
    },
  };

  /**
   * Mount a 3x3 grid challenge into `root`.
   * opts.onSolved(token) is called only for a genuine human solve.
   * opts.tileSize (px), opts.classes { table, tile, selected, prompt, verify, error } to mimic each vendor's DOM.
   */
  function mount(root, opts) {
    var cls = opts.classes || {};
    var size = opts.tileSize || 96;
    var moves = 0;
    var tainted = false;
    var shownAt = 0;
    var answer = [];
    var selected = [];

    document.addEventListener('mousemove', function (e) {
      if (e.isTrusted) moves++;
    });

    root.innerHTML = '';
    var prompt = document.createElement('div');
    prompt.className = cls.prompt || 'fx-challenge-prompt';
    var table = document.createElement('table');
    table.className = cls.table || 'fx-challenge-table';
    table.setAttribute('role', 'grid');
    var err = document.createElement('div');
    err.className = cls.error || 'fx-challenge-error';
    err.setAttribute('aria-live', 'assertive');
    err.style.display = 'none';
    var footer = document.createElement('div');
    footer.className = cls.footer || 'fx-challenge-footer';
    var verify = document.createElement('button');
    verify.type = 'button';
    verify.className = cls.verify || 'fx-challenge-verify';
    verify.id = opts.verifyId || '';
    verify.textContent = opts.verifyText || 'Verify';
    if (opts.extraButtons) opts.extraButtons(footer);
    footer.appendChild(verify);
    root.appendChild(prompt);
    root.appendChild(table);
    root.appendChild(err);
    root.appendChild(footer);

    function draw() {
      var target = CATEGORIES[rnd(CATEGORIES.length)];
      var others = CATEGORIES.filter(function (c) {
        return c !== target;
      });
      var n = 3 + rnd(2);
      var cells = [];
      for (var i = 0; i < 9; i++) cells.push(false);
      while (n > 0) {
        var k = rnd(9);
        if (!cells[k]) {
          cells[k] = true;
          n--;
        }
      }
      answer = cells;
      selected = cells.map(function () {
        return false;
      });
      tainted = false;
      moves = 0;
      shownAt = performance.now();
      prompt.innerHTML = opts.promptHtml(target);
      table.innerHTML = '';
      for (var r = 0; r < 3; r++) {
        var tr = document.createElement('tr');
        for (var c = 0; c < 3; c++) {
          var idx = r * 3 + c;
          var td = document.createElement('td');
          td.className = cls.tile || 'fx-challenge-tile';
          td.setAttribute('role', 'button');
          td.tabIndex = 0;
          td.setAttribute('aria-label', 'Image ' + (idx + 1));
          var cv = document.createElement('canvas');
          cv.width = size;
          cv.height = size;
          var g = cv.getContext('2d');
          backdrop(g, size, size);
          var cat = cells[idx] ? target : others[rnd(others.length)];
          var s = size * (0.45 + Math.random() * 0.3);
          DRAW[cat](g, rnd(Math.max(1, size - s)), rnd(Math.max(1, size - s)), s);
          td.appendChild(cv);
          (function (i, cell) {
            cell.addEventListener('click', function (e) {
              if (!e.isTrusted) {
                tainted = true;
                return;
              }
              selected[i] = !selected[i];
              cell.classList.toggle(cls.selected || 'fx-challenge-selected', selected[i]);
              cell.setAttribute('aria-pressed', String(selected[i]));
            });
          })(idx, td);
          tr.appendChild(td);
        }
        table.appendChild(tr);
      }
      err.style.display = 'none';
    }

    verify.addEventListener('click', function (e) {
      var human =
        e.isTrusted &&
        !tainted &&
        !navigator.webdriver &&
        moves >= 25 &&
        performance.now() - shownAt >= 2000;
      var correct = answer.every(function (v, i) {
        return v === selected[i];
      });
      if (human && correct) {
        var token = 'human-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        opts.onSolved(token);
        return;
      }
      draw();
      err.textContent = opts.errorText || 'Please try again.';
      err.style.display = 'block';
    });

    draw();
    return { redraw: draw };
  }

  /** The host page origin, passed by the embed as ?co=<base64 origin> (reCAPTCHA style) or #host=. */
  function hostOrigin() {
    var q = new URLSearchParams(location.search);
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var co = q.get('co') || h.get('co');
    if (co) {
      try {
        return atob(co.replace(/\.$/, '').replace(/-/g, '+').replace(/_/g, '/'));
      } catch (e) {
        /* fall through */
      }
    }
    return h.get('host') || q.get('host') || '*';
  }

  function post(msg) {
    msg.source = 'fx-captcha';
    window.parent.postMessage(msg, hostOrigin());
  }

  window.FXChallenge = { mount: mount, hostOrigin: hostOrigin, post: post };
})();

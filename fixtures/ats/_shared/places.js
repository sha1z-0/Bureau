/*
 * A local stand-in for the Google Places Autocomplete widget that Greenhouse,
 * Lever and others attach to their "Location" inputs. Same DOM as the real
 * thing: a body-level `.pac-container` with `.pac-item` rows that appear after
 * typing, keyboard navigation with ↑/↓/Enter, and selection only counts once
 * a suggestion is picked (typing alone leaves the hidden lat/long empty).
 */
(function () {
  'use strict';

  const PLACES = [
    ['Lahore', 'Punjab, Pakistan', 31.5204, 74.3587],
    ['Lahore Cantonment', 'Lahore, Punjab, Pakistan', 31.5165, 74.3712],
    ['Karachi', 'Sindh, Pakistan', 24.8607, 67.0011],
    ['Islamabad', 'Islamabad Capital Territory, Pakistan', 33.6844, 73.0479],
    ['Lagos', 'Nigeria', 6.5244, 3.3792],
    ['Lahaina', 'HI, USA', 20.8783, -156.6825],
    ['London', 'UK', 51.5072, -0.1276],
    ['Berlin', 'Germany', 52.52, 13.405],
    ['Dubai', 'United Arab Emirates', 25.2048, 55.2708],
    ['San Francisco', 'CA, USA', 37.7749, -122.4194],
    ['New York', 'NY, USA', 40.7128, -74.006],
    ['Toronto', 'ON, Canada', 43.6532, -79.3832],
    ['Amsterdam', 'Netherlands', 52.3676, 4.9041],
    ['Remote', 'Anywhere', 0, 0],
  ];

  function attach(input, opts) {
    opts = opts || {};
    const box = document.createElement('div');
    box.className = 'pac-container pac-logo';
    box.style.cssText = 'position:absolute;display:none;z-index:1000;background:#fff;border:1px solid #ccc;box-shadow:0 2px 6px rgba(0,0,0,.3);font:13px Arial,sans-serif;';
    document.body.appendChild(box);
    let active = -1;
    let items = [];

    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');

    function place() {
      const r = input.getBoundingClientRect();
      box.style.left = r.left + window.scrollX + 'px';
      box.style.top = r.bottom + window.scrollY + 'px';
      box.style.width = r.width + 'px';
    }
    function close() {
      box.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }
    function pick(i) {
      const p = items[i];
      if (!p) return;
      const label = p[0] + ', ' + p[1];
      input.value = label;
      input.dataset.placeSelected = 'true';
      close();
      if (opts.onPick) opts.onPick({ name: p[0], region: p[1], label: label, lat: p[2], lng: p[3] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function render() {
      const q = input.value.trim().toLowerCase();
      items = q.length < 2 ? [] : PLACES.filter((p) => (p[0] + ' ' + p[1]).toLowerCase().indexOf(q) !== -1).slice(0, 5);
      box.innerHTML = '';
      items.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'pac-item';
        row.setAttribute('role', 'option');
        row.style.cssText = 'padding:4px 8px;cursor:pointer;border-top:1px solid #e6e6e6;';
        row.innerHTML = '<span class="pac-icon pac-icon-marker"></span><span class="pac-item-query"><span class="pac-matched"></span></span><span></span>';
        row.querySelector('.pac-matched').textContent = p[0];
        row.lastChild.textContent = ' ' + p[1];
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pick(i);
        });
        row.addEventListener('mouseenter', () => setActive(i));
        box.appendChild(row);
      });
      if (items.length) {
        place();
        box.style.display = 'block';
        input.setAttribute('aria-expanded', 'true');
      } else close();
    }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(box.children, (c, j) => c.classList.toggle('pac-item-selected', j === i));
    }
    input.addEventListener('input', () => {
      input.dataset.placeSelected = 'false';
      if (opts.onClear) opts.onClear();
      // Google debounces its predictions request; so do we.
      clearTimeout(input._pacTimer);
      input._pacTimer = setTimeout(render, 150);
    });
    input.addEventListener('keydown', (e) => {
      if (box.style.display !== 'block') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(items.length - 1, active + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(0, active - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(active < 0 ? 0 : active);
      } else if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => setTimeout(close, 100));
  }

  window.FXPlaces = { attach: attach };
})();

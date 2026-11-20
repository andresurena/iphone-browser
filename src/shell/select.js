'use strict'

/* ============================================================ page selects
   A page's own <select>. Chromium draws that popup itself, in a little window
   of its own — and under device emulation it gets the scale wrong: at a 3×
   device ratio the list comes up a third of the size, in the wrong place. It
   would be the Mac's menu even if it were the right size, which no phone shows.

   So the page is stopped from opening it, and the phone draws the picker a
   phone would: on iOS a menu hanging off the control with a tick beside the
   current choice; on Android a dialog in the middle of the screen. The choice
   goes back to the page as the same `input` and `change` events a real pick
   fires.

   Covers a single-choice <select> in the page's main frame. A list box
   (`multiple`, or `size` above 1) is drawn inline by the page and left alone;
   a select inside an <iframe> still gets Chromium's own popup.

   A classic script loaded before shell.js; it shares that file's globals and
   only touches them from inside functions. */

const PAGE_SELECT_MAX = 2000;      // options drawn; nobody scrolls further
const pageSelects = new Map();     // tab id → { tab, el, menu, token, at }

/**
 * Runs in the page. Stops the native popup (it opens from mousedown's default
 * action, or from the keyboard) and says what the select holds instead. The
 * shell answers through __ibSelectAnswer. A page could call either side of
 * this itself; all it would get is a menu over its own pane, of its own words.
 */
const PAGE_SELECT_HOOK = `(() => {
  if (window.__ibSelectHooked) return; window.__ibSelectHooked = true;
  let pending = null, seq = 0;
  const isMenu = (el) => el instanceof HTMLSelectElement && !el.multiple && el.size <= 1 && !el.disabled;
  const open = (sel) => {
    const r = sel.getBoundingClientRect();
    const items = [];
    const option = (o, off) => { if (!o.hidden) items.push({ i: o.index, label: String(o.label || o.text).slice(0, 200), disabled: o.disabled || off }); };
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') {
        items.push({ group: String(node.label).slice(0, 200) });
        for (const o of node.children) if (o.tagName === 'OPTION') option(o, node.disabled);
      } else if (node.tagName === 'OPTION') option(node, false);
      else if (node.tagName === 'HR') items.push({ rule: true });
    }
    pending = { el: sel, token: ++seq };
    console.log('__ib_select:' + JSON.stringify({
      token: pending.token, x: r.left, y: r.top, w: r.width, h: r.height,
      selected: sel.selectedIndex, items: items.slice(0, ${PAGE_SELECT_MAX}),
    }));
  };
  addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const sel = e.target.closest('select');
    if (!isMenu(sel)) return;
    e.preventDefault();
    sel.focus();
    open(sel);
  }, true);
  addEventListener('keydown', (e) => {
    if (!isMenu(e.target) || e.metaKey || e.ctrlKey) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(e.target); }
  }, true);
  const nativePicker = HTMLSelectElement.prototype.showPicker;
  if (nativePicker) HTMLSelectElement.prototype.showPicker = function () { return isMenu(this) ? open(this) : nativePicker.call(this); };
  window.__ibSelectAnswer = (token, index) => {
    if (!pending || pending.token !== token) return;
    const sel = pending.el; pending = null;
    if (index == null || !sel.isConnected || sel.selectedIndex === index || !sel.options[index] || sel.options[index].disabled) return;
    sel.selectedIndex = index;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
})()`;

/** Called for each new document (see attachWebviewListeners in shell.js). */
function hookPageSelects(el) {
  el.executeJavaScript(PAGE_SELECT_HOOK).catch(() => {});
}

const TICK = '<svg class="tick" viewBox="0 0 18 18"><path d="M3.6 9.6l3.6 3.7 7.2-8.4"/></svg>';

function showPageSelect(tab, info) {
  if (!tab || !info || !Number.isInteger(info.token) || !Array.isArray(info.items)) return;
  closePageSelect(tab.id);
  const record = { tab, token: info.token, at: { x: Number(info.x) || 0, y: Number(info.y) || 0, w: Number(info.w) || 0, h: Number(info.h) || 0 } };
  pageSelects.set(tab.id, record);
  // a page nobody is looking at has no screen to put a picker on
  if (!tab.el.classList.contains('shown')) { answerPageSelect(tab.id, null); return; }

  const android = device.platform === 'android';
  const el = document.createElement('div');
  el.className = 'page-select' + (android ? ' android' : '');
  const menu = document.createElement('div');
  menu.className = 'page-select-menu';
  menu.setAttribute('role', 'listbox');

  for (const item of info.items.slice(0, PAGE_SELECT_MAX)) {
    if (!item || typeof item !== 'object') continue;
    if (item.rule) {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'page-select-rule' }));
    } else if ('group' in item) {
      // textContent, never markup: every word here comes from the page
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'page-select-group', textContent: String(item.group) }));
    } else if (Number.isInteger(item.i)) {
      const row = document.createElement('button');
      row.className = 'page-select-item';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(item.i === info.selected));
      row.dataset.index = String(item.i);
      row.disabled = Boolean(item.disabled);
      row.innerHTML = android ? '<span class="label"></span><span class="radio"></span>' : `${TICK}<span class="label"></span>`;
      row.querySelector('.label').textContent = String(item.label ?? '');
      menu.appendChild(row);
    }
  }

  el.addEventListener('click', (e) => {
    const row = e.target.closest('.page-select-item');
    if (row) answerPageSelect(tab.id, Number(row.dataset.index));
    else if (!e.target.closest('.page-select-menu')) answerPageSelect(tab.id, null);   // beside it: dismissed
  });
  el.appendChild(menu);
  $('prompts').appendChild(el);
  Object.assign(record, { el, menu });
  placePageSelects();
  reportPageRects();

  const current = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.page-select-item:not(:disabled)');
  current?.focus({ preventScroll: true });
  current?.scrollIntoView({ block: 'center' });
}

/** Hand the choice (or null, for none) back to the page and take the picker down. */
function answerPageSelect(tabId, index) {
  const record = pageSelects.get(tabId);
  if (!record) return;
  const value = Number.isInteger(index) ? index : 'null';
  record.tab.el.executeJavaScript(`window.__ibSelectAnswer && window.__ibSelectAnswer(${record.token}, ${value})`).catch(() => {});
  closePageSelect(tabId);
}

function closePageSelect(tabId) {
  const record = pageSelects.get(tabId);
  if (!record) return;
  record.el?.remove();
  pageSelects.delete(tabId);
  reportPageRects();
}

/** Whether a tab's page is under a picker, and so not to be given the pointer. */
function pageSelectOver(tab) { return pageSelects.has(tab.id); }

/**
 * Keep each picker over its own page as the layout changes, and hang the iOS
 * menu off its control: below if there's room, above if not, and never past
 * the edges of the page.
 */
function placePageSelects() {
  for (const [tabId, { tab, el, menu, at }] of pageSelects) {
    if (!el) continue;
    if (!tabs.includes(tab) || !tab.el.classList.contains('shown')) { answerPageSelect(tabId, null); continue; }
    const s = tab.el.style;
    Object.assign(el.style, { left: s.left, top: s.top, width: s.width, height: s.height, borderRadius: s.borderRadius });
    const paneW = parseFloat(s.width) || 0;
    const paneH = parseFloat(s.height) || 0;
    const edge = 10;

    if (el.classList.contains('android')) { menu.style.maxHeight = `${Math.round(paneH * 0.8)}px`; continue; }

    menu.style.minWidth = `${Math.min(250, paneW - edge * 2)}px`;
    menu.style.maxWidth = `${paneW - edge * 2}px`;
    menu.style.maxHeight = `${paneH - edge * 2}px`;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const below = at.y + at.h + 6;
    const above = at.y - 6 - h;
    const top = below + h <= paneH - edge ? below : above >= edge ? above : Math.max(edge, paneH - edge - h);
    menu.style.left = `${Math.max(edge, Math.min(at.x, paneW - edge - w))}px`;
    menu.style.top = `${top}px`;
  }
}

function wirePageSelects() {
  // capture, and before anything else hears it: Esc dismisses the picker only
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pageSelects.size) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    for (const tabId of [...pageSelects.keys()]) answerPageSelect(tabId, null);
  }, true);
}

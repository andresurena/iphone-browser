'use strict'

/* ============================================================== compare
   "Two devices, side by side" — a bottom-bar toggle available on any ordinary
   device (not iPhone Duo, which has its own Split View for putting two tabs on
   one screen). A second copy of the same phone is drawn beside the first, and
   a tab of your choosing runs in it at the device's full viewport. Two phones
   on a desk, not one screen cut in half — which is the whole point, since what
   you're comparing is then two genuine renderings at the real width rather
   than two half-width ones no real device would ever produce.

   Both devices are the same model: one device is picked in the device menu and
   Compare shows a second of it.

   Which tab is on which device is remembered explicitly (compareLeftId /
   compareRightId) rather than derived from whichever tab is active. That's the
   difference from Duo's Split View, whose panes swap when you click into the
   other one: here, clicking a page to drive it from the toolbar moves the
   focus ring and nothing else, so the two never trade places under your hands.

   How the second device is drawn: inside the FIRST device's screen element,
   which stops clipping while Compare is on. Its body goes in #duoBelow (the
   layer painted under the pages) and its status bar, browser skin, island and
   home indicator are cloned into #duoAbove (painted over them), both shifted
   right by one device width. That reuses the layering that's already correct
   rather than building a second screen whose page could never be stacked
   properly — a <webview> reloads if it's ever moved in the DOM, so every tab's
   page has to stay in the one container it was created in.

   A classic script loaded before shell.js — shares its globals (S, device,
   tabs, activeTabId, phone, …) the same way duo.js and popover.js do. */

/** Space between the two devices, in device pixels — before the stage's scale. */
const COMPARE_GAP = 44;

let compareLeftId = null;
let compareRightId = null;

/** Compare only makes sense on a device that doesn't already show two panes itself. */
function compareActive() {
  return Boolean(S.compare) && !device.foldable;
}

/**
 * Settle which tab sits on which device. Both slots are sticky, so the pair
 * only changes when something asks it to: activating a tab that's already on
 * show just moves the focus ring, and activating one that isn't takes over a
 * slot rather than shuffling both.
 */
function syncComparePair() {
  let left = tabById(compareLeftId) ? compareLeftId : null;
  let right = tabById(compareRightId) ? compareRightId : null;
  if (left != null && left === right) right = null;

  // the tab you're driving from the toolbar always has a device of its own:
  // an empty one if there is one, the first device otherwise
  if (activeTabId != null && left !== activeTabId && right !== activeTabId) {
    if (left == null) left = activeTabId;
    else if (right == null) right = activeTabId;
    else left = activeTabId;
  }
  if (left == null) left = tabs.find((t) => t.id !== right)?.id ?? null;
  if (right == null) right = tabs.find((t) => t.id !== left)?.id ?? null;

  compareLeftId = left;
  compareRightId = right;
  return { left, right };
}

/** The tab on the left-hand device — the original phone. */
const comparePageId = () => (S.compare ? compareLeftId : null);
/** The tab on the right-hand device, or null if there isn't a second tab yet. */
const compareOtherId = () => (S.compare ? compareRightId : null);

function toggleCompare() {
  if (device.foldable) {
    toast('Compare isn’t available on iPhone Duo — its Split View already shows two tabs side by side.');
    return;
  }
  set({ compare: !S.compare });
}

/** Put a tab on the second device, from its icon in the tab strip. */
function setCompareTab(id) {
  if (id === compareLeftId) return;
  compareRightId = id;
  compareKey = '';
  layout();
  renderTabs();
}

/* -------------------------------------------------------------- geometry */

/**
 * The page's corners follow the screen's, but only on a corner it actually
 * reaches — a bar across the top means the page starts below the curve, square.
 * Needed because .screen stops clipping while Compare is on (see the CSS): the
 * rounding the screen used to do for free now has to be on the page itself.
 */
function compareRadii(pane, corners) {
  const [tl, tr, br, bl] = corners;
  return [
    !pane.top && !pane.left ? tl : 0,
    !pane.top && !pane.right ? tr : 0,
    !pane.bottom && !pane.right ? br : 0,
    !pane.bottom && !pane.left ? bl : 0,
  ];
}

/**
 * Two whole phones: the ordinary single-page geometry, plus a second pane of
 * exactly the same size one device-width to the right. Both pages get the full
 * viewport — nothing about either is halved.
 */
function compareGeometry(shared) {
  // settled here, before anything reads the pair: geometry() runs first in
  // layout(), well ahead of placeWebviews() deciding which page goes where
  syncComparePair();
  const g = barGeometry(shared);
  const bz = bezelMargins(shared.landscape);
  const page = g.panes[0];
  const radii = compareRadii(page, shared.corners);
  const offsetX = bz.l + shared.w + bz.r + COMPARE_GAP;

  return {
    ...g,
    compare: true,
    offsetX,
    panes: [
      { ...page, radii },
      { ...page, slot: 'other', x: offsetX, radii },
    ],
  };
}

/* -------------------------------------------------------------- drawing */

/** The overlays that make a screen look like a phone rather than a web page. */
const COMPARE_OVERLAYS = '.statusbar.on, .ui.on, .island, .homebar';

/**
 * The second phone's body — the same titanium frame and side buttons, drawn
 * beneath the pages. The buttons are laid out against #phone's own origin,
 * which is exactly where this wrapper sits for the second device, so the same
 * rules place them correctly here without a word of extra CSS.
 */
function compareBody(g, bz) {
  const body = document.createElement('div');
  body.className = 'compare-body';
  body.style.left = `${g.offsetX - bz.l}px`;
  body.style.top = `${-bz.t}px`;
  // same order as the real phone: buttons behind, frame over them
  for (const btn of phone.querySelectorAll(':scope > .btn')) {
    body.append(btn.cloneNode(false));
  }
  body.insertAdjacentHTML('beforeend', '<div class="frame"><div class="screen"></div></div>');
  return body;
}

/**
 * The second phone's chrome, copied from the first one after layout() has
 * settled every class on it — so it's the same phone showing the same browser,
 * down to which bars are on, then repointed at its own tab. Parsed through a
 * <template> so nothing in the copy is ever live: template contents belong to
 * an inert document, which matters because the markup being copied sits in the
 * same screen as the <webview> elements.
 */
function compareOverlay(g, tabId) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-overlay';
  wrap.style.left = `${g.offsetX}px`;
  wrap.style.width = `${g.w}px`;
  wrap.style.height = `${g.h}px`;
  // a control inside a [data-tab] acts on that tab, not the active one — the
  // same delegation Duo's rails use (see wireUI and syncNav in shell.js)
  if (tabId != null) wrap.dataset.tab = String(tabId);

  if (tabId == null) {
    wrap.innerHTML = `
      <div class="duo-empty" style="inset:0">
        <p>Open a second tab to run it on this device.</p>
        <button class="duo-empty-btn" data-new-tab-here>New Tab</button>
      </div>`;
    return wrap;
  }

  // strictly the real screen's OWN chrome: a descendant search would sweep up
  // the previous copy of it, which lives in a layer inside that same screen,
  // and every rebuild would then copy the copy
  const screen = $('liveHalf').querySelector('.frame > .screen');
  const source = [...screen.children].filter((el) => el.matches(COMPARE_OVERLAYS));
  const tpl = document.createElement('template');
  tpl.innerHTML = source.map((el) => el.outerHTML).join('');
  // ids would be duplicates of the originals'; every rule that styles these is
  // written against their classes, so dropping them costs nothing
  for (const el of tpl.content.querySelectorAll('[id]')) el.removeAttribute('id');
  wrap.append(tpl.content);
  return wrap;
}

/**
 * The second device's own address text, clock and page tint. Text is set with
 * textContent, never interpolated into markup — same reason as paintDuoHosts.
 */
function paintCompareFrame() {
  const wrap = $('duoAbove').querySelector('.compare-overlay');
  if (!wrap) return;

  const tab = tabById(compareRightId);
  const host = hostnameOf(tab?.url || '');
  for (const el of wrap.querySelectorAll('[data-host]')) el.textContent = host;
  for (const el of wrap.querySelectorAll('[data-host-or-placeholder]')) {
    el.textContent = host || 'Search Google or type URL';
  }
  for (const el of wrap.querySelectorAll('[data-host-or-search]')) {
    el.textContent = host || 'Search or enter website';
  }
  for (const el of wrap.querySelectorAll('.statusbar .time')) el.textContent = clockNow();

  // its bars are tinted by ITS page, not the active one's; set on the wrapper
  // so it overrides what #phone hands down to everything else
  applyBarTheme(wrap, tab?.theme);

  const near = $('liveHalf').querySelector('.frame');
  const far = $('duoBelow').querySelector('.compare-body .frame');
  near?.classList.toggle('is-active', compareLeftId === activeTabId);
  far?.classList.toggle('is-active', compareRightId === activeTabId);
}

let compareKey = '';

/**
 * Draw the second device. Mutually exclusive with renderDuo — exactly one of
 * them ever has something to draw for a given layout(), since compareGeometry
 * only runs when usesDuoBars() didn't.
 */
function renderCompare(g) {
  const below = $('duoBelow');
  const above = $('duoAbove');
  if (!g.compare) {
    // renderDuo shares these layers and has already had its turn this
    // layout — only clear what's there if it wasn't the one that drew it
    if (compareKey) {
      compareKey = '';
      if (!g.duo) { below.innerHTML = ''; above.innerHTML = ''; }
    }
    return;
  }

  const right = compareRightId;   // already settled in compareGeometry
  const bz = bezelMargins(g.landscape);
  const key = JSON.stringify([
    g.w, g.h, g.offsetX, bz, right, S.showChrome, S.colorScheme,
    browser.id, deviceEntry.id, g.landscape,
  ]);

  if (key !== compareKey) {
    compareKey = key;
    below.replaceChildren(compareBody(g, bz));
    above.replaceChildren(compareOverlay(g, right));
    renderTabs();   // the tab strip marks which tab is on the second device
  }
  paintCompareFrame();
}

/**
 * Clicking either device makes its tab the one the toolbar drives. Clicking
 * into a page is caught by the webview's own focus event instead (see
 * attachWebviewListeners); this covers the chrome around it. Wired from
 * shell.js's wireUI(), not at top level here: compare.js loads before shell.js
 * has declared `phone`.
 */
function handleCompareActivateClick(e) {
  if (!compareActive()) return;
  const id = e.target.closest('.compare-overlay, .compare-body') ? compareRightId : compareLeftId;
  if (id != null && id !== activeTabId) activateTab(id);
}

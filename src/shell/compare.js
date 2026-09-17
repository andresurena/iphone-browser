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

   How the second device is drawn: a <webview> reloads if it's ever moved in
   the DOM, so every tab's page has to stay in the one #webviews container it
   was created in — there can be no second .screen to put the second page in.
   So the second device is drawn around that one screen instead. Its body goes
   in #compareBody, a sibling of the frame, and its status bar, browser skin,
   island and home indicator are cloned into #duoAbove, the layer painted over
   the pages, shifted right by one device width.

   .screen then clips to BOTH screens at once with a clip-path holding two
   rounded rectangles. It can't simply stop clipping: everything drawn on the
   first device — its status bar, its browser bars, its home indicator — is a
   child of .screen too, and without a clip those square corners spill out over
   the bezel's curve.

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
 * Two whole phones: the ordinary single-page geometry, plus a second pane of
 * exactly the same size one device-width to the right. Both pages get the full
 * viewport — nothing about either is halved. The second phone is the same
 * model, so it reuses the first pane's corner radii rather than recomputing
 * them against its own offset origin.
 */
function compareGeometry(shared) {
  // settled here, before anything reads the pair: geometry() runs first in
  // layout(), well ahead of placeWebviews() deciding which page goes where
  syncComparePair();
  const g = barGeometry(shared);
  const bz = bezelMargins(shared.landscape);
  const page = g.panes[0];
  const offsetX = bz.l + shared.w + bz.r + COMPARE_GAP;

  return {
    ...g,
    compare: true,
    offsetX,
    panes: [page, { ...page, slot: 'other', x: offsetX }],
  };
}

/* -------------------------------------------------------------- drawing */

/** The overlays that make a screen look like a phone rather than a web page. */
const COMPARE_OVERLAYS = '.statusbar.on, .ui.on, .island, .homebar';

/**
 * The second phone's body — the same titanium frame and side buttons. It sits
 * outside .screen, so it's measured from #phone's own origin, which is where
 * the FIRST frame's outside edge is. One device width to the right puts it
 * exactly where the second frame belongs, and the side buttons' own rules then
 * place them correctly without a word of extra CSS.
 */
function compareBody(g) {
  const body = document.createElement('div');
  body.className = 'compare-body';
  body.style.left = `${g.offsetX}px`;
  body.style.top = '0';
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

/** One rounded rectangle, corners clockwise from the top left. */
function rrectPath(x, y, w, h, [tl, tr, br, bl]) {
  const arc = (r, ex, ey) => (r ? `A${r},${r} 0 0 1 ${ex},${ey}` : `L${ex},${ey}`);
  return `M${x + tl},${y}`
    + `L${x + w - tr},${y}` + arc(tr, x + w, y + tr)
    + `L${x + w},${y + h - br}` + arc(br, x + w - br, y + h)
    + `L${x + bl},${y + h}` + arc(bl, x, y + h - bl)
    + `L${x},${y + tl}` + arc(tl, x + tl, y)
    + 'Z';
}

/**
 * Clip .screen to the screen shape, and in Compare to both screens at once —
 * two subpaths in one clip-path is a union, so each device keeps its own
 * rounded corners and the gap between them shows the stage behind.
 *
 * This is set even with Compare off, where it only repeats what the element's
 * own border-radius and overflow already describe. It repeats it because a
 * <webview> is a composited guest view: an ancestor's rounded overflow does not
 * reliably clip one on the live compositor, though it does in a software
 * screenshot — which is why square corners spilling over the bezel only ever
 * showed up on screen and never in a capture. A clip-path is applied to the
 * layer itself, so the corners hold.
 */
function setScreenClip(g) {
  const screen = $('liveHalf').querySelector('.frame > .screen');
  if (!screen) return;
  const near = rrectPath(0, 0, g.w, g.h, g.corners);
  const far = g.compare ? ' ' + rrectPath(g.offsetX, 0, g.w, g.h, g.corners) : '';
  screen.style.clipPath = `path('${near}${far}')`;
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
  const bodyHost = $('compareBody');
  setScreenClip(g);
  if (!g.compare) {
    if (bodyHost.firstChild) bodyHost.replaceChildren();
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
    bodyHost.replaceChildren(compareBody(g));
    below.replaceChildren();
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

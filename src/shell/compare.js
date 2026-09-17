'use strict'

/* ============================================================== compare
   "See two pages side by side" — a bottom-bar toggle available on any
   ordinary device (not iPhone Duo, which already has its own Split View for
   exactly this). Splits the phone's own screen into two panes, the active
   tab on the left and a second tab of your choosing on the right, both
   emulated at half width.

   Deliberately its own small mechanism rather than reusing Duo's device.split
   machinery: Duo's panes swap sides when you click into the "other" one (see
   the `focus` listener in attachWebviewListeners, gated on device.split), which
   suits multitasking on a real foldable but would be disorienting here — you
   want to poke around each page in place, not have them jump sides. So Compare
   keeps its own `compareTabId`, chosen explicitly (the small icon on a tab, or
   the empty pane's "New Tab"), and clicking into either pane's content just
   lets you use it — it stays put until you choose differently.

   A classic script loaded before shell.js — shares its globals (S, device,
   tabs, activeTabId, phone, …) the same way duo.js and popover.js do. */

let compareTabId = null;

/** Compare only makes sense on a device that doesn't already show two panes itself. */
function compareActive() {
  return Boolean(S.compare) && !device.foldable;
}

/** Who's shown in the right pane, or null if Compare isn't on. */
function compareOtherId() {
  return S.compare ? compareTabId : null;
}

function toggleCompare() {
  if (device.foldable) {
    toast('Compare isn’t available on iPhone Duo — its Split View already shows two tabs side by side.');
    return;
  }
  set({ compare: !S.compare });
}

/** Explicitly choose which tab shows in the right pane, from its icon in the tab strip. */
function setCompareTab(id) {
  if (id === activeTabId) return;
  compareTabId = id;
  compareKey = '';
  renderTabs();
  layout();
}

/**
 * Split the screen into two plain panes, left and right, no rail or bezel
 * chrome of Duo's — just the ordinary status bar and home indicator, shared
 * across both, exactly as they'd look on one physical screen showing two
 * things at once. Any drawn browser skin can't sensibly span two different
 * pages, so it's suppressed here regardless of the "Show Browser Interface"
 * setting (see activeSkins in shell.js) in favour of the compact bar this
 * file draws over the right pane only — the left one is the plain page,
 * exactly as it'd look with Compare off.
 */
const COMPARE_GAP = 8;
const COMPARE_RADIUS = 16;

function compareGeometry(shared) {
  const { landscape, w, h } = shared;
  const statusH = (landscape && device.platform === 'ios') ? 0 : device.statusBar;
  const safeArea = landscape
    ? { ...device.landscapeSafeArea }
    : { top: device.statusBar, right: 0, bottom: device.homeIndicator, left: 0 };
  const front = device.front;

  // whole points only: the emulation protocol rejects a fractional viewport
  const pw = Math.floor((w - COMPARE_GAP) / 2);
  const gapW = w - pw * 2;
  const r = COMPARE_RADIUS;

  const mkPane = (x, slot, radii) => ({
    slot, x, y: 0, w: pw, h, radii,
    top: 0, bottom: 0, left: 0, right: 0,
    viewW: pw, viewH: h,
    safeArea,
  });

  return {
    ...shared,
    duo: false, rail: false, split: false, compare: true,
    statusH, top: 0, bottom: 0, left: 0, right: 0, floating: 0,
    frontW: landscape ? front.h ?? front.d ?? 0 : front.w ?? front.d ?? 0,
    frontH: landscape ? front.w ?? front.d ?? 0 : front.h ?? front.d ?? 0,
    frontTop: front.top,
    // rounded only on the side facing the gap — the outer edges are already
    // clipped by .screen's own corner radius, same trick Duo's split uses
    divider: { x: pw, y: 0, w: gapW, h, axis: 'vertical' },
    panes: [
      mkPane(0, 'page', [0, r, r, 0]),
      mkPane(pw + gapW, 'other', [r, 0, 0, r]),
    ],
  };
}

/* --------------------------------------------------------------- drawing */

const COMPARE_ICONS = {
  back: '<path d="M10 3 5 8l5 5"/>',
  forward: '<path d="M6 3l5 5-5 5"/>',
  reload: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.6v2.7h-2.7"/>',
};
const compareIcon = (name) => `<svg viewBox="0 0 16 16">${COMPARE_ICONS[name]}</svg>`;

/** The floating mini-toolbar over the right pane: back, forward, hostname, reload. */
function compareBarMarkup(pane, tabId) {
  return `
    <div class="compare-bar" data-tab="${tabId}" style="left:${pane.x}px; top:${pane.y}px; width:${pane.w}px">
      <button class="compare-nav" data-back title="Back">${compareIcon('back')}</button>
      <button class="compare-nav" data-forward title="Forward">${compareIcon('forward')}</button>
      <button class="compare-host" data-compare-activate title="Make this the main tab">
        <span data-compare-host></span>
      </button>
      <button class="compare-nav" data-reload title="Reload">${compareIcon('reload')}</button>
    </div>`;
}

/** The bar's hostname is set via textContent, not interpolated — see paintDuoHosts for why. */
function paintCompareHosts() {
  const el = document.querySelector('.compare-bar [data-compare-host]');
  if (!el) return;
  const tab = tabById(compareTabId);
  el.textContent = tab ? (tab.title || hostnameOf(tab.url) || 'New Tab') : '';
}

let compareKey = '';

/**
 * Draw Compare's two panes, divider and mini-toolbar. Mutually exclusive with
 * renderDuo — exactly one of them ever has something to draw for a given
 * layout(), since compareGeometry only runs when usesDuoBars() didn't.
 */
function renderCompare(g) {
  const below = $('duoBelow');
  const above = $('duoAbove');
  if (!g.compare) {
    if (compareKey) { below.innerHTML = ''; above.innerHTML = ''; compareKey = ''; }
    return;
  }

  // drop a stale pick (closed, or now the active tab itself), then default to
  // the first other open tab — mirrors Duo's own otherTabId() auto-pick
  if (compareTabId != null && (compareTabId === activeTabId || !tabById(compareTabId))) compareTabId = null;
  if (compareTabId == null) compareTabId = tabs.find((t) => t.id !== activeTabId)?.id ?? null;

  const key = JSON.stringify([g.w, g.h, g.panes, g.divider, activeTabId, compareTabId, tabs.length]);
  if (key === compareKey) return;
  compareKey = key;

  const px = (r) => (r ? r.map((v) => `${v}px`).join(' ') : '0');
  let under = '';
  let over = '';

  for (const pane of g.panes) {
    const tabId = pane.slot === 'page' ? activeTabId : compareTabId;
    under += `<div class="duo-pane" style="left:${pane.x}px; top:${pane.y}px;
      width:${pane.w}px; height:${pane.h}px; border-radius:${px(pane.radii)}"></div>`;

    if (pane.slot === 'other' && compareTabId == null) {
      over += `<div class="duo-empty" style="left:${pane.x}px; top:${pane.y}px;
        width:${pane.w}px; height:${pane.h}px">
        <p>Open a second tab to compare it here, side by side.</p>
        <button class="duo-empty-btn" data-new-tab-here>New Tab</button>
      </div>`;
    } else if (pane.slot === 'other') {
      over += compareBarMarkup(pane, tabId);
    }
  }

  const d = g.divider;
  under += `<div class="duo-divider ${d.axis}" style="left:${d.x}px; top:${d.y}px;
    width:${d.w}px; height:${d.h}px"><span class="duo-grabber"></span></div>`;

  below.innerHTML = under;
  above.innerHTML = over;
  paintCompareHosts();
  renderTabs();   // reflects a freshly auto-picked (or cleared) compare tab
}

/**
 * Clicking a right-pane's hostname pill makes that tab the main one — the left
 * pane then shows it, and whichever tab was active moves to the right
 * (renderCompare's auto-pick clears the stale compareTabId next render). Wired
 * from shell.js's wireUI(), not here at top level: compare.js loads before
 * shell.js has declared `phone`.
 */
function handleCompareActivateClick(e) {
  const btn = e.target.closest('[data-compare-activate]');
  if (!btn || !phone.contains(btn)) return;
  const id = Number(btn.closest('[data-tab]')?.dataset.tab);
  if (id) activateTab(id);
}

'use strict'

/* ============================================================== foldables
   Everything specific to a device with more than one display: turning the
   chosen display into the flat device shape the rest of the shell reads,
   dividing the screen into panes, and drawing iPhone Duo's vertical rail.

   A classic script loaded before shell.js — it shares that file's globals
   (S, device, deviceEntry, tabs, activeTabId, …) and only touches them from
   inside functions, which run after shell.js has set them up. */

/**
 * iPhone Duo's rail and Split View, in points. Measured from the diagrams in
 * Apple's "Designing for iPhone Duo" — Mail on the outer display, the toolbar
 * and tab bar callouts, the landscape compaction examples and Split View —
 * because Apple publishes no inset values and there's no hardware until
 * 23 October 2026. Every number here is an estimate to revisit then.
 */
const DUO_RAIL = {
  inset: 80,        // content inset on the rail's edge while the browser UI is drawn
  bareInset: 62,    // safe-area inset on that edge when the page owns the screen
  column: 48,       // from the edge to the centre line of the controls
  button: 46,       // one glass button
  capsule: 86,      // two grouped items sharing one glass capsule
  gap: 12,
  camera: { d: 34, fromEdge: 48, fromEnd: 46 },
  status: 54,       // the clock over the combined Wi-Fi / signal / battery glyph
  endMargin: 24,
  divider: 16,      // Split View: the gap between the two apps
  paneRadius: 22,   // Split View: each app window's corners on the divider side
};

/* ------------------------------------------------------------- displays */

/** The display chosen for a foldable, or null for a device with just one. */
function displayOf(entry) {
  if (!entry?.displays) return null;
  const chosen = S.displays?.[entry.id];
  return entry.displays.find((d) => d.id === chosen) || entry.displays[0];
}

/** A display's menu label. Split View's halves are top and bottom when upright. */
function displayLabel(display, landscape) {
  return (!landscape && display.nameUpright) || display.name;
}

/**
 * Flatten a device and its chosen display into one object shaped like any other
 * device, so emulation and screenshots never need to know foldables exist. A
 * display that's a variation of another (`of`) — folded, or split — inherits
 * that physical display's size and shape.
 */
function resolveDevice(entry) {
  const shown = displayOf(entry);
  if (!shown) return entry;
  const physical = shown.of ? entry.displays.find((d) => d.id === shown.of) : shown;
  const { displays, ...rest } = entry;
  return {
    ...rest,
    ...physical,
    ...shown,
    id: entry.id,
    displayId: shown.id,
    name: `${entry.name} ${shown.name}`,
    screenRadius: physical.screenRadius ?? physical.corners?.free ?? 0,
    // Duo's cameras are drawn by renderDuo(), not the classic island
    front: { type: 'none', w: 0, h: 0, top: 0 },
  };
}

/** Whether this display runs its controls down an edge rather than across. */
function usesRail(landscape) {
  return Boolean(device.split)
    || device.rail === 'always'
    || (device.rail === 'landscape' && landscape);
}

/* ---------------------------------------------------------------- shape */

/** Screen corner radii as [top-left, top-right, bottom-right, bottom-left]. */
function screenCorners(landscape) {
  if (!device.corners) {
    const r = device.screenRadius;
    return [r, r, r, r];
  }
  const { hinge, free } = device.corners;
  // the hinge runs down the left in portrait; turned clockwise it's along the top
  return landscape ? [hinge, hinge, free, free] : [hinge, free, free, hinge];
}

function hingeEdge(landscape) {
  return device.hinge ? (landscape ? 'top' : 'left') : null;
}

/**
 * The outer display's camera: a circle in the top-right corner, in line with
 * the rail. It's fixed to the hardware, so turning the device clockwise carries
 * it to the bottom-right — which is where Apple's landscape diagrams put it.
 */
function cameraSpot(w, h, landscape) {
  if (device.camera !== 'corner') return null;
  const { d, fromEdge, fromEnd } = DUO_RAIL.camera;
  return landscape
    ? { x: w - fromEdge, y: h - fromEnd, d, end: 'end' }
    : { x: w - fromEdge, y: fromEnd, d, end: 'start' };
}

/**
 * Where the fold runs when the inner display is partially folded: down the
 * middle in landscape (the book pose), across it in portrait (the laptop pose).
 * Web content is never told — Safari has no viewport-segments support — so this
 * is purely a visual: it shows where the crease lands on your layout.
 */
function creaseOf(w, h, landscape) {
  if (!device.folded) return null;
  return landscape
    ? { axis: 'vertical', at: w / 2 }
    : { axis: 'horizontal', at: h / 2 };
}

/* ---------------------------------------------------------------- panes */

function railPane(rect, edge, { status, cameraAt = null }) {
  const R = DUO_RAIL;
  const inset = S.showChrome ? R.inset : 0;
  const left = edge === 'left' ? inset : 0;
  const right = edge === 'right' ? inset : 0;
  return {
    ...rect,
    edge,
    status,
    cameraAt,
    top: 0,
    bottom: 0,
    left,
    right,
    viewW: rect.w - left - right,
    viewH: rect.h,
    // With the browser UI drawn it covers the rail, so the page sees no inset,
    // exactly as on a normal iPhone. Without it the page owns the pane and has
    // to keep clear of the status column on the rail edge — one edge only.
    safeArea: S.showChrome
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : {
          top: 0,
          right: edge === 'right' ? R.bareInset : 0,
          bottom: rect.h > rect.w ? device.homeIndicator : 21,
          left: edge === 'left' ? R.bareInset : 0,
        },
  };
}

/**
 * Split the screen into panes. One pane normally; in Split View, two app
 * windows with a divider between them, each with its rail on its own outer edge
 * — the left app's on the left — and the status bar on the trailing app only.
 * Upright, the apps stack, and both keep their rail on the right.
 */
function duoPanes(w, h, landscape) {
  if (!device.split) {
    const cam = cameraSpot(w, h, landscape);
    return {
      divider: null,
      panes: [{
        slot: 'page',
        radii: null,
        ...railPane({ x: 0, y: 0, w, h }, 'right', {
          // iOS drops the status bar with the outer display turned, as on any iPhone
          status: !(landscape && device.camera === 'corner'),
          cameraAt: cam ? cam.end : null,
        }),
      }],
    };
  }

  const { divider: gap, paneRadius: r } = DUO_RAIL;
  let leading;
  let trailing;
  let divider;
  if (landscape) {
    const pw = (w - gap) / 2;
    leading = { ...railPane({ x: 0, y: 0, w: pw, h }, 'left', { status: false }), radii: [0, r, r, 0] };
    trailing = { ...railPane({ x: pw + gap, y: 0, w: pw, h }, 'right', { status: true }), radii: [r, 0, 0, r] };
    divider = { x: pw, y: 0, w: gap, h, axis: 'vertical' };
  } else {
    const ph = (h - gap) / 2;
    leading = { ...railPane({ x: 0, y: 0, w, h: ph }, 'right', { status: true }), radii: [0, 0, r, r] };
    trailing = { ...railPane({ x: 0, y: ph + gap, w, h: ph }, 'right', { status: false }), radii: [r, r, 0, 0] };
    divider = { x: 0, y: ph, w, h: gap, axis: 'horizontal' };
  }

  const pageLeads = device.split === 'leading';
  leading.slot = pageLeads ? 'page' : 'other';
  trailing.slot = pageLeads ? 'other' : 'page';
  return { divider, panes: [leading, trailing] };
}

/* ----------------------------------------------------------- Split View
   The other half shows another open tab, live. Picking that tab — in the tab
   strip or by clicking into it — doesn't move either page: the "page" side
   moves to it instead, so the address bar always edits the half in focus. */
let splitOtherId = null;

function otherTabId() {
  if (!device?.split) return null;
  if (splitOtherId !== activeTabId && tabById(splitOtherId)) return splitOtherId;
  splitOtherId = tabs.find((t) => t.id !== activeTabId)?.id ?? null;
  return splitOtherId;
}

/** Called by activateTab(): if the tab is already in the other half, swap sides. */
function followSplitFocus(nextId) {
  // activeTabId is still null on launch, when there's no side to swap from
  if (!device?.split || activeTabId == null) return;
  if (nextId === activeTabId || nextId !== otherTabId()) return;
  splitOtherId = activeTabId;
  const flipped = device.split === 'leading' ? 'split-trailing' : 'split-leading';
  const displays = { ...S.displays, [deviceEntry.id]: flipped };
  S = { ...S, displays };
  window.bridge.setState({ displays });
  device = resolveDevice(deviceEntry);
}

function paneForTab(tabId, g) {
  const slot = g.split && tabId !== activeTabId && tabId === otherTabId() ? 'other' : 'page';
  return g.panes.find((p) => p.slot === slot);
}

/** The empty half's "New Tab" button: open a tab right there and focus it. */
function openTabInOtherHalf() {
  if (tabs.length >= MAX_TABS) {
    toast(`Limited to ${MAX_TABS} tabs — keeps every preview fast and stable.`);
    return;
  }
  const tab = createTab(null, { activate: false });
  splitOtherId = tab.id;
  activateTab(tab.id);
  urlInput.focus();
  urlInput.select();
}

/* ----------------------------------------------------------------- rail */

const RAIL_ICONS = {
  back: '<path d="M14.5 5 8 12l6.5 7"/>',
  forward: '<path d="M9.5 5 16 12l-6.5 7"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.35-5.65"/><path d="M20.2 3.4v4.3h-4.3"/>',
  plus: '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
  tabs: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4"/>',
  more: '<circle cx="5.4" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.6" cy="12" r="1.9"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="M15.4 15.4 20.4 20.4"/>',
};
const railIcon = (name) => `<svg viewBox="0 0 24 24">${RAIL_ICONS[name]}</svg>`;

// iPhone Duo folds Wi-Fi, signal and battery into one round glyph: Wi-Fi in the
// middle of a battery ring, the ring broken at the bottom by the signal dots.
const STATUS_GLYPH = `
  <svg class="duo-glyph" viewBox="0 0 32 32" aria-label="Wi-Fi, signal and battery">
    <path class="ring" d="M6.81 25.19A13 13 0 1 1 25.19 25.19"/>
    <circle cx="9.5" cy="27.26" r="1.35"/><circle cx="13.74" cy="28.8" r="1.35"/>
    <circle cx="18.26" cy="28.8" r="1.35"/><circle cx="22.5" cy="27.26" r="1.35"/>
    <path class="arc" d="M10.34 14.84A8 8 0 0 1 21.66 14.84"/>
    <path class="arc" d="M12.82 17.32A4.5 4.5 0 0 1 19.18 17.32"/>
    <circle cx="16" cy="20.5" r="1.4"/>
  </svg>`;

/**
 * What fits down a rail, most complete first. Following Apple's order, toolbar
 * items overflow into the "…" menu before the tab bar is touched, and then the
 * tab bar collapses to a single control — exactly the two landscape compaction
 * examples in the guidelines.
 */
function railPlan(pane) {
  const R = DUO_RAIL;
  const head = pane.cameraAt === 'start'
    ? R.camera.fromEnd + R.camera.d / 2 + R.gap
    : (pane.status ? 20 : R.endMargin);
  const foot = pane.cameraAt === 'end'
    ? R.camera.fromEnd + R.camera.d / 2 + 14
    : R.endMargin;
  const room = pane.h - head - foot - (pane.status ? R.status + 16 : 0);

  const toolbar = { full: R.button + R.gap + R.capsule + R.gap + R.button, lean: R.button * 2 + R.gap };
  const tabbar = { full: R.capsule + R.gap + R.button, lean: R.button };
  const plans = [
    { toolbar: 'full', tabbar: 'full' },
    { toolbar: 'lean', tabbar: 'full' },
    { toolbar: 'lean', tabbar: 'lean' },
  ];
  const fits = plans.find((p) => toolbar[p.toolbar] + 24 + tabbar[p.tabbar] <= room);
  return { head, foot, ...(fits || { toolbar: 'back', tabbar: 'lean' }) };
}

function railMarkup(pane, tabId) {
  const R = DUO_RAIL;
  const plan = railPlan(pane);
  const round = (attrs, icon, title, extra = '') =>
    `<button class="glass round" ${attrs} title="${title}">${railIcon(icon)}${extra}</button>`;
  const item = (attrs, icon, title, extra = '') =>
    `<button class="cap-item" ${attrs} title="${title}">${railIcon(icon)}${extra}</button>`;
  const count = '<span class="count" data-tab-count>1</span>';

  let toolbar = '';
  let tabbar = '';
  // an empty Split View half has no page for its controls to act on
  if (S.showChrome && tabId != null) {
    toolbar = round('data-back', 'back', 'Back');
    if (plan.toolbar === 'full') {
      toolbar += `<div class="glass capsule">${item('data-forward', 'forward', 'Forward')}${item('data-reload', 'reload', 'Reload')}</div>`;
    }
    if (plan.toolbar !== 'back') toolbar += round('data-more', 'more', 'More');

    tabbar = plan.tabbar === 'full'
      ? `<div class="glass capsule">${item('data-new-tab', 'plus', 'New Tab')}${item('data-tabs', 'tabs', 'Tabs', count)}</div>`
        + round('data-search', 'search', 'Search or enter website')
      : round('data-tabs', 'tabs', 'Tabs', count);
  }

  const status = pane.status
    ? `<div class="duo-status"><span class="time" data-clock>9:41</span>${STATUS_GLYPH}</div>`
    : '';
  const column = pane.edge === 'right' ? R.inset - R.column : R.column;

  return `
    <div class="duo-rail" data-tab="${tabId ?? ''}" style="
      left:${pane.edge === 'right' ? pane.x + pane.w - R.inset : pane.x}px;
      top:${pane.y}px; width:${R.inset}px; height:${pane.h}px">
      <div class="duo-col" style="left:${column - R.button / 2}px; width:${R.button}px;
        padding-top:${plan.head}px; padding-bottom:${plan.foot}px">
        ${status}
        <div class="duo-group">${toolbar}</div>
        <div class="duo-spring"></div>
        <div class="duo-group">${tabbar}</div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- drawing */

/**
 * Round a Split View window's corners on the divider side. A <webview> isn't
 * clipped by border-radius — its page is composited on top regardless — so each
 * rounded corner gets a small square painted black everywhere outside the arc,
 * laid over the page.
 */
function cornerMasks(pane) {
  if (!pane.radii) return '';
  const spots = [
    [pane.x, pane.y, '100% 100%'],                                     // top-left
    [pane.x + pane.w - pane.radii[1], pane.y, '0 100%'],               // top-right
    [pane.x + pane.w - pane.radii[2], pane.y + pane.h - pane.radii[2], '0 0'], // bottom-right
    [pane.x, pane.y + pane.h - pane.radii[3], '100% 0'],               // bottom-left
  ];
  return pane.radii.map((r, i) => {
    if (!r) return '';
    const [x, y, at] = spots[i];
    return `<div class="duo-corner" style="left:${x}px; top:${y}px; width:${r}px; height:${r}px;
      background:radial-gradient(circle ${r}px at ${at}, transparent ${r - 0.5}px, #000 ${r}px)"></div>`;
  }).join('');
}

let duoKey = '';

/**
 * Draw what a foldable adds around the pages: each pane's window, the Split View
 * divider, the rails, the camera and the crease. Rebuilt only when something it
 * depends on changes — layout() also runs on every step of a window resize.
 */
function renderDuo(g) {
  const below = $('duoBelow');
  const above = $('duoAbove');
  if (!g.rail && !g.crease && !g.camera) {
    if (duoKey) { below.innerHTML = ''; above.innerHTML = ''; duoKey = ''; }
    return;
  }

  const otherId = g.split ? otherTabId() : null;
  const key = JSON.stringify([g.w, g.h, g.panes, g.divider, g.camera, g.crease,
    S.showChrome, activeTabId, otherId, tabs.length]);
  if (key === duoKey) return;
  duoKey = key;

  const px = (r) => (r ? r.map((v) => `${v}px`).join(' ') : '0');
  let under = '';
  let over = '';

  if (g.rail) {
    for (const pane of g.panes) {
      const tabId = pane.slot === 'page' ? activeTabId : otherId;
      under += `<div class="duo-pane" style="left:${pane.x}px; top:${pane.y}px;
        width:${pane.w}px; height:${pane.h}px; border-radius:${px(pane.radii)}"></div>`;
      over += railMarkup(pane, tabId);

      if (pane.slot === 'other' && otherId == null) {
        over += `<div class="duo-empty" style="left:${pane.x + pane.left}px; top:${pane.y}px;
          width:${pane.viewW}px; height:${pane.h}px">
          <p>Open a second tab to see it here, side by side.</p>
          <button class="duo-empty-btn" data-new-tab-here>New Tab</button>
        </div>`;
      }
      over += cornerMasks(pane);
    }
  }

  if (g.divider) {
    const d = g.divider;
    under += `<div class="duo-divider ${d.axis}" style="left:${d.x}px; top:${d.y}px;
      width:${d.w}px; height:${d.h}px"><span class="duo-grabber"></span></div>`;
  }
  if (g.crease) {
    const c = g.crease;
    over += c.axis === 'vertical'
      ? `<div class="duo-crease vertical" style="left:${c.at}px"></div>`
      : `<div class="duo-crease horizontal" style="top:${c.at}px"></div>`;
  }
  if (g.camera) {
    const c = g.camera;
    over += `<div class="duo-camera" style="left:${c.x - c.d / 2}px; top:${c.y - c.d / 2}px;
      width:${c.d}px; height:${c.d}px"></div>`;
  }

  below.innerHTML = under;
  above.innerHTML = over;
  tickClock();
  renderTabCounts();
  syncNav();
}

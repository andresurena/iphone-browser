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
  // Safari keeps its address bar horizontal on a rail layout — a floating pill
  // at the foot of the pane, beside the rail (Apple's launch event, Split View)
  addr: { height: 46, side: 12, bottom: 14 },
  // Horizontal layouts — the inner display upright, and stacked Split View —
  // put Safari's bar and the status capsule along the top instead, the page
  // running under both (Apple's launch footage: Safari on the inner display)
  topbar: { height: 46, side: 12, top: 10 },
  statusPill: 82,   // the time-and-glyph capsule's width
};

/**
 * Apple's own bezel images (Apple Design Resources, Star White), laid over the
 * screen with the cutout left transparent. `screen` is the cutout inside the
 * image in pixels at 3×, measured from the files; the image box around it is
 * what the frame is padded to, so the cutout lands exactly on the page. The
 * landscape outer image is turned 180° from Apple's so the hinge is at the top,
 * where the guidelines' landscape diagrams put it.
 */
const BEZELS = {
  'outer-portrait':  { src: 'bezels/duo-outer-portrait.png',  img: [1574, 2194], screen: [88, 80, 1398, 2034] },
  'outer-landscape': { src: 'bezels/duo-outer-landscape.png', img: [2194, 1574], screen: [80, 88, 2034, 1398] },
  'inner-portrait':  { src: 'bezels/duo-inner-portrait.png',  img: [2247, 3093], screen: [120, 120, 2007, 2853] },
  'inner-landscape': { src: 'bezels/duo-inner-landscape.png', img: [3093, 2247], screen: [120, 120, 2853, 2007] },
};
const BEZEL_BACK = { src: 'bezels/duo-back.png', img: [1040, 1463], scale: 2 };

/** The bezel image for the current display and orientation, or null. */
function bezelFor(landscape) {
  if (!device?.foldable) return null;
  return BEZELS[`${device.of || device.displayId}-${landscape ? 'landscape' : 'portrait'}`] || null;
}

/** Frame padding per side, in points: the bezel image's margins around its cutout. */
function bezelMargins(landscape) {
  const bz = bezelFor(landscape);
  if (!bz) { const b = device.bezel; return { t: b, r: b, b, l: b }; }
  const [iw, ih] = bz.img; const [sx, sy, sw, sh] = bz.screen;
  return { t: sy / 3, r: (iw - sx - sw) / 3, b: (ih - sy - sh) / 3, l: sx / 3 };
}

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
    foldable: true,
    screenRadius: physical.screenRadius ?? physical.corners?.free ?? 0,
    // Duo's cameras are drawn by renderDuo(), not the classic island
    front: { type: 'none', w: 0, h: 0, top: 0 },
  };
}

/** Whether this display runs its controls down an edge rather than across. */
function usesRail(landscape) {
  // stacked apps use horizontal bars; only side-by-side ones get rails
  if (device.split) return landscape;
  return device.rail === 'always' || (device.rail === 'landscape' && landscape);
}

/** Whether the foldable's own chrome is drawn for this browser and layout. */
function usesDuoBars(landscape) {
  return usesRail(landscape) || Boolean(device.split) || (device.foldable && browser.id === 'safari');
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
  // the rail is frosted glass over the page, not beside it (Apple's Split View
  // still: the photo runs on under the controls) — so the page keeps the whole
  // pane and reports the rail as its safe-area inset on that edge
  const inset = S.showChrome ? R.inset : R.bareInset;
  return {
    ...rect,
    edge,
    status,
    cameraAt,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    viewW: rect.w,
    viewH: rect.h,
    safeArea: {
      top: 0,
      right: edge === 'right' ? inset : 0,
      bottom: rect.h > rect.w ? device.homeIndicator : 21,
      left: edge === 'left' ? inset : 0,
    },
  };
}

/**
 * A pane with horizontal bars: Safari's capsule along the top with the status
 * capsule beside it, the page running under them. What the inner display
 * gives Safari upright, and what every pane gets when two apps stack.
 */
function topPane(rect, { status, foot }) {
  const T = DUO_RAIL.topbar;
  const barFoot = T.top * 2 + T.height;
  return {
    ...rect,
    edge: null,
    status,
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    viewW: rect.w,
    viewH: rect.h,
    // the capsules float, so the page keeps the whole pane and is told what
    // they cover; the home indicator only matters on the pane that has it
    safeArea: {
      top: S.showChrome ? barFoot : (status ? DUO_RAIL.topbar.top + T.height : 0),
      right: 0,
      bottom: foot ? device.homeIndicator : 0,
      left: 0,
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
    // with simulated controls on the laptop's base, the page is the upper half
    const controls = device.pose === 'laptop' && laptopControlsUrl;
    const rect = { x: 0, y: 0, w, h: controls ? Math.floor(h / 2) : h };   // whole pixels: CDP rejects a fractional viewport
    return {
      divider: null,
      panes: [{
        slot: 'page',
        radii: null,
        ...(usesRail(landscape)
          ? railPane(rect, 'right', {
              // iOS drops the status bar with the outer display turned, as on any iPhone
              status: !(landscape && device.camera === 'corner'),
              cameraAt: cam ? cam.end : null,
            })
          : topPane(rect, { status: true, foot: !controls })),
      }],
    };
  }

  const { divider: gap, paneRadius: r } = DUO_RAIL;
  let leading;
  let trailing;
  let divider;
  if (landscape) {
    // whole points: the emulation protocol rejects a fractional viewport, and
    // 951 − 16 doesn't halve evenly — the divider takes the odd point
    const pw = Math.floor((w - gap) / 2);
    const gapW = w - pw * 2;
    leading = { ...railPane({ x: 0, y: 0, w: pw, h }, 'left', { status: false }), radii: [0, r, r, 0] };
    trailing = { ...railPane({ x: pw + gapW, y: 0, w: pw, h }, 'right', { status: true }), radii: [r, 0, 0, r] };
    divider = { x: pw, y: 0, w: gapW, h, axis: 'vertical' };
  } else {
    // stacked: horizontal bars in both, and no status pill — on the device it's
    // a glass capsule that fades away, so drawing it just misleads. A video on
    // top takes a quarter and the app below runs on past the fold.
    const ratio = device.splitRatio || 0.5;
    const ph = Math.round((h - gap) * ratio);
    leading = { ...topPane({ x: 0, y: 0, w, h: ph }, { status: false, foot: false }), radii: [0, 0, r, r] };
    trailing = { ...topPane({ x: 0, y: ph + gap, w, h: h - gap - ph }, { status: false, foot: true }), radii: [r, r, 0, 0] };
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
  if (!device?.split || device.placeholderOther) return null;
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

/**
 * Which pane a tab belongs in — resolved the same way whether the second pane
 * came from Duo's own Split View (g.split) or the generic Compare mode
 * (g.compare, see compare.js): whichever supplied it names who's in the
 * "other" slot, everything else defaults to "page".
 */
function paneForTab(tabId, g) {
  const other = g.split ? otherTabId() : (g.compare ? compareOtherId() : null);
  const page = g.compare ? comparePageId() : activeTabId;
  const slot = other != null && tabId !== page && tabId === other ? 'other' : 'page';
  return g.panes.find((p) => p.slot === slot) || g.panes[0];
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
  book: '<path d="M12 6.2c-1.6-1.4-4-2-7.2-1.6v13.6c3.2-.4 5.6.2 7.2 1.6 1.6-1.4 4-2 7.2-1.6V4.6c-3.2-.4-5.6.2-7.2 1.6z"/><path d="M12 6.2v13.6"/>',
  lines: '<path d="M4.5 7h15M4.5 12h15M4.5 17h15"/>',
  tabs2: '<rect x="3.2" y="7.4" width="13.4" height="13.4" rx="3"/><path d="M7.4 7.4V6.2a3 3 0 0 1 3-3h7.4a3 3 0 0 1 3 3v7.4a3 3 0 0 1-3 3h-1.2"/>',
};
const railIcon = (name) => `<svg viewBox="0 0 24 24">${RAIL_ICONS[name]}</svg>`;

// iPhone Duo folds Wi-Fi, signal and battery into one round glyph: Wi-Fi in the
// middle of a battery ring, the ring broken at the bottom by the signal dots.
const STATUS_GLYPH = `
  <svg class="duo-glyph" viewBox="0 0 32 32" aria-label="Wi-Fi, signal and battery">
    <path class="ring" d="M6.81 25.19A13 13 0 1 1 25.19 25.19"/>
    <circle cx="9.5" cy="27.26" r="1.35"/><circle cx="13.74" cy="28.8" r="1.35"/>
    <circle cx="18.26" cy="28.8" r="1.35"/><circle cx="22.5" cy="27.26" r="1.35"/>
    <path class="arc" d="M10.34 13.6A8 8 0 0 1 21.66 13.6"/>
    <path class="arc" d="M12.82 16.1A4.5 4.5 0 0 1 19.18 16.1"/>
    <circle cx="16" cy="19.2" r="1.4"/>
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
  if (S.showChrome && tabId != null && browser.id === 'safari') {
    // Safari's rail, from the launch event: back and bookmarks above, new tab
    // and tabs below, all plain round buttons; the address bar is horizontal
    toolbar = round('data-back', 'back', 'Back') + round('', 'book', 'Bookmarks');
    tabbar = round('data-new-tab', 'plus', 'New Tab') + round('data-tabs', 'tabs2', 'Tabs');
  } else if (S.showChrome && tabId != null) {
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
    <div class="duo-rail edge-${pane.edge}" data-tab="${tabId ?? ''}" style="
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

/** Safari's top capsule and the status capsule, for a pane with horizontal bars. */
function topBarMarkup(pane, tabId) {
  const T = DUO_RAIL.topbar;
  const icon = (attrs, name, title) => `<button class="gicon" ${attrs} title="${title}">${railIcon(name)}</button>`;
  const status = pane.status
    ? `<div class="duo-status-pill" style="width:${DUO_RAIL.statusPill}px"><span class="time" data-clock>9:41</span>${STATUS_GLYPH}</div>`
    : '';
  const bar = S.showChrome && tabId != null
    ? `<div class="duo-addr wide" data-tab="${tabId}">
        ${icon('data-back', 'back', 'Back')}${icon('', 'book', 'Bookmarks')}
        <button class="host field" data-search><span data-addr-host>Search or enter website</span>${railIcon('reload')}</button>
        ${icon('data-new-tab', 'plus', 'New Tab')}${icon('data-tabs', 'tabs2', 'Tabs')}
      </div>`
    : '<div class="duo-spring-h"></div>';
  return `
    <div class="duo-topbar" data-tab="${tabId ?? ''}" style="left:${pane.x + T.side}px; top:${pane.y + T.top}px;
      width:${pane.w - T.side * 2}px; height:${T.height}px">${bar}${status}</div>`;
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
  if (!g.duo && !g.crease && !g.camera) {
    if (duoKey) { below.innerHTML = ''; above.innerHTML = ''; duoKey = ''; }
    return;
  }

  const otherId = g.split ? otherTabId() : null;
  const key = JSON.stringify([g.w, g.h, g.panes, g.divider, g.camera, g.crease,
    S.showChrome, browser.id, activeTabId, otherId, tabs.length]);
  if (key === duoKey) return;
  duoKey = key;

  const px = (r) => (r ? r.map((v) => `${v}px`).join(' ') : '0');
  let under = '';
  let over = '';

  if (g.duo) {
    for (const pane of g.panes) {
      const tabId = pane.slot === 'page' ? activeTabId : otherId;
      under += `<div class="duo-pane" style="left:${pane.x}px; top:${pane.y}px;
        width:${pane.w}px; height:${pane.h}px; border-radius:${px(pane.radii)}"></div>`;
      // a stand-in app, with nothing of ours drawn over it
      if (pane.slot === 'other' && device.placeholderOther) {
        over += placeholderAppMarkup(pane) + cornerMasks(pane);
        continue;
      }
      // the prompt goes under the bars, which float over the whole pane
      if (pane.slot === 'other' && otherId == null) {
        over += `<div class="duo-empty" style="left:${pane.x + pane.left}px; top:${pane.y}px;
          width:${pane.viewW}px; height:${pane.h}px">
          <p>Open a second tab to see it here, side by side.</p>
          <button class="duo-empty-btn" data-new-tab-here>New Tab</button>
        </div>`;
      }
      over += pane.edge ? railMarkup(pane, tabId) : topBarMarkup(pane, tabId);
      if (pane.edge && S.showChrome && tabId != null && browser.id === 'safari') {
        const A = DUO_RAIL.addr;
        // beside the rail, not under it — it's what keeps it clear of the camera
        const clearL = pane.edge === 'left' ? DUO_RAIL.inset : 0;
        const clearR = pane.edge === 'right' ? DUO_RAIL.inset : 0;
        over += `<div class="duo-addr" data-tab="${tabId}" style="left:${pane.x + clearL + A.side}px;
          top:${pane.y + pane.h - A.bottom - A.height}px; width:${pane.w - clearL - clearR - A.side * 2}px; height:${A.height}px">
          <span class="gicon">${railIcon('lines')}</span>
          <button class="host" data-search data-addr-host>Search or enter website</button>
          <button class="gicon" data-reload title="Reload">${railIcon('reload')}</button>
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
  if (g.camera && !bezelFor(g.landscape)) {
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

/** Each pane's address pill names its own tab's site — in Split View, two different ones. */
function paintDuoHosts() {
  for (const el of all('.duo-addr')) {
    const tab = tabById(Number(el.dataset.tab));
    const host = el.querySelector('[data-addr-host]');
    if (host) host.textContent = hostnameOf(tab?.url || '') || 'Search or enter website';
  }
}

/* ================================================================= poses
   Beta. The device in three dimensions, the way Apple's "device poses" diagram
   shows it held or set down. Nothing about the page changes — it's emulated
   exactly as on the flat display underneath, which is genuinely what a site
   gets, since Safari has no fold-detection API.

   How it's drawn: the whole flat phone is still laid out as normal inside
   #liveHalf, which clips it to the half you're looking at and tilts it in
   perspective. The other half — #awayHalf — is a picture of that part of the
   page taken from the compositor, refreshed as the page changes, with copies of
   any browser bars that live down there laid over it. A tent shows the whole
   outer display and hangs the device's back off the top edge instead.

   The angles are chosen to match Apple's poses illustration and the Netflix
   and alarm-clock examples of the laptop and tent poses; Apple hasn't published
   anything about web content in any pose, hence the Beta label. */

/* CSS rotation signs, since they're easy to get backwards: rotateX(+θ) brings
   whatever is BELOW the axis toward you; rotateY(+θ) brings whatever is LEFT
   of the axis toward you. Each panel rotates about its hinge edge. How big the
   result is gets measured after it's drawn (poseBounds), not estimated here.
   `shadowAt` is where the device's lowest edge lands, as a share of H. */
const POSES = {
  // hinge vertical; the page on the right half, nearly flat; the left half
  // swings toward you, the way the demo of the fold animation holds it
  book:   { live: 'right', liveTilt: 'rotateY(-10deg)', awayTilt: 'rotateY(40deg)',
            perspective: 1500, shadowAt: 1 },
  // hinge horizontal; the page on the top half leaning back like a laptop
  // screen; the base lies flat toward you, seen from a little above
  laptop: { live: 'top',   liveTilt: 'rotateX(10deg)',  awayTilt: 'rotateX(62deg)',
            perspective: 2200, shadowAt: 0.77 },
  // an A-frame seen straight on: the outer display leans back from its base,
  // and the device's back drops away behind it, just peeking out one side
  tent:   { live: 'all',   liveTilt: 'rotateX(14deg)',  awayTilt: 'rotateX(-40deg) translateX(14px)',
            perspective: 1600, shadowAt: 0.985 },
};

// Skins that sit at the foot of the screen and so land on a laptop's base.
const FOOT_SKINS = ['uiSafariGlass', 'uiChromeIosBottom', 'uiVivaldi', 'uiChromeNav', 'homebar'];

let poseKey = '';
let poseSnapTimer = null;

/**
 * The posed device's real footprint, measured rather than estimated: the tilted
 * halves' on-screen boxes, in the phone's own unscaled coordinates. Transitions
 * are held off while measuring, so this is where the pose ends up and not a
 * frame of an animation passing through.
 */
function poseBounds() {
  if (!device.pose) return null;
  const before = { transform: phone.style.transform, left: phone.style.left, top: phone.style.top };
  phone.classList.add('measuring');
  Object.assign(phone.style, { transform: 'none', left: '0px', top: '0px' });
  const origin = phone.getBoundingClientRect();
  const boxes = ['liveHalf', 'awayHalf'].map($).filter((el) => !el.hidden).map((el) => el.getBoundingClientRect());
  // put the phone back as it looked before transitions resume, or the morph
  // would start from the unscaled measuring pose and visibly pop
  Object.assign(phone.style, before);
  void phone.offsetWidth;
  phone.classList.remove('measuring');
  const minX = Math.min(...boxes.map((b) => b.left)) - origin.left;
  const minY = Math.min(...boxes.map((b) => b.top)) - origin.top;
  const maxX = Math.max(...boxes.map((b) => b.right)) - origin.left;
  const maxY = Math.max(...boxes.map((b) => b.bottom)) - origin.top;
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Draw the pose — or, if there isn't one, put the wrappers back to being inert.
 * Only rebuilt when the geometry changes; the snapshot refreshes on its own.
 */
function renderPose(g) {
  const pose = device.pose ? POSES[device.pose] : null;
  const stage = $('pose');
  const live = $('liveHalf');
  const away = $('awayHalf');
  const glow = $('poseGlow');
  const shadow = $('poseShadow');
  const frame = phone.querySelector('.frame');

  if (!pose) {
    if (!poseKey) return;
    poseKey = '';
    phone.classList.remove('posed');
    phone.removeAttribute('data-pose');
    stage.removeAttribute('style');
    live.removeAttribute('style');
    frame.style.transform = '';
    away.hidden = true;
    away.innerHTML = '';
    glow.hidden = true;
    shadow.hidden = true;
    stopPoseSnapshots();
    renderPoseAction();
    return;
  }

  const key = JSON.stringify([device.displayId, g.w, g.h, S.showChrome, browser.id, activeTabId, Boolean(laptopControlsUrl)]);
  if (key === poseKey) return;
  poseKey = key;

  const bz = bezelMargins(g.landscape);
  const W = g.w + bz.l + bz.r;   // the frame, outside edge to outside edge
  const H = g.h + bz.t + bz.b;
  const bezel = bezelFor(g.landscape);
  const bezelImg = (left, top) => bezel
    ? `<img class="bezel" alt="" src="${bezel.src}" style="left:${left}px; top:${top}px; width:${W}px; height:${H}px">`
    : '';

  phone.classList.add('posed');
  phone.dataset.pose = device.pose;
  Object.assign(stage.style, { width: `${W}px`, height: `${H}px`, perspective: `${pose.perspective}px` });

  if (pose.live === 'right') {
    const hingeX = bz.l + g.w / 2;
    Object.assign(live.style, {
      left: `${hingeX}px`, top: '0', width: `${W - hingeX}px`, height: `${H}px`,
      transformOrigin: 'left center', transform: pose.liveTilt,
    });
    frame.style.transform = `translateX(${-hingeX}px)`;
    Object.assign(away.style, {
      left: '0', top: '0', width: `${hingeX}px`, height: `${H}px`,
      transformOrigin: 'right center', transform: pose.awayTilt,
    });
    const [tl, , , bl] = g.corners;
    away.innerHTML = (device.placeholderOther
      ? `<div class="pose-clip" style="left:${bz.l}px; top:${bz.t}px; width:${g.w / 2}px; height:${g.h}px;
          border-radius:${tl}px 0 0 ${bl}px"><div class="pose-screen blurred" style="left:0; top:0; width:${g.w}px; height:${g.h}px">
          ${placeholderAppMarkup(g.panes.find((p) => p.slot === 'other'))}</div><div class="pose-shade"></div></div>`
      : awayScreenMarkup(g, { left: bz.l, top: bz.t, width: g.w / 2, height: g.h, shiftX: 0, shiftY: 0, radii: [tl, 0, 0, bl], foot: false }))
      + bezelImg(0, 0);
  } else if (pose.live === 'top') {
    const hingeY = bz.t + g.h / 2;
    Object.assign(live.style, {
      left: '0', top: '0', width: `${W}px`, height: `${hingeY}px`,
      transformOrigin: 'center bottom', transform: pose.liveTilt,
    });
    frame.style.transform = '';
    Object.assign(away.style, {
      left: '0', top: `${hingeY}px`, width: `${W}px`, height: `${H - hingeY}px`,
      transformOrigin: 'center top', transform: pose.awayTilt,
    });
    const base = laptopControlsUrl
      ? `<div class="pose-clip" style="left:${bz.l}px; top:0; width:${g.w}px; height:${g.h / 2}px">
           <img class="pose-controls" alt="" src="${laptopControlsUrl}"></div>`
      : awayScreenMarkup(g, { left: bz.l, top: 0, width: g.w, height: g.h / 2, shiftX: 0, shiftY: -g.h / 2, radii: [0, 0, g.corners[2], g.corners[3]], foot: true });
    away.innerHTML = base + bezelImg(0, -hingeY);
  } else {
    // tent: the whole outer display, and the device's back hanging from the same hinge
    Object.assign(live.style, {
      left: '0', top: '0', width: `${W}px`, height: `${H}px`,
      transformOrigin: 'center top', transform: pose.liveTilt,
    });
    frame.style.transform = '';
    Object.assign(away.style, {
      left: '0', top: '0', width: `${W}px`, height: `${H}px`,
      transformOrigin: 'center top', transform: pose.awayTilt,
    });
    // the back image is upright with its hinge on the right; turned so the
    // hinge is along the top, it's the same size as the outer display's frame
    const bw = BEZEL_BACK.img[1] / BEZEL_BACK.scale;   // wide, once turned
    const bh = BEZEL_BACK.img[0] / BEZEL_BACK.scale;
    const iw = BEZEL_BACK.img[0] / BEZEL_BACK.scale;   // the image's own box before turning
    const ih = BEZEL_BACK.img[1] / BEZEL_BACK.scale;
    away.innerHTML = `<img class="pose-back-img" alt="" src="${BEZEL_BACK.src}"
      style="width:${iw}px; height:${ih}px; left:${(W - iw) / 2}px; top:${(H - ih) / 2}px">`;
  }
  away.hidden = false;

  glow.hidden = device.pose !== 'tent';
  shadow.hidden = false;
  Object.assign(shadow.style, { width: `${W * 1.1}px`, left: `${-W * 0.05}px`, top: `${H * pose.shadowAt - 14}px` });
  Object.assign(glow.style, { width: `${W * 1.5}px`, left: `${-W * 0.25}px`, top: `${H * 0.55}px`, height: `${H * 0.7}px` });
  renderPoseAction();

  if (pose.live === 'all' || device.placeholderOther || (pose.live === 'top' && laptopControlsUrl)) { stopPoseSnapshots(); return; }
  // the page is re-emulated to this display just after this runs, so the first
  // picture waits for that to land; a second catches a slow reflow
  startPoseSnapshots();
  setTimeout(refreshPoseSnapshot, 500);
  setTimeout(refreshPoseSnapshot, 1400);
}

/**
 * The away half's contents: a full-size copy of the screen, shifted so the right
 * part shows through the clip, holding the page picture at the page's position
 * and, on a laptop base, copies of the browser bars drawn at the foot.
 */
function awayScreenMarkup(g, { left, top, width, height, shiftX, shiftY, radii, foot }) {
  const page = g.page;
  // the screen's own corners where they're outer corners — a square picture
  // would poke out past the bezel's curve
  const r = radii.map((v) => `${v}px`).join(' ');
  let clones = '';
  for (const el of all('#duoAbove .duo-addr:not(.wide)')) {
    const copy = el.cloneNode(true);
    copy.classList.add('pose-copy');
    clones += copy.outerHTML;
  }
  if (foot) {
    for (const id of FOOT_SKINS) {
      const el = $(id);
      if (!el || (el.classList.contains('ui') && !el.classList.contains('on'))) continue;
      const copy = el.cloneNode(true);
      copy.removeAttribute('id');
      copy.classList.add('pose-copy');
      clones += copy.outerHTML;
    }
  }
  return `
    <div class="pose-clip" style="left:${left}px; top:${top}px; width:${width}px; height:${height}px; border-radius:${r}">
      <div class="pose-screen" style="left:${shiftX}px; top:${shiftY}px; width:${g.w}px; height:${g.h}px">
        <img class="pose-snap" alt="" style="left:${page.x + page.left}px; top:${page.y + page.top}px;
          width:${page.viewW}px; height:${page.viewH}px">
        ${clones}
      </div>
      <div class="pose-shade"></div>
    </div>`;
}

function startPoseSnapshots() {
  if (poseSnapTimer) return;
  // slow, because most of what changes on a page is a scroll or a load, and
  // both trigger a refresh of their own (see attachWebviewListeners)
  poseSnapTimer = setInterval(refreshPoseSnapshot, 2500);
}

function stopPoseSnapshots() {
  clearInterval(poseSnapTimer);
  poseSnapTimer = null;
}

let poseSnapBusy = false;
async function refreshPoseSnapshot() {
  const img = $('awayHalf').querySelector('.pose-snap');
  const el = activeWv();
  if (!img || !el || poseSnapBusy || document.hidden) return;
  let wcId;
  try { wcId = el.getWebContentsId(); } catch { return; }
  poseSnapBusy = true;
  try {
    // roughly the on-screen size: the picture is blurred, so no more is needed
    const url = await window.bridge.capturePage(wcId, Math.round(img.clientWidth * 1.5) || 900);
    if (url && img.isConnected) img.src = url;
  } finally {
    poseSnapBusy = false;
  }
}

/* ------------------------------------------------ laptop: simulated controls
   Netflix puts playback controls on the base while the picture plays above.
   A site can't do that — Safari gives it no way to know the phone is folded —
   but a designer can mock it: pick an image for the base and the page keeps the
   upper half. Stored by the main process; see controls:* in main.js. */
let laptopControlsUrl = null;

/**
 * Put the laptop pose's button just under the phone. Worked out from the sizes
 * layout() is settling on rather than measured, because the phone may still be
 * animating toward them. The stage centres the phone and the button's reserved
 * space together, so they sit as one group.
 */
function placePoseAction(scalerH, reserve) {
  const btn = $('poseAction');
  scaler.style.marginBottom = btn.hidden ? '' : `${reserve}px`;
  if (btn.hidden) return;
  const stagePadBottom = 24;   // #stage's padding-bottom
  const scalerTop = (stage.clientHeight - stagePadBottom - scalerH - reserve) / 2;
  btn.style.top = `${Math.round(scalerTop + scalerH + 14)}px`;
}

function renderPoseAction() {
  const btn = $('poseAction');
  const show = device?.pose === 'laptop';
  btn.hidden = !show;
  if (!show) return;
  btn.textContent = laptopControlsUrl ? 'Remove Simulated Controls' : 'Add Simulated Controls — like Netflix';
}

async function togglePoseControls() {
  if (laptopControlsUrl) {
    await window.bridge.clearControls();
    laptopControlsUrl = null;
  } else {
    const g = geometry();
    const pt = { w: g.w, h: Math.round(g.h / 2) };
    const url = await window.bridge.pickControls({ pt, px: { w: pt.w * 3, h: pt.h * 3 } });
    if (!url) return;
    laptopControlsUrl = url;
  }
  poseKey = '';
  animateSwitch();
  layout();
}

/* ------------------------------------------------------ placeholder app
   Stands in for "another app" beside the page — a quiet list-style app, drawn
   rather than an image so it follows light and dark with the rest. */
function placeholderAppMarkup(pane) {
  const rows = Array.from({ length: 9 }, (_, i) => `
    <div class="ph-row"><span class="ph-avatar"></span>
      <span class="ph-lines"><i style="width:${58 - (i * 7) % 24}%"></i><i style="width:${82 - (i * 11) % 30}%"></i></span></div>`).join('');
  const r = pane.radii ? pane.radii.map((v) => `${v}px`).join(' ') : '0';
  return `<div class="duo-placeholder" style="left:${pane.x}px; top:${pane.y}px; width:${pane.w}px; height:${pane.h}px; border-radius:${r}">
    <div class="ph-head"><span class="ph-round"></span><span class="ph-title"></span><span class="ph-round"></span></div>
    <div class="ph-search"></div>${rows}</div>`;
}

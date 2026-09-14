'use strict'

/* --------------------------------------------------------------- refs */
const $ = (id) => document.getElementById(id);
const all = (sel) => Array.from(document.querySelectorAll(sel));

const phone     = $('phone');
const scaler    = $('phoneScaler');
const stage     = $('stage');
const urlInput  = $('url');
const meta      = $('meta');
const webviews  = $('webviews');
const tabsEl    = $('tabs');

const STATUS_BARS = { ios: $('sbIos'), android: $('sbAndroid') };
const SKINS = {
  safariGlass:   $('uiSafariGlass'),
  safariTop:     $('uiSafariTop'),
  chromeIosTop:  $('uiChromeIosTop'),
  chromeIosBot:  $('uiChromeIosBottom'),
  vivaldi:       $('uiVivaldi'),
  chromeAndroid: $('uiChrome'),
  chromeNav:     $('uiChromeNav'),
};

const MAX_TABS = 4;

const ZOOMS = [
  { value: 'fit', label: 'Fit' },
  { value: 1, label: '100%' },
  { value: 0.85, label: '85%' },
  { value: 0.75, label: '75%' },
  { value: 0.5, label: '50%' },
];

// Devices that were three separate entries before iPhone Duo got a Display menu
const LEGACY_DUO = { 'iphone-duo-outer': 'outer', 'iphone-duo-inner': 'inner', 'iphone-duo-split': 'split-leading' };

let DEVICES = [];
let BROWSERS = [];
let UAS = [];
let S = {};
let APP_NAME = 'iPhone Browser';
let APP_VERSION = '';
let deviceEntry = null;   // the catalogue entry picked in the device menu
let device = null;        // that entry with its chosen display applied (see resolveDevice)
let browser = null;
let firstLayoutDone = false;

/* ------------------------------------------------------------------ tabs
   Each tab owns its own <webview>. All tabs share one simulated device —
   switching tabs only changes which page is shown, not the phone/browser
   being emulated (device, orientation, colour scheme, zoom stay global).
   Split View is the one time two are on screen at once (see duo.js).

   Capped at 4: each tab is a full out-of-process Chromium renderer with its
   own live CDP session driving continuous device emulation. That's real
   weight per tab, so the cap is what keeps every tab fast and stable rather
   than turning this into a general-purpose many-tab browser. */
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const tabById   = (id) => tabs.find((t) => t.id === id);
const tabOf     = (el) => tabs.find((t) => t.el === el);
const activeTab = () => tabById(activeTabId);
const activeWv  = () => activeTab()?.el || null;
const isPrimary = (id) => tabs[0]?.id === id;   // the one whose URL survives a relaunch

const deviceById  = (id) => DEVICES.find((d) => d.id === id) || DEVICES[0];
const uaById      = (id) => UAS.find((u) => u.id === id) || UAS[0];
const browsersFor = (platform) => BROWSERS.filter((b) => b.platform === platform);
const browserById = (id, platform) =>
  BROWSERS.find((b) => b.id === id && b.platform === platform) || browsersFor(platform)[0];

// what Settings has switched on
const isDeviceOn = (id) => !(S.disabledDevices || []).includes(id);
const isBrowserOn = (id) => !(S.disabledBrowsers || []).includes(id);
const enabledDevices = () => {
  const on = DEVICES.filter((d) => isDeviceOn(d.id));
  return on.length ? on : DEVICES;
};
const enabledBrowsersFor = (platform) => {
  const on = browsersFor(platform).filter((b) => isBrowserOn(b.id));
  return on.length ? on : browsersFor(platform);
};

/* ---------------------------------------------------------- webview api
   Electron keeps moving history APIs around; take whichever exists. Each
   takes the webview to act on — in Split View that isn't always the active one. */
const nav = {
  canBack:    (el) => safeCall(() => el.navigationHistory.canGoBack(), () => el.canGoBack(), false),
  canForward: (el) => safeCall(() => el.navigationHistory.canGoForward(), () => el.canGoForward(), false),
  back:       (el) => safeCall(() => el.navigationHistory.goBack(), () => el.goBack()),
  forward:    (el) => safeCall(() => el.navigationHistory.goForward(), () => el.goForward()),
};

function safeCall(primary, fallback, dflt) {
  try { return primary(); } catch { /* fall through */ }
  try { return fallback(); } catch { return dflt; }
}

/* --------------------------------------------------------------- boot */
(async function init() {
  const data = await window.bridge.getState();
  DEVICES = data.devices;
  BROWSERS = data.browsers;
  UAS = data.userAgents;
  S = data.state;
  APP_NAME = data.appName || APP_NAME;
  APP_VERSION = data.version || '';

  settleStartingState();
  document.body.classList.toggle('advanced', S.advanced);

  // Get the first tab going before any of the (synchronous but nonzero) DOM
  // setup below, so its guest is being created while the rest of this runs.
  // The real navigation waits on that guest being emulated first — see
  // createTab — which costs an about:blank round trip but is what makes touch
  // emulation true on the very first page. Not activated yet: activation needs
  // layout() to have run first, or the webview would briefly render at an
  // unstyled 0×0 size. A fresh install has no saved URL — leave it truly
  // blank and focus the address bar, same as opening a new tab.
  createTab(S.url || null, { activate: false, focus: !S.url });

  urlInput.value = S.url || '';
  $('chrome').classList.toggle('on', S.showChrome);
  paintSchemeButton();

  layout();
  activateTab(tabs[0].id);
  wireUI();
  wireSettings();
  tickClock();
  setInterval(tickClock, 10_000);
})();

/**
 * Decide what to open on, before anything is drawn: carry old saved state
 * forward, honour "Start with last simulator used", and never land on a device
 * or browser that Settings has switched off, or on a user agent the (hidden)
 * Profile menu couldn't show you.
 */
function settleStartingState() {
  const patch = {};

  if (LEGACY_DUO[S.deviceId]) {
    patch.displays = { ...S.displays, 'iphone-duo': LEGACY_DUO[S.deviceId] };
    patch.deviceId = 'iphone-duo';
  }
  if (!S.restoreLast) {
    patch.deviceId = S.startDeviceId;
    patch.orientation = 'portrait';
    patch.displays = {};
  }
  Object.assign(S, patch);

  deviceEntry = deviceById(S.deviceId);
  if (!isDeviceOn(deviceEntry.id)) deviceEntry = enabledDevices()[0];
  patch.deviceId = deviceEntry.id;

  browser = browserById(S.browserId, deviceEntry.platform);
  if (!S.restoreLast || !isBrowserOn(browser.id)) browser = enabledBrowsersFor(deviceEntry.platform)[0];
  patch.browserId = browser.id;
  if (!S.advanced || !S.restoreLast) patch.userAgentId = browser.userAgentId;

  S = { ...S, ...patch };
  window.bridge.setState(patch);
  device = resolveDevice(deviceEntry);
}

/* --------------------------------------------------------------- tabs */
function createTab(url, { activate = true, focus = false } = {}) {
  const el = document.createElement('webview');
  el.className = 'frameview';
  el.setAttribute('partition', 'persist:ios');
  el.setAttribute('allowpopups', '');
  el.setAttribute('useragent', uaById(S.userAgentId).value);
  // A <webview> only creates its guest once it has a src, and CDP touch
  // emulation only reaches documents created after it's switched on — so a tab
  // that navigates straight to a real page loads it before touch exists, and
  // `'ontouchstart' in window` comes back false on the one page you're there to
  // check. Park on about:blank to bring the guest into being, emulate that
  // throwaway document, and only then navigate for real.
  el.src = 'about:blank';
  webviews.appendChild(el);

  const tab = { id: nextTabId++, el, title: '', url: '' };
  tab.ready = new Promise((resolve) => {
    el.addEventListener('dom-ready', function first() {
      el.removeEventListener('dom-ready', first);
      reportPageRects();   // its webContents id only exists from here
      applyEmulationTo(el).then(resolve, resolve);
    });
  });
  tabs.push(tab);
  attachWebviewListeners(el, tab.id);
  renderTabs();

  if (activate) activateTab(tab.id);
  else if (firstLayoutDone) layout();   // Split View may want it in the other half
  if (url) tab.ready.then(() => go(url, tab.id));
  if (focus) { urlInput.focus(); urlInput.select(); }
  return tab;
}

function requestNewTab() {
  if (tabs.length >= MAX_TABS) {
    toast(`Limited to ${MAX_TABS} tabs — keeps every preview fast and stable.`);
    return;
  }
  createTab(null, { activate: true, focus: true });
}

function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  followSplitFocus(id);
  activeTabId = id;

  renderTabs();
  // an explicit tab switch always wins, even if the address bar happens to
  // still hold focus (e.g. right after opening a new tab) — showing the
  // previous tab's URL for the page now on screen would be a real bug.
  updateChromeForActiveTab({ forceUrlInput: true });
  layout();
  sampleTheme(tab.el);
}

function closeTab(id) {
  if (tabs.length <= 1) return;   // never close the last tab
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  const [closed] = tabs.splice(idx, 1);
  closed.el.remove();

  if (activeTabId === id) {
    const next = tabs[idx] || tabs[idx - 1] || tabs[0];
    activateTab(next.id);
  } else {
    renderTabs();
    layout();
  }
}

function renderTabs() {
  tabsEl.innerHTML = '';
  const onlyTab = tabs.length === 1;
  const otherId = otherTabId();

  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.id === activeTabId ? ' active' : '') + (onlyTab ? ' only-tab' : '')
      + (t.id === otherId ? ' beside' : '');
    btn.title = t.title || t.url || 'New Tab';
    btn.onclick = () => { if (t.id !== activeTabId) activateTab(t.id); };

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t.title || (t.url ? hostnameOf(t.url) : 'New Tab');
    btn.appendChild(label);

    const close = document.createElement('span');
    close.className = 'close';
    close.title = 'Close Tab';
    close.innerHTML = '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
    close.onclick = (e) => { e.stopPropagation(); closeTab(t.id); };
    btn.appendChild(close);

    tabsEl.appendChild(btn);
  }

  $('newTab').title = tabs.length >= MAX_TABS
    ? `Limited to ${MAX_TABS} tabs for speed and stability`
    : `New Tab (⌘T) — up to ${MAX_TABS} at a time`;

  renderTabCounts();
}

// the drawn browser skins (Chrome's tab-count pill) mirror the real count —
// these are illustrations of a real phone's UI, not a separate concept
function renderTabCounts() {
  for (const el of all('[data-tab-count]')) el.textContent = String(tabs.length);
}

/* ------------------------------------------------------------- layout
   geometry() describes the screen as one or more panes — rectangles a page is
   shown in, each with its own insets and safe area. Almost always one; Split
   View on a foldable is two. Devices with ordinary top and bottom bars go
   through barGeometry(), foldable displays with a vertical rail through
   duoPanes() in duo.js. */
function geometry() {
  // a pose fixes the orientation: the hinge is what makes it a book or a laptop
  const landscape = device.orientation
    ? device.orientation === 'landscape'
    : S.orientation === 'landscape';
  const w = landscape ? device.height : device.width;
  const h = landscape ? device.width : device.height;

  const shared = {
    landscape,
    w,
    h,
    corners: screenCorners(landscape),
    hinge: hingeEdge(landscape),
    crease: device.pose ? null : creaseOf(w, h, landscape),
    camera: null,
  };

  const g = usesRail(landscape)
    ? {
        ...shared,
        rail: true,
        split: Boolean(device.split),
        camera: cameraSpot(w, h, landscape),
        statusH: 0,
        top: 0, bottom: 0, left: 0, right: 0, floating: 0,
        frontW: 0, frontH: 0, frontTop: 0,
        ...duoPanes(w, h, landscape),
      }
    : barGeometry(shared);

  const page = g.panes.find((p) => p.slot === 'page');
  return { ...g, page, viewW: page.viewW, viewH: page.viewH, safeArea: page.safeArea };
}

/** A screen with the browser's bars across the top and bottom — every phone. */
function barGeometry(shared) {
  const { landscape, w, h } = shared;
  const bars = browser.chrome[landscape ? 'landscape' : 'portrait'];

  // iOS hides the status bar in landscape; Android keeps it
  const statusH = (landscape && device.platform === 'ios') ? 0 : device.statusBar;

  const top = S.showChrome ? statusH + bars.top : 0;
  const bottom = S.showChrome ? bars.bottom : 0;
  const side = S.showChrome ? (bars.side || 0) : 0;
  // a floating bar hovers over the page instead of reserving space
  const floating = S.showChrome ? (bars.floating || 0) : 0;

  // env(safe-area-inset-*) as the page will see it. With the browser UI drawn
  // its bars already cover the unsafe regions, so the page gets zero — same as
  // the real browser. Without it the page owns the whole screen and has to
  // respect the camera cutout and the home indicator.
  const safeArea = S.showChrome
    ? { top: 0, right: 0, bottom: floating, left: 0 }
    : landscape
      ? { ...device.landscapeSafeArea }
      : { top: device.statusBar, right: 0, bottom: device.homeIndicator, left: 0 };

  const front = device.front;
  return {
    ...shared,
    rail: false,
    split: false,
    statusH, top, bottom, left: side, right: side, floating,
    // ?? not ||: an under-display camera is a real 0, and `0 || undefined`
    // would emit "undefinedpx" and quietly void every calc() that uses it
    frontW: landscape ? front.h ?? front.d ?? 0 : front.w ?? front.d ?? 0,
    frontH: landscape ? front.w ?? front.d ?? 0 : front.h ?? front.d ?? 0,
    frontTop: front.top,
    divider: null,
    panes: [{
      slot: 'page', x: 0, y: 0, w, h, radii: null,
      top, bottom, left: side, right: side,
      viewW: w - side * 2,
      viewH: h - top - bottom,
      safeArea,
    }],
  };
}

function layout() {
  const g = geometry();
  const s = phone.style;

  phone.classList.toggle('landscape', g.landscape);
  phone.classList.toggle('android', device.platform === 'android');
  phone.classList.toggle('pixel', device.buttons === 'pixel');
  phone.classList.toggle('no-buttons', device.buttons === 'none');
  phone.classList.toggle('no-front', device.front.type === 'none');
  phone.classList.toggle('rail', g.rail);
  phone.classList.toggle('split', g.split);
  phone.classList.toggle('hinge-left', g.hinge === 'left');
  phone.classList.toggle('hinge-top', g.hinge === 'top');

  s.setProperty('--w', `${g.w}px`);
  s.setProperty('--h', `${g.h}px`);
  s.setProperty('--bezel', `${device.bezel}px`);
  ['tl', 'tr', 'br', 'bl'].forEach((corner, i) => s.setProperty(`--r-${corner}`, `${g.corners[i]}px`));
  s.setProperty('--status-h', `${g.statusH}px`);
  s.setProperty('--front-w', `${g.frontW}px`);
  s.setProperty('--front-h', `${g.frontH}px`);
  s.setProperty('--front-top', `${g.frontTop}px`);
  s.setProperty('--top-inset', `${g.top}px`);
  s.setProperty('--bottom-inset', `${g.bottom}px`);
  s.setProperty('--left-inset', `${g.left}px`);
  s.setProperty('--right-inset', `${g.right}px`);
  s.setProperty('--floating', `${g.floating}px`);

  // one status bar per platform — a rail carries its own, so they stand down
  for (const [platform, el] of Object.entries(STATUS_BARS)) {
    el.classList.toggle('on', platform === device.platform && g.statusH > 0);
    el.classList.toggle('tinted', S.showChrome);
    el.classList.toggle('neutral', S.showChrome && browser.statusTint === 'neutral');
  }

  // one browser skin per browser + orientation
  const active = activeSkins(g);
  for (const el of Object.values(SKINS)) el.classList.toggle('on', active.includes(el));

  // the home indicator sits on whatever is drawn behind it: the page-tinted
  // Safari bar, or Vivaldi's / Chrome's neutral chrome
  phone.classList.toggle('neutral-home',
    active.includes(SKINS.vivaldi) ||
    active.includes(SKINS.chromeNav) ||
    active.includes(SKINS.chromeIosBot));

  placeWebviews(g);
  renderDuo(g);
  renderPose(g);

  // fit-to-window or a fixed percentage; a posed device projects bigger than
  // its flat footprint, so it's fitted to what it will actually take up
  const extent = poseExtent(g);
  const bodyW = g.w + device.bezel * 2;
  const bodyH = g.h + device.bezel * 2;
  const fitW = extent ? extent.w : bodyW;
  const fitH = extent ? extent.h : bodyH;
  const scale = S.zoom === 'fit'
    ? Math.max(0.2, Math.min(1,
        (stage.clientWidth - 40) / fitW,
        (stage.clientHeight - 48) / fitH))
    : Number(S.zoom);

  phone.style.transform = `scale(${scale})`;
  scaler.style.width = `${Math.round(fitW * scale)}px`;
  scaler.style.height = `${Math.round(fitH * scale)}px`;
  // centre the flat frame inside the (larger) posed footprint
  phone.style.left = `${Math.round((fitW - bodyW) / 2 * scale)}px`;
  phone.style.top = `${Math.round((fitH - bodyH) / 2 * scale)}px`;

  paintChrome();
  paintMenus();

  meta.hidden = !S.showMeta;
  // only name the user agent when it's been overridden away from the browser's
  const uaNote = S.userAgentId === browser.userAgentId
    ? '' : ` · UA ${uaById(S.userAgentId).name}`;
  meta.textContent =
    `${g.viewW} × ${g.viewH} css px · screen ${g.w} × ${g.h} · @${device.dpr}x · ` +
    `${Math.round(scale * 100)}% · ${browser.name}${uaNote}`;

  // CSS custom properties above are what turn the raw HTML into an actual
  // phone; before this first runs, #phoneScaler stays invisible so nothing
  // unstyled ever flashes on screen (see shell.css).
  if (!firstLayoutDone) {
    firstLayoutDone = true;
    scaler.classList.add('ready');
  }

  applyEmulation();
  reportPageRects();
}

/**
 * Tell the main process where the pages are on screen, so touch emulation is on
 * only while the pointer is over one (see syncTouchToPointer in main.js). Nothing
 * counts as a page while Settings or a menu is drawn over it.
 */
function reportPageRects() {
  const covered = !$('settings').hidden || Boolean(openPopover);
  const rects = covered ? [] : tabs
    .filter((t) => t.el.classList.contains('shown'))
    .map((t) => {
      let wcId;
      try { wcId = t.el.getWebContentsId(); } catch { return null; }   // guest not created yet
      let r = t.el.getBoundingClientRect();
      if (device.pose) {
        // the half turned away is clipped out — only the live half is a page
        const l = $('liveHalf').getBoundingClientRect();
        const x1 = Math.max(r.left, l.left); const y1 = Math.max(r.top, l.top);
        const x2 = Math.min(r.right, l.right); const y2 = Math.min(r.bottom, l.bottom);
        r = { left: x1, top: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
      }
      return { wcId, x: r.left, y: r.top, width: r.width, height: r.height };
    })
    .filter(Boolean);
  window.bridge.reportPageRects(rects);
}

/**
 * Put each on-screen tab's webview into its pane: the active tab in the "page"
 * pane, and in Split View the other open tab beside it. Everything else hides.
 */
function placeWebviews(g) {
  const otherId = g.split ? otherTabId() : null;
  for (const t of tabs) {
    const pane = t.id === activeTabId
      ? g.panes.find((p) => p.slot === 'page')
      : (t.id === otherId ? g.panes.find((p) => p.slot === 'other') : null);

    t.el.classList.toggle('active', t.id === activeTabId);
    t.el.classList.toggle('shown', Boolean(pane));
    if (!pane) continue;

    Object.assign(t.el.style, {
      left: `${pane.x + pane.left}px`,
      top: `${pane.y + pane.top}px`,
      width: `${pane.viewW}px`,
      height: `${pane.viewH}px`,
      borderRadius: contentRadii(pane),
    });
  }
}

/** A Split View pane's rounded corners, minus the ones its rail covers. */
function contentRadii(pane) {
  if (!pane.radii) return '';
  const r = [...pane.radii];
  if (pane.left) { r[0] = 0; r[3] = 0; }
  if (pane.right) { r[1] = 0; r[2] = 0; }
  return r.map((v) => `${v}px`).join(' ');
}

function activeSkins({ landscape, rail }) {
  // a foldable's rail stands in for every browser's bars (drawn in duo.js)
  if (!S.showChrome || rail) return [];
  switch (browser.id) {
    case 'chrome-android': return [SKINS.chromeAndroid, SKINS.chromeNav];
    case 'chrome-ios':     return [SKINS.chromeIosTop, SKINS.chromeIosBot];
    case 'safari':         return [SKINS.safariGlass];
    // Vivaldi's stacked bars don't fit in landscape; fall back to a top bar
    case 'vivaldi':        return landscape ? [SKINS.safariTop] : [SKINS.vivaldi];
    default:               return [];
  }
}

/* ---------------------------------------------------------- emulation
   Emulation calls are serialised per webview: two settings changed in quick
   succession must not land out of order, or the older payload wins. Every
   open tab is kept emulated to the current device/browser/orientation, not
   just the visible one, so switching back to a background tab never shows a
   stale viewport. Each tab gets the size of the pane it's in — the same for
   every tab, except in Split View. */
const emulationChains = new WeakMap();

function currentEmulationPayload(el) {
  const g = geometry();
  const pane = paneForTab(tabOf(el)?.id ?? activeTabId, g);
  const ua = uaById(S.userAgentId);
  return {
    viewWidth: pane.viewW,
    viewHeight: pane.viewH,
    screenWidth: g.w,
    screenHeight: g.h,
    dpr: device.dpr,
    userAgent: ua.value,
    platform: ua.platform,
    colorScheme: S.colorScheme,
    landscape: g.landscape,
    safeArea: pane.safeArea,
  };
}

function applyEmulationTo(el) {
  let wcId;
  try { wcId = el.getWebContentsId(); } catch { return Promise.resolve(); } // guest not created yet

  const payload = currentEmulationPayload(el);

  const prior = emulationChains.get(el) || Promise.resolve();
  const chain = prior
    .then(() => window.bridge.emulate(wcId, payload))
    .catch((err) => console.warn('emulate failed', err));
  emulationChains.set(el, chain);
  return chain;
}

function applyEmulation() {
  return Promise.all(tabs.map((t) => applyEmulationTo(t.el)));
}

/* ---------------------------------------------------------- animation
   A deliberate change — another device, orientation, browser or zoom step —
   morphs instead of snapping. Dragging the window with zoom on "fit" doesn't:
   that calls layout() directly, and a transition there would lag the drag.

   The page can't be morphed with the frame. Animating a <webview>'s size means
   reflowing the guest on every frame, which is exactly the sort of thing that
   stutters on a heavy page — so it dips out, is resized while nobody can see
   it, and comes back under the tail of the frame's animation. */
const MORPH_MS = 280;
let morphTimer = null;
let pageTimer = null;

function animateSwitch() {
  if (!firstLayoutDone) return;   // the first layout has nothing to morph from
  phone.classList.add('morphing');
  scaler.classList.add('morphing');
  webviews.classList.add('dipped');

  clearTimeout(pageTimer);
  clearTimeout(morphTimer);
  pageTimer = setTimeout(() => webviews.classList.remove('dipped'), 120);
  morphTimer = setTimeout(() => {
    phone.classList.remove('morphing');
    scaler.classList.remove('morphing');
    reportPageRects();   // mid-morph rects were in-between sizes
  }, MORPH_MS + 40);
}

/* ----------------------------------------------------------- settings */
function set(patch, { relayout = true } = {}) {
  S = { ...S, ...patch };
  window.bridge.setState(patch);
  // a foldable's display, the orientation or Settings may all have changed it
  if (deviceEntry) device = resolveDevice(deviceEntry);
  if (relayout) { animateSwitch(); layout(); }
}

/**
 * Persist a patch and push its user agent onto every open tab's webview.
 * Returns true when the user agent actually changed — the caller reloads,
 * because a live document keeps whatever navigator.userAgent it was loaded
 * with. Background tabs pick up the new UA next time they load.
 */
function applyUa(patch) {
  const before = S.userAgentId;
  set(patch, { relayout: false });
  const value = uaById(S.userAgentId).value;
  for (const t of tabs) t.el.setAttribute('useragent', value);
  return S.userAgentId !== before;
}

/** Reload every page on screen — one normally, two in Split View. */
function reloadShown() {
  for (const t of tabs) if (t.el.classList.contains('shown')) t.el.reload();
}

/* -------------------------------------------------------------- menus */
function deviceMenuSections() {
  // Android above iPhone, newest first in each: the oldest iPhone sits nearest
  // the button, which is where the menu opens from
  const on = enabledDevices();
  return ['android', 'ios'].map((platform) => ({
    label: PLATFORM_LABELS[platform],
    items: on.filter((d) => d.platform === platform).map((d) => ({ value: d.id, label: d.name })),
  }));
}

function bindMenus() {
  bindMenu($('deviceMenu'), () => ({
    sections: deviceMenuSections(),
    value: deviceEntry.id,
    onPick: pickDevice,
  }));

  bindMenu($('displayMenu'), () => {
    const landscape = S.orientation === 'landscape';
    const item = (d) => ({ value: d.id, label: displayLabel(d, landscape) });
    const plain = deviceEntry.displays.filter((d) => !d.pose);
    const poses = deviceEntry.displays.filter((d) => d.pose);
    return {
      // Outer is the plainest, so it sits nearest the button; poses, being the
      // most involved, go furthest from it
      sections: [
        { label: 'Poses · Beta', items: [...poses].reverse().map(item) },
        { label: deviceEntry.name, items: [...plain].reverse().map(item) },
      ],
      value: device.displayId,
      onPick: pickDisplay,
    };
  });

  bindMenu($('browserMenu'), () => ({
    // oldest browser nearest the button
    sections: [{
      items: [...enabledBrowsersFor(deviceEntry.platform)]
        .sort((a, b) => (b.since || 0) - (a.since || 0))
        .map((b) => ({ value: b.id, label: b.name })),
    }],
    value: browser.id,
    onPick: pickBrowser,
  }));

  bindMenu($('uaMenu'), () => ({
    sections: [{
      label: 'Profile',
      items: [...UAS].reverse().map((u) => ({
        value: u.id,
        label: u.name,
        hint: u.id === browser.userAgentId ? browser.name : '',
      })),
    }],
    value: S.userAgentId,
    onPick: pickUa,
  }));

  bindMenu($('zoomMenu'), () => ({
    sections: [{ items: [...ZOOMS].reverse() }],
    value: S.zoom,
    onPick: pickZoom,
  }));
}

function paintMenus() {
  const label = (id, text) => { $(id).querySelector('.label').textContent = text; };
  label('deviceMenu', deviceEntry.name);
  const display = displayOf(deviceEntry);
  $('displayMenu').hidden = !display;
  if (display) label('displayMenu', displayLabel(display, S.orientation === 'landscape'));
  label('browserMenu', browser.name);
  $('rotate').disabled = Boolean(device.orientation);
  $('rotate').title = device.orientation ? 'This pose has a fixed orientation' : 'Rotate (⌘⌃R)';
  label('uaMenu', uaById(S.userAgentId).name);
  label('zoomMenu', (ZOOMS.find((z) => z.value === S.zoom) || ZOOMS[0]).label);
}

function pickDevice(id) {
  const next = deviceById(id);
  const patch = { deviceId: next.id };

  // switching platform pulls the browser UI and user agent along with it
  if (next.platform !== deviceEntry.platform) {
    const nextBrowser = enabledBrowsersFor(next.platform)[0];
    patch.browserId = nextBrowser.id;
    patch.userAgentId = nextBrowser.userAgentId;
    browser = nextBrowser;
  }
  deviceEntry = next;
  const changedUa = applyUa(patch);
  animateSwitch();
  layout();
  if (changedUa) reloadShown();
}

function pickDisplay(id) {
  set({ displays: { ...S.displays, [deviceEntry.id]: id } });
}

function pickBrowser(id) {
  browser = browserById(id, deviceEntry.platform);
  const changedUa = applyUa({ browserId: browser.id, userAgentId: browser.userAgentId });
  animateSwitch();
  layout();
  if (changedUa) reloadShown();
}

function pickUa(id) {
  applyUa({ userAgentId: id });
  layout();
  reloadShown();
}

function pickZoom(value) {
  set({ zoom: value });
}

/* --------------------------------------------------------- navigation */
function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function normalizeUrl(raw) {
  const input = raw.trim();
  if (!input) return null;
  if (/^(https?|file|about|data):/i.test(input)) return input;
  if (/^\d{2,5}$/.test(input)) return `http://localhost:${input}`;

  const local = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/|$)/i
    .test(input) || /^[\w-]+\.local(host)?(:\d+)?(\/|$)/i.test(input);
  if (local) return `http://${input}`;

  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i.test(input)) return `https://${input}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}

function go(raw, tabId = activeTabId) {
  const url = normalizeUrl(raw ?? urlInput.value);
  if (!url) return;
  const tab = tabById(tabId);
  if (!tab) return;

  tab.url = url;
  tab.el.src = url;
  tab.title = hostnameOf(url);

  if (tab.id === activeTabId) {
    urlInput.value = url;
    updateChromeForActiveTab();
  }
  if (isPrimary(tab.id)) set({ url }, { relayout: false });
  renderTabs();
}

/* ----------------------------------------------------------- ui wiring */
function wireUI() {
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { go(); urlInput.blur(); }
    if (e.key === 'Escape') { urlInput.value = activeTab()?.url || ''; urlInput.blur(); }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  $('back').onclick = () => activeWv() && nav.back(activeWv());
  $('forward').onclick = () => activeWv() && nav.forward(activeWv());
  $('reload').onclick = () => activeWv()?.reload();

  // The drawn browser UIs get working controls too. Delegated, because iPhone
  // Duo's rails are redrawn whenever the layout changes; a rail acts on the tab
  // in its own pane, which in Split View isn't always the active one.
  phone.addEventListener('click', (e) => {
    const control = e.target.closest('button');
    if (!control || !phone.contains(control)) return;
    const railTab = tabById(Number(control.closest('[data-tab]')?.dataset.tab));
    const el = (railTab || activeTab())?.el;

    if (control.hasAttribute('data-new-tab-here')) return openTabInOtherHalf();
    if (control.hasAttribute('data-new-tab')) return requestNewTab();
    if (!el) return;
    if (control.hasAttribute('data-back')) nav.back(el);
    else if (control.hasAttribute('data-forward')) nav.forward(el);
    else if (control.hasAttribute('data-reload')) el.reload();
    else if (control.hasAttribute('data-search')) {
      if (railTab && railTab.id !== activeTabId) activateTab(railTab.id);
      urlInput.focus();
      urlInput.select();
    }
  });

  $('newTab').onclick = requestNewTab;
  bindMenus();

  $('rotate').onclick = rotate;
  $('chrome').onclick = toggleChrome;
  $('scheme').onclick = cycleScheme;
  $('shot').onclick = (e) => screenshot({ fullPage: e.altKey });   // ⌥-click = full page
  $('devtools').onclick = () => {
    const el = activeWv();
    if (el) window.bridge.toggleDevTools(el.getWebContentsId());
  };

  window.addEventListener('resize', () => { if (S.zoom === 'fit') layout(); else reportPageRects(); });

  window.bridge.onMenu((action, payload) => {
    switch (action) {
      case 'reload': activeWv()?.reload(); break;
      case 'hard-reload': activeWv()?.reloadIgnoringCache(); break;
      case 'back': if (activeWv()) nav.back(activeWv()); break;
      case 'forward': if (activeWv()) nav.forward(activeWv()); break;
      case 'focus-url': urlInput.focus(); break;
      case 'devtools': {
        const el = activeWv();
        if (el) window.bridge.toggleDevTools(el.getWebContentsId());
        break;
      }
      case 'rotate': rotate(); break;
      case 'toggle-chrome': toggleChrome(); break;
      case 'toggle-meta': set({ showMeta: !S.showMeta }); break;
      case 'screenshot': screenshot(payload || {}); break;
      case 'zoom': pickZoom(payload); break;
      case 'device': if (payload !== deviceEntry.id) pickDevice(payload); break;
      case 'reapply-emulation': applyEmulation(); break;
      case 'new-tab': requestNewTab(); break;
      case 'close-tab': if (activeTabId != null) closeTab(activeTabId); break;
      case 'settings': openSettings(); break;
    }
  });
}

function rotate() {
  if (device.orientation) { toast('This pose has a fixed orientation — pick another display to rotate.'); return; }
  set({ orientation: S.orientation === 'portrait' ? 'landscape' : 'portrait' });
}

function toggleChrome() {
  set({ showChrome: !S.showChrome });
  $('chrome').classList.toggle('on', S.showChrome);
}

function cycleScheme() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(S.colorScheme) + 1) % order.length];
  set({ colorScheme: next });
  paintSchemeButton();
}

function paintSchemeButton() {
  const btn = $('scheme');
  btn.classList.toggle('on', S.colorScheme !== 'system');
  btn.title = `Color scheme: ${S.colorScheme}`;
}

/* ------------------------------------------------------------ webview */
function attachWebviewListeners(el, tabId) {
  el.addEventListener('dom-ready', () => {
    applyEmulationTo(el);
    if (tabId === activeTabId) sampleTheme(el);
  });

  // Clicking into the other half of Split View makes it the tab you're working in
  el.addEventListener('focus', () => {
    if (tabId !== activeTabId && el.classList.contains('shown')) activateTab(tabId);
  });

  el.addEventListener('did-start-loading', () => {
    if (tabId === activeTabId) $('spinner').hidden = false;
  });

  el.addEventListener('did-stop-loading', () => {
    syncNav();
    if (tabId !== activeTabId) return;
    $('spinner').hidden = true;
    sampleTheme(el);
    if (device.pose) setTimeout(refreshPoseSnapshot, 150);
  });

  // A page can't call the shell, but it can log — so a throttled scroll
  // listener logs a marker, and the picture of the turned-away half follows.
  el.addEventListener('dom-ready', () => {
    el.executeJavaScript(`(() => {
      if (window.__ibScrollHooked) return; window.__ibScrollHooked = true;
      let t = 0;
      addEventListener('scroll', () => { const n = Date.now(); if (n - t > 400) { t = n; console.log('__ib_scrolled'); } }, { passive: true, capture: true });
    })()`).catch(() => {});
  });
  el.addEventListener('console-message', (e) => {
    if (e.message === '__ib_scrolled' && device.pose && tabId === activeTabId) refreshPoseSnapshot();
  });

  const onNav = () => {
    const tab = tabById(tabId);
    if (!tab) return;
    let url = '';
    try { url = el.getURL(); } catch { /* guest not ready */ }
    // about:blank is the parking page every tab starts on, not somewhere the
    // user went — it must never reach the address bar or the saved session
    if (url === 'about:blank') return;
    tab.url = url || tab.url;
    if (!tab.title) tab.title = hostnameOf(tab.url);   // usable label before the real title arrives
    if (tabId === activeTabId) updateChromeForActiveTab();
    else syncNav();
    if (isPrimary(tabId)) set({ url: tab.url }, { relayout: false });
    renderTabs();
  };
  el.addEventListener('did-navigate', onNav);
  el.addEventListener('did-navigate-in-page', onNav);

  el.addEventListener('page-title-updated', (e) => {
    const tab = tabById(tabId);
    if (!tab) return;
    tab.title = e.title || hostnameOf(tab.url) || 'New Tab';
    renderTabs();
    if (tabId === activeTabId) {
      document.title = e.title ? `${e.title} — ${APP_NAME}` : APP_NAME;
    }
  });

  el.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return; // aborted
    if (tabId === activeTabId) toast(`Couldn't load — ${e.errorDescription || e.errorCode}`);
  });
}

/**
 * Refresh everything in the app chrome that mirrors the active tab. The
 * address bar is protected from same-tab navigation events while the user is
 * mid-typing there — unless forceUrlInput says this call IS the tab switch,
 * in which case the field must update no matter what has focus.
 */
function updateChromeForActiveTab({ forceUrlInput = false } = {}) {
  const tab = activeTab();
  const url = tab?.url || '';

  if (forceUrlInput || document.activeElement !== urlInput) {
    urlInput.value = (url && url !== 'about:blank') ? url : '';
  }
  $('lock').hidden = !/^https:/.test(url);

  const host = hostnameOf(url);
  for (const el of all('[data-host]')) el.textContent = host;
  for (const el of all('[data-host-or-placeholder]')) el.textContent = host || 'Search Google or type URL';
  for (const el of all('[data-host-or-search]')) el.textContent = host || 'Search or enter website';

  syncNav();
}

/** Enable back/forward for the tab each set of controls acts on. */
function syncNav() {
  const el = activeWv();
  const b = Boolean(el && nav.canBack(el));
  const f = Boolean(el && nav.canForward(el));
  $('back').disabled = !b;
  $('forward').disabled = !f;

  for (const control of all('#phone [data-back], #phone [data-forward]')) {
    const railTab = tabById(Number(control.closest('[data-tab]')?.dataset.tab));
    const target = (railTab || activeTab())?.el;
    const can = control.hasAttribute('data-back') ? nav.canBack : nav.canForward;
    control.disabled = !(target && can(target));
  }
}

/* -------------------------------------------------- status bar tinting
   iOS tints its bars from the page. Sample theme-color / background and flip
   the status bar and browser bars to match, like the real thing. */
async function sampleTheme(el) {
  if (!el) return;
  let sampled = null;
  try {
    sampled = await el.executeJavaScript(`(() => {
      const m = document.querySelector('meta[name="theme-color"]');
      const cs = (node) => node ? getComputedStyle(node).backgroundColor : '';
      return {
        theme: m && m.content,
        body: cs(document.body),
        html: cs(document.documentElement),
      };
    })()`, true);
  } catch { /* page gone or cross-origin restriction */ }

  const rgb = firstOpaque([sampled?.theme, sampled?.body, sampled?.html]) || [255, 255, 255];
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  const light = luminance > 0.55;

  phone.style.setProperty('--bar-fg', light ? '#000' : '#fff');
  phone.style.setProperty('--bar-bg', `rgba(${rgb.join(',')}, .82)`);
  phone.style.setProperty('--bar-solid', `rgb(${rgb.join(',')})`);
}

/**
 * Safari tints its bars from the page, but Vivaldi's and Chrome's chrome
 * follows the OS theme instead — so those get their own neutral palette,
 * driven by the emulated colour scheme rather than the page.
 */
function paintChrome() {
  const dark = S.colorScheme === 'dark' ? true
    : S.colorScheme === 'light' ? false
      : matchMedia('(prefers-color-scheme: dark)').matches;

  phone.style.setProperty('--ui-neutral', dark ? '#2a2a2d' : '#ececee');
  phone.style.setProperty('--ui-fg', dark ? '#f2f2f5' : '#1c1c1e');
  phone.style.setProperty('--ui-field',
    dark ? 'rgba(120,120,128,.34)' : 'rgba(118,118,128,.20)');
}

function firstOpaque(candidates) {
  for (const c of candidates) {
    const rgb = parseColor(c);
    if (rgb) return rgb;
  }
  return null;
}

function parseColor(value) {
  if (!value) return null;
  const v = String(value).trim();

  const rgba = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 4 && parts[3] === 0) return null;   // transparent
    if (parts.slice(0, 3).some(Number.isNaN)) return null;
    return parts.slice(0, 3);
  }

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }

  const named = { white: [255, 255, 255], black: [0, 0, 0] };
  return named[v.toLowerCase()] || null;
}

/* ---------------------------------------------------------- utilities */
function tickClock() {
  const now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('clockIos').textContent = now;
  $('clockAndroid').textContent = now;
  for (const el of all('[data-clock]')) el.textContent = now;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function canvasToBase64(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

// Page.captureScreenshot returns a tiled, corrupted image at dpr=3 on this
// Chromium build — confirmed directly by capturing the same page at dpr 1, 2
// and 3: only 3 breaks. Every device this app emulates uses dpr:3, so every
// screenshot temporarily downshifts to this safe value and the captured
// pixels are scaled back up to the device's real resolution, restoring live
// emulation (and the real dpr) once the capture is done.
const SAFE_CAPTURE_DPR = 2;

/**
 * Capture a tab as a PNG at the device's real resolution, working around the
 * dpr=3 capture bug above. For a full-page shot, scrolls in increments and
 * stitches the results — a <webview>'s guest paints into a surface tied to its
 * own on-screen DOM size, so asking CDP for a taller capture than that
 * (captureBeyondViewport, or a taller declared height with an explicit clip)
 * just tiles whatever's already painted; only ever asking for what's actually
 * on screen avoids that entirely. (Known limitation: position:fixed/sticky
 * elements appear once per tile, same as any scroll-and-stitch screenshot tool.)
 *
 * Returns a base64 PNG (no data-URL prefix), or null on failure.
 */
async function captureScreenshotPixels(el, { fullPage }) {
  const realDpr = device.dpr;
  const captureDpr = Math.min(realDpr, SAFE_CAPTURE_DPR);
  const scaleUp = realDpr / captureDpr;
  const pane = paneForTab(tabOf(el)?.id, geometry());
  const targetWidth = Math.round(pane.viewW * realDpr);

  if (captureDpr !== realDpr) {
    await window.bridge.emulate(el.getWebContentsId(),
      { ...currentEmulationPayload(el), dpr: captureDpr });
    await new Promise((r) => setTimeout(r, 60));   // let the resize actually land
  }

  try {
    if (!fullPage) {
      const tile = await window.bridge.captureTile(el.getWebContentsId());
      if (!tile) return null;
      if (scaleUp === 1) return tile;
      const img = await loadImage(`data:image/png;base64,${tile}`).catch(() => null);
      if (!img) return null;
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = Math.round(pane.viewH * realDpr);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvasToBase64(canvas);
    }

    let scrollHeightCss;
    try {
      scrollHeightCss = await el.executeJavaScript(
        'Math.ceil(document.documentElement.scrollHeight)');
    } catch {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(scrollHeightCss * realDpr));
    const ctx = canvas.getContext('2d');

    let lastY = -1;
    for (let target = 0; ; target += pane.viewH) {
      let y;
      try {
        await el.executeJavaScript(`window.scrollTo(0, ${target})`);
        await new Promise((r) => setTimeout(r, 80));   // let the scroll actually repaint
        y = await el.executeJavaScript('window.scrollY');
      } catch {
        return null;
      }
      if (y === lastY) break;   // clamped at the bottom — no further progress
      lastY = y;

      const tile = await window.bridge.captureTile(el.getWebContentsId());
      if (!tile) return null;
      const img = await loadImage(`data:image/png;base64,${tile}`).catch(() => null);
      if (!img) return null;
      ctx.drawImage(img, 0, Math.round(y * realDpr), img.width * scaleUp, img.height * scaleUp);
    }

    try { await el.executeJavaScript('window.scrollTo(0, 0)'); } catch { /* best effort */ }
    return canvasToBase64(canvas);
  } finally {
    if (captureDpr !== realDpr) await applyEmulationTo(el);   // restore the real dpr
  }
}

async function screenshot({ fullPage = false } = {}) {
  const el = activeWv();
  if (!el) return;

  const pngBase64 = await captureScreenshotPixels(el, { fullPage });
  if (!pngBase64) {
    toast(fullPage ? 'Full-page capture failed — try a regular screenshot instead' : 'Screenshot failed');
    return;
  }

  const res = await window.bridge.screenshot(el.getWebContentsId(), {
    url: el.getURL(),
    device: device.name,
    fullPage,
    stitchedPngBase64: pngBase64,
  });
  if (!res?.ok) {
    if (!res?.canceled) toast('Screenshot failed');   // a cancelled save panel isn't a failure
    return;
  }
  toast(`Saved ${res.width} × ${res.height}${fullPage ? ' full page' : ''}`,
    'Show in Finder', () => window.bridge.reveal(res.path));
}

let toastTimer = null;
function toast(message, actionLabel, onAction) {
  const el = $('toast');
  el.textContent = message;
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.onclick = () => { onAction(); el.hidden = true; };
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

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
  sideRail:      $('uiSideRail'),
};

const MAX_TABS = 4;

/** Which edge a Split View pane's fold ends up on once the device is turned. */
const FOLD_TURNED = { right: 'bottom', bottom: 'left', left: 'top', top: 'right' };

let DEVICES = [];
let BROWSERS = [];
let UAS = [];
let S = {};
let APP_NAME = 'iPhone Browser';
let device = null;
let browser = null;
let firstLayoutDone = false;

/* ------------------------------------------------------------------ tabs
   Each tab owns its own <webview>. All tabs share one simulated device —
   switching tabs only changes which page is shown, not the phone/browser
   being emulated (device, orientation, colour scheme, zoom stay global).

   Capped at 4: each tab is a full out-of-process Chromium renderer with its
   own live CDP session driving continuous device emulation. That's real
   weight per tab, so the cap is what keeps every tab fast and stable rather
   than turning this into a general-purpose many-tab browser. */
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

const tabById   = (id) => tabs.find((t) => t.id === id);
const activeTab = () => tabById(activeTabId);
const activeWv  = () => activeTab()?.el || null;
const isPrimary = (id) => tabs[0]?.id === id;   // the one whose URL survives a relaunch

const deviceById  = (id) => DEVICES.find((d) => d.id === id) || DEVICES[0];
const uaById      = (id) => UAS.find((u) => u.id === id) || UAS[0];
const browsersFor = (platform) => BROWSERS.filter((b) => b.platform === platform);
const browserById = (id, platform) =>
  BROWSERS.find((b) => b.id === id && b.platform === platform) || browsersFor(platform)[0];

/* ---------------------------------------------------------- webview api
   Electron keeps moving history APIs around; take whichever exists. Both
   resolve against whichever tab is active. */
const nav = {
  canBack:    () => safeCall(() => activeWv().navigationHistory.canGoBack(), () => activeWv().canGoBack(), false),
  canForward: () => safeCall(() => activeWv().navigationHistory.canGoForward(), () => activeWv().canGoForward(), false),
  back:       () => safeCall(() => activeWv().navigationHistory.goBack(), () => activeWv().goBack()),
  forward:    () => safeCall(() => activeWv().navigationHistory.goForward(), () => activeWv().goForward()),
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

  device = deviceById(S.deviceId);
  browser = browserById(S.browserId, device.platform);

  // Get the first tab going before any of the (synchronous but nonzero) DOM
  // setup below, so its guest is being created while the rest of this runs.
  // The real navigation waits on that guest being emulated first — see
  // createTab — which costs an about:blank round trip but is what makes touch
  // emulation true on the very first page. Not activated yet: activation needs
  // layout() to have run first, or the webview would briefly render at an
  // unstyled 0×0 size. A fresh install has no saved URL — leave it truly
  // blank and focus the address bar, same as opening a new tab.
  createTab(S.url || null, { activate: false, focus: !S.url });

  $('device').innerHTML = DEVICES
    .map((d) => `<option value="${d.id}">${d.name}</option>`).join('');
  $('ua').innerHTML = UAS
    .map((u) => `<option value="${u.id}">${u.name}</option>`).join('');

  $('device').value = device.id;
  $('zoom').value = String(S.zoom);
  urlInput.value = S.url || '';
  $('chrome').classList.toggle('on', S.showChrome);
  paintSchemeButton();
  rebuildBrowserSelect();

  layout();
  activateTab(tabs[0].id);
  wireUI();
  tickClock();
  setInterval(tickClock, 10_000);
})();

function rebuildBrowserSelect() {
  $('browser').innerHTML = browsersFor(device.platform)
    .map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  $('browser').value = browser.id;
  $('ua').value = uaById(S.userAgentId).id;
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
      applyEmulationTo(el).then(resolve, resolve);
    });
  });
  tabs.push(tab);
  attachWebviewListeners(el, tab.id);
  renderTabs();

  if (activate) activateTab(tab.id);
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
  activeTabId = id;

  for (const t of tabs) t.el.classList.toggle('active', t.id === id);
  renderTabs();
  // an explicit tab switch always wins, even if the address bar happens to
  // still hold focus (e.g. right after opening a new tab) — showing the
  // previous tab's URL for the page now on screen would be a real bug.
  updateChromeForActiveTab({ forceUrlInput: true });
  applyEmulationTo(tab.el);
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
  }
}

function renderTabs() {
  tabsEl.innerHTML = '';
  const onlyTab = tabs.length === 1;

  for (const t of tabs) {
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.id === activeTabId ? ' active' : '') + (onlyTab ? ' only-tab' : '');
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

  // the drawn browser skins (Chrome's tab-count pill) mirror the real count —
  // these are illustrations of a real phone's UI, not a separate concept
  for (const el of all('[data-tab-count]')) el.textContent = String(tabs.length);
}

/* ------------------------------------------------------------- layout */
function geometry() {
  const landscape = S.orientation === 'landscape';
  const w = landscape ? device.height : device.width;
  const h = landscape ? device.width : device.height;

  // iPhone Duo runs the status bar, the Dynamic Island and the browser's
  // toolbars down one long edge rather than across the top — always on the
  // outer display, and in landscape on the inner one. They share a single
  // strip, so the browser's controls cover the status bar instead of stacking
  // below it the way they do on a normal iPhone. The strip stays on the same
  // edge when the device is rotated.
  const sideBars = device.sideControls === 'always'
    || (device.sideControls === 'landscape' && landscape);
  // trailing edge, and it stays there in right-to-left languages because it's
  // aligned to the camera rather than to the reading direction
  const edge = device.controlEdge || 'right';

  const bars = browser.chrome[landscape ? 'landscape' : 'portrait'];

  // iOS hides the status bar in landscape; Android keeps it
  const statusH = (sideBars || (landscape && device.platform === 'ios'))
    ? 0 : device.statusBar;
  const statusW = sideBars ? device.statusBar : 0;

  // everything collapses onto one strip, so its thickness is the browser's own
  // bar thickness — not the sum of the bars it replaces
  const strip = browser.chrome.vertical
    || Math.max(bars.top, bars.bottom, bars.floating || 0);

  const top = S.showChrome && !sideBars ? statusH + bars.top : 0;
  const bottom = S.showChrome && !sideBars ? bars.bottom : 0;
  const flank = S.showChrome ? (sideBars ? strip : (bars.side || 0)) : 0;
  const left = sideBars ? (edge === 'left' ? flank : 0) : flank;
  const right = sideBars ? (edge === 'right' ? flank : 0) : flank;

  // a floating bar hovers over the page instead of reserving space
  const floating = S.showChrome && !sideBars ? (bars.floating || 0) : 0;

  // the strip as drawn. The browser's controls sit on the status bar rather
  // than beside it, so one tint has to span the pair — otherwise the wider of
  // the two leaves a sliver of bare screen down the edge.
  const stripW = sideBars ? Math.max(statusW, flank) : 0;

  // env(safe-area-inset-*) as the page will see it. With the browser UI drawn
  // its bars already cover the unsafe regions, so the page gets zero — same as
  // the real browser. Without it the page owns the whole screen and has to
  // respect the camera cutout and the home indicator.
  const safeArea = S.showChrome
    ? { top: 0, right: 0, bottom: floating, left: 0 }
    : sideBars
      // asymmetric by design: the control strip is on one edge only, which is
      // the whole reason to test a layout against this device
      ? {
          top: 0,
          right: edge === 'right' ? statusW : 0,
          bottom: device.homeIndicator,
          left: edge === 'left' ? statusW : 0,
        }
      : landscape
        ? { ...device.landscapeSafeArea }
        : { top: device.statusBar, right: 0, bottom: device.homeIndicator, left: 0 };

  // A Split View pane's fold turns with the device: stand it on its side and
  // the edge that met the other app moves from the side to the bottom.
  const foldEdge = device.foldEdge
    ? (landscape ? FOLD_TURNED[device.foldEdge] : device.foldEdge)
    : null;

  const front = device.front;
  // the island lies along whichever axis the controls run on
  const turned = sideBars || landscape;
  return {
    landscape, sideBars, edge, foldEdge, w, h, statusH, statusW, stripW,
    top, bottom, left, right, floating, safeArea,
    viewW: w - left - right,
    viewH: h - top - bottom,
    // ?? not ||: an under-display camera is a real 0, and `0 || undefined`
    // would emit "undefinedpx" and quietly void every calc() that uses it
    frontW: turned ? front.h ?? front.d ?? 0 : front.w ?? front.d ?? 0,
    frontH: turned ? front.w ?? front.d ?? 0 : front.h ?? front.d ?? 0,
    frontTop: front.top,
  };
}

function layout() {
  const g = geometry();
  const s = phone.style;

  phone.classList.toggle('landscape', g.landscape);
  phone.classList.toggle('android', device.platform === 'android');
  phone.classList.toggle('pixel', device.buttons === 'pixel');
  phone.classList.toggle('side-controls', g.sideBars);
  phone.classList.toggle('edge-right', g.sideBars && g.edge === 'right');
  phone.classList.toggle('no-front', device.front.type === 'none');
  phone.classList.toggle('pane', device.buttons === 'none');
  for (const e of ['top', 'right', 'bottom', 'left']) {
    phone.classList.toggle(`fold-${e}`, g.foldEdge === e);
  }
  // Rotate the outer display and the strip gets short, while the island and the
  // status indicators keep every point they had. The controls are what give
  // way — which is what iOS does too, overflowing toolbar items rather than
  // shrinking them. 304 is the two control groups at their natural height.
  phone.classList.toggle('rail-tight',
    g.sideBars && g.h - (g.frontH + 72) - 100 < 304);

  s.setProperty('--w', `${g.w}px`);
  s.setProperty('--h', `${g.h}px`);
  s.setProperty('--bezel', `${device.bezel}px`);
  s.setProperty('--radius', `${device.screenRadius}px`);
  s.setProperty('--status-h', `${g.statusH}px`);
  s.setProperty('--status-w', `${g.statusW}px`);
  s.setProperty('--strip-w', `${g.stripW}px`);
  s.setProperty('--front-w', `${g.frontW}px`);
  s.setProperty('--front-h', `${g.frontH}px`);
  s.setProperty('--front-top', `${g.frontTop}px`);
  s.setProperty('--top-inset', `${g.top}px`);
  s.setProperty('--bottom-inset', `${g.bottom}px`);
  s.setProperty('--left-inset', `${g.left}px`);
  s.setProperty('--right-inset', `${g.right}px`);
  s.setProperty('--floating', `${g.floating}px`);

  // one status bar per platform
  for (const [platform, el] of Object.entries(STATUS_BARS)) {
    el.classList.toggle('on',
      platform === device.platform && (g.statusH > 0 || g.statusW > 0));
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

  // fit-to-window or a fixed percentage
  const { w: bodyW, h: bodyH } = bodySize(g);
  const scale = S.zoom === 'fit'
    ? Math.max(0.2, Math.min(1,
        (stage.clientWidth - 40) / bodyW,
        (stage.clientHeight - 48) / bodyH))
    : Number(S.zoom);

  phone.style.transform = `scale(${scale})`;
  scaler.style.width = `${Math.round(bodyW * scale)}px`;
  scaler.style.height = `${Math.round(bodyH * scale)}px`;

  paintChrome();

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
}

function activeSkins({ landscape, sideBars }) {
  if (!S.showChrome) return [];
  // on iPhone Duo every bar collapses onto the one vertical strip, so the rail
  // stands in for whichever browser is selected rather than each skin growing a
  // vertical variant of its own
  if (sideBars) return [SKINS.sideRail];
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
   stale viewport. */
const emulationChains = new WeakMap();

function currentEmulationPayload() {
  const g = geometry();
  const ua = uaById(S.userAgentId);
  return {
    viewWidth: g.viewW,
    viewHeight: g.viewH,
    screenWidth: g.w,
    screenHeight: g.h,
    dpr: device.dpr,
    userAgent: ua.value,
    platform: ua.platform,
    colorScheme: S.colorScheme,
    landscape: g.landscape,
    safeArea: g.safeArea,
  };
}

function applyEmulationTo(el) {
  let wcId;
  try { wcId = el.getWebContentsId(); } catch { return Promise.resolve(); } // guest not created yet

  const payload = currentEmulationPayload();

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
  }, MORPH_MS + 40);
}

/* ----------------------------------------------------------- settings */
function set(patch, { relayout = true } = {}) {
  S = { ...S, ...patch };
  window.bridge.setState(patch);
  if (relayout) { animateSwitch(); layout(); }
}

/**
 * Persist a patch and push its user agent onto every open tab's webview.
 * Returns true when the user agent actually changed — the caller reloads the
 * active tab, because a live document keeps whatever navigator.userAgent it
 * was loaded with. Background tabs pick up the new UA next time they load.
 */
function applyUa(patch) {
  const before = S.userAgentId;
  set(patch, { relayout: false });
  const value = uaById(S.userAgentId).value;
  for (const t of tabs) t.el.setAttribute('useragent', value);
  return S.userAgentId !== before;
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

  $('back').onclick = () => nav.back();
  $('forward').onclick = () => nav.forward();
  $('reload').onclick = () => activeWv()?.reload();

  // the drawn browser UIs get working back / forward / reload too
  for (const el of all('[data-back]')) el.onclick = () => nav.back();
  for (const el of all('[data-forward]')) el.onclick = () => nav.forward();
  for (const el of all('[data-reload]')) el.onclick = () => activeWv()?.reload();
  for (const el of all('[data-new-tab]')) el.onclick = requestNewTab;

  $('newTab').onclick = requestNewTab;

  $('device').onchange = (e) => {
    const next = deviceById(e.target.value);
    const patch = { deviceId: next.id };

    // switching platform pulls the browser UI and user agent along with it
    if (next.platform !== device.platform) {
      const nextBrowser = browsersFor(next.platform)[0];
      patch.browserId = nextBrowser.id;
      patch.userAgentId = nextBrowser.userAgentId;
      browser = nextBrowser;
    }
    device = next;
    const changedUa = applyUa(patch);
    rebuildBrowserSelect();
    animateSwitch();
    layout();
    fitWindow();
    if (changedUa) activeWv()?.reload();
  };

  $('browser').onchange = (e) => {
    browser = browserById(e.target.value, device.platform);
    const changedUa = applyUa({
      browserId: browser.id,
      userAgentId: browser.userAgentId,
    });
    $('ua').value = S.userAgentId;
    animateSwitch();
    layout();
    if (changedUa) activeWv()?.reload();
  };

  $('ua').onchange = (e) => {
    applyUa({ userAgentId: e.target.value });
    layout();
    activeWv()?.reload();
  };

  $('zoom').onchange = (e) => {
    const v = e.target.value;
    set({ zoom: v === 'fit' ? 'fit' : Number(v) });
  };

  $('rotate').onclick = rotate;
  $('chrome').onclick = toggleChrome;
  $('scheme').onclick = cycleScheme;
  $('shot').onclick = (e) => screenshot({ fullPage: e.altKey });   // ⌥-click = full page
  $('devtools').onclick = () => {
    const el = activeWv();
    if (el) window.bridge.toggleDevTools(el.getWebContentsId());
  };

  window.addEventListener('resize', () => { if (S.zoom === 'fit') layout(); });

  window.bridge.onMenu((action, payload) => {
    switch (action) {
      case 'reload': activeWv()?.reload(); break;
      case 'hard-reload': activeWv()?.reloadIgnoringCache(); break;
      case 'back': nav.back(); break;
      case 'forward': nav.forward(); break;
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
      case 'zoom': $('zoom').value = String(payload); set({ zoom: payload }); break;
      case 'device':
        $('device').value = payload;
        $('device').dispatchEvent(new Event('change'));
        break;
      case 'reapply-emulation': applyEmulation(); break;
      case 'new-tab': requestNewTab(); break;
      case 'close-tab': if (activeTabId != null) closeTab(activeTabId); break;
    }
  });
}

function rotate() {
  set({ orientation: S.orientation === 'portrait' ? 'landscape' : 'portrait' });
  fitWindow();
}

/**
 * The phone's outside dimensions. A Split View pane has no bezel where it meets
 * the other app, so it isn't simply the screen plus two bezels.
 */
function bodySize(g) {
  const foldX = g.foldEdge === 'left' || g.foldEdge === 'right';
  const foldY = g.foldEdge === 'top' || g.foldEdge === 'bottom';
  return {
    w: g.w + device.bezel * (foldX ? 1 : 2),
    h: g.h + device.bezel * (foldY ? 1 : 2),
  };
}

/** Ask the window to grow/shrink around the phone (clamped to the screen). */
function fitWindow() {
  if (S.zoom !== 'fit') return;
  const body = bodySize(geometry());
  const chromeH = $('toolbar').offsetHeight + $('tabbar').offsetHeight + $('devicebar').offsetHeight;
  window.bridge.fitWindow(body.w + 40, body.h + 48 + chromeH);
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

  el.addEventListener('did-start-loading', () => {
    if (tabId === activeTabId) $('spinner').hidden = false;
  });

  el.addEventListener('did-stop-loading', () => {
    if (tabId !== activeTabId) return;
    $('spinner').hidden = true;
    syncNav();
    sampleTheme(el);
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

function syncNav() {
  const b = nav.canBack();
  const f = nav.canForward();
  $('back').disabled = !b;
  $('forward').disabled = !f;
  for (const el of all('[data-back]')) el.disabled = !b;
  for (const el of all('[data-forward]')) el.disabled = !f;
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
 * Capture the active tab as a PNG at the device's real resolution, working
 * around the dpr=3 capture bug above. For a full-page shot, scrolls in
 * increments and stitches the results — a <webview>'s guest paints into a
 * surface tied to its own on-screen DOM size, so asking CDP for a taller
 * capture than that (captureBeyondViewport, or a taller declared height with
 * an explicit clip) just tiles whatever's already painted; only ever asking
 * for what's actually on screen avoids that entirely. (Known limitation:
 * position:fixed/sticky elements appear once per tile, same as any
 * scroll-and-stitch screenshot tool.)
 *
 * Returns a base64 PNG (no data-URL prefix), or null on failure.
 */
async function captureScreenshotPixels(el, { fullPage }) {
  const realDpr = device.dpr;
  const captureDpr = Math.min(realDpr, SAFE_CAPTURE_DPR);
  const scaleUp = realDpr / captureDpr;
  const g = geometry();
  const targetWidth = Math.round(g.viewW * realDpr);

  if (captureDpr !== realDpr) {
    await window.bridge.emulate(el.getWebContentsId(),
      { ...currentEmulationPayload(), dpr: captureDpr });
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
      canvas.height = Math.round(g.viewH * realDpr);
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
    for (let target = 0; ; target += g.viewH) {
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

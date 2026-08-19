'use strict'

/* --------------------------------------------------------------- refs */
const $ = (id) => document.getElementById(id);
const all = (sel) => Array.from(document.querySelectorAll(sel));

const wv       = $('frameview');
const phone    = $('phone');
const scaler   = $('phoneScaler');
const stage    = $('stage');
const urlInput = $('url');
const meta     = $('meta');

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

let DEVICES = [];
let BROWSERS = [];
let UAS = [];
let S = {};
let device = null;
let browser = null;
let booted = false;

const deviceById  = (id) => DEVICES.find((d) => d.id === id) || DEVICES[0];
const uaById      = (id) => UAS.find((u) => u.id === id) || UAS[0];
const browsersFor = (platform) => BROWSERS.filter((b) => b.platform === platform);
const browserById = (id, platform) =>
  BROWSERS.find((b) => b.id === id && b.platform === platform) || browsersFor(platform)[0];

/* ---------------------------------------------------------- webview api
   Electron keeps moving history APIs around; take whichever exists. */
const nav = {
  canBack:    () => safeCall(() => wv.navigationHistory.canGoBack(), () => wv.canGoBack(), false),
  canForward: () => safeCall(() => wv.navigationHistory.canGoForward(), () => wv.canGoForward(), false),
  back:       () => safeCall(() => wv.navigationHistory.goBack(), () => wv.goBack()),
  forward:    () => safeCall(() => wv.navigationHistory.goForward(), () => wv.goForward()),
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

  device = deviceById(S.deviceId);
  browser = browserById(S.browserId, device.platform);

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

  wv.setAttribute('useragent', uaById(S.userAgentId).value);

  layout();
  wireUI();
  tickClock();
  setInterval(tickClock, 10_000);

  // Kick off the first navigation ourselves. A <webview> with no src never
  // creates its guest, so waiting for dom-ready to start would wait forever.
  go(S.url || 'about:blank');
})();

function rebuildBrowserSelect() {
  $('browser').innerHTML = browsersFor(device.platform)
    .map((b) => `<option value="${b.id}">${b.name}</option>`).join('');
  $('browser').value = browser.id;
  $('ua').value = uaById(S.userAgentId).id;
}

/* ------------------------------------------------------------- layout */
function geometry() {
  const landscape = S.orientation === 'landscape';
  const w = landscape ? device.height : device.width;
  const h = landscape ? device.width : device.height;

  // iOS hides the status bar in landscape; Android keeps it
  const statusH = (landscape && device.platform === 'ios') ? 0 : device.statusBar;

  const bars = browser.chrome[landscape ? 'landscape' : 'portrait'];
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
    landscape, w, h, statusH, top, bottom, side, floating, safeArea,
    viewW: w - side * 2,
    viewH: h - top - bottom,
    frontW: landscape ? front.h || front.d : front.w || front.d,
    frontH: landscape ? front.w || front.d : front.h || front.d,
    frontTop: front.top,
  };
}

function layout() {
  const g = geometry();
  const s = phone.style;

  phone.classList.toggle('landscape', g.landscape);
  phone.classList.toggle('android', device.platform === 'android');
  phone.classList.toggle('pixel', device.buttons === 'pixel');

  s.setProperty('--w', `${g.w}px`);
  s.setProperty('--h', `${g.h}px`);
  s.setProperty('--bezel', `${device.bezel}px`);
  s.setProperty('--radius', `${device.screenRadius}px`);
  s.setProperty('--status-h', `${g.statusH}px`);
  s.setProperty('--front-w', `${g.frontW}px`);
  s.setProperty('--front-h', `${g.frontH}px`);
  s.setProperty('--front-top', `${g.frontTop}px`);
  s.setProperty('--top-inset', `${g.top}px`);
  s.setProperty('--bottom-inset', `${g.bottom}px`);
  s.setProperty('--side-inset', `${g.side}px`);
  s.setProperty('--floating', `${g.floating}px`);

  // one status bar per platform
  for (const [platform, el] of Object.entries(STATUS_BARS)) {
    el.classList.toggle('on', platform === device.platform && g.statusH > 0);
    el.classList.toggle('tinted', S.showChrome);
    el.classList.toggle('neutral', S.showChrome && browser.statusTint === 'neutral');
  }

  // one browser skin per browser + orientation
  const active = activeSkins(g.landscape);
  for (const el of Object.values(SKINS)) el.classList.toggle('on', active.includes(el));

  // the home indicator sits on whatever is drawn behind it: the page-tinted
  // Safari bar, or Vivaldi's / Chrome's neutral chrome
  phone.classList.toggle('neutral-home',
    active.includes(SKINS.vivaldi) ||
    active.includes(SKINS.chromeNav) ||
    active.includes(SKINS.chromeIosBot));

  // fit-to-window or a fixed percentage
  const bodyW = g.w + device.bezel * 2;
  const bodyH = g.h + device.bezel * 2;
  const scale = S.zoom === 'fit'
    ? Math.max(0.2, Math.min(1,
        (stage.clientWidth - 40) / bodyW,
        (stage.clientHeight - 48) / bodyH))
    : Number(S.zoom);

  phone.style.transform = `scale(${scale})`;
  scaler.style.width = `${Math.round(bodyW * scale)}px`;
  scaler.style.height = `${Math.round(bodyH * scale)}px`;

  paintChrome();

  // only name the user agent when it's been overridden away from the browser's
  const uaNote = S.userAgentId === browser.userAgentId
    ? '' : ` · UA ${uaById(S.userAgentId).name}`;
  meta.textContent =
    `${g.viewW} × ${g.viewH} css px · screen ${g.w} × ${g.h} · @${device.dpr}x · ` +
    `${Math.round(scale * 100)}% · ${browser.name}${uaNote}`;

  applyEmulation();
}

function activeSkins(landscape) {
  if (!S.showChrome) return [];
  switch (browser.id) {
    case 'chrome-android': return [SKINS.chromeAndroid, SKINS.chromeNav];
    case 'chrome-ios':     return [SKINS.chromeIosTop, SKINS.chromeIosBot];
    case 'safari':         return [SKINS.safariGlass];
    // Vivaldi's stacked bars don't fit in landscape; fall back to a top bar
    case 'vivaldi':        return landscape ? [SKINS.safariTop] : [SKINS.vivaldi];
    default:               return [];
  }
}

// Emulation calls are serialised: two settings changed in quick succession
// must not land out of order, or the older payload wins.
let emulationChain = Promise.resolve();

function applyEmulation() {
  if (!booted) return emulationChain;
  const g = geometry();
  const ua = uaById(S.userAgentId);
  const payload = {
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

  emulationChain = emulationChain
    .then(() => window.bridge.emulate(wv.getWebContentsId(), payload))
    .catch((err) => console.warn('emulate failed', err));
  return emulationChain;
}

/* ----------------------------------------------------------- settings */
function set(patch, { relayout = true } = {}) {
  S = { ...S, ...patch };
  window.bridge.setState(patch);
  if (relayout) layout();
}

/**
 * Persist a patch and push its user agent onto the webview. Returns true when
 * the user agent actually changed — the caller reloads, because a live
 * document keeps whatever navigator.userAgent it was loaded with.
 */
function applyUa(patch) {
  const before = S.userAgentId;
  set(patch, { relayout: false });
  wv.setAttribute('useragent', uaById(S.userAgentId).value);
  return S.userAgentId !== before;
}

/* --------------------------------------------------------- navigation */
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

function go(raw) {
  const url = normalizeUrl(raw ?? urlInput.value);
  if (!url) return;
  urlInput.value = url;
  wv.src = url;
  set({ url }, { relayout: false });
}

/* ----------------------------------------------------------- ui wiring */
function wireUI() {
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { go(); urlInput.blur(); }
    if (e.key === 'Escape') { urlInput.value = wv.getURL(); urlInput.blur(); }
  });
  urlInput.addEventListener('focus', () => urlInput.select());

  $('back').onclick = () => nav.back();
  $('forward').onclick = () => nav.forward();
  $('reload').onclick = () => wv.reload();

  // the drawn browser UIs get working back / forward / reload too
  for (const el of all('[data-back]')) el.onclick = () => nav.back();
  for (const el of all('[data-forward]')) el.onclick = () => nav.forward();
  for (const el of all('[data-reload]')) el.onclick = () => wv.reload();

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
    layout();
    fitWindow();
    if (changedUa) wv.reload();
  };

  $('browser').onchange = (e) => {
    browser = browserById(e.target.value, device.platform);
    const changedUa = applyUa({
      browserId: browser.id,
      userAgentId: browser.userAgentId,
    });
    $('ua').value = S.userAgentId;
    layout();
    if (changedUa) wv.reload();
  };

  $('ua').onchange = (e) => {
    set({ userAgentId: e.target.value }, { relayout: false });
    wv.setAttribute('useragent', uaById(S.userAgentId).value);
    layout();
    wv.reload();
  };

  $('zoom').onchange = (e) => {
    const v = e.target.value;
    set({ zoom: v === 'fit' ? 'fit' : Number(v) });
  };

  $('rotate').onclick = rotate;
  $('chrome').onclick = toggleChrome;
  $('scheme').onclick = cycleScheme;
  $('shot').onclick = (e) => screenshot({ fullPage: e.altKey });   // ⌥-click = full page
  $('devtools').onclick = () => window.bridge.toggleDevTools(wv.getWebContentsId());

  window.addEventListener('resize', () => { if (S.zoom === 'fit') layout(); });

  window.bridge.onMenu((action, payload) => {
    switch (action) {
      case 'reload': wv.reload(); break;
      case 'hard-reload': wv.reloadIgnoringCache(); break;
      case 'back': nav.back(); break;
      case 'forward': nav.forward(); break;
      case 'focus-url': urlInput.focus(); break;
      case 'devtools': window.bridge.toggleDevTools(wv.getWebContentsId()); break;
      case 'rotate': rotate(); break;
      case 'toggle-chrome': toggleChrome(); break;
      case 'screenshot': screenshot(payload || {}); break;
      case 'zoom': $('zoom').value = String(payload); set({ zoom: payload }); break;
      case 'device':
        $('device').value = payload;
        $('device').dispatchEvent(new Event('change'));
        break;
      case 'reapply-emulation': applyEmulation(); break;
    }
  });

  wireWebview();
}

function rotate() {
  set({ orientation: S.orientation === 'portrait' ? 'landscape' : 'portrait' });
  fitWindow();
}

/** Ask the window to grow/shrink around the phone (clamped to the screen). */
function fitWindow() {
  if (S.zoom !== 'fit') return;
  const g = geometry();
  const chromeH = $('toolbar').offsetHeight + $('devicebar').offsetHeight;
  window.bridge.fitWindow(
    g.w + device.bezel * 2 + 40,
    g.h + device.bezel * 2 + 48 + chromeH,
  );
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
function wireWebview() {
  wv.addEventListener('dom-ready', () => {
    booted = true;
    applyEmulation();
    sampleTheme();
  });

  wv.addEventListener('did-start-loading', () => $('spinner').hidden = false);
  wv.addEventListener('did-stop-loading', () => {
    $('spinner').hidden = true;
    syncNav();
    sampleTheme();
  });

  const onNav = () => {
    const url = wv.getURL();
    if (url && url !== 'about:blank' && document.activeElement !== urlInput) {
      urlInput.value = url;
    }
    $('lock').hidden = !/^https:/.test(url);

    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* about:blank */ }
    for (const el of all('[data-host]')) el.textContent = host;
    for (const el of all('[data-host-or-placeholder]')) {
      el.textContent = host || 'Search Google or type URL';
    }
    for (const el of all('[data-host-or-search]')) {
      el.textContent = host || 'Search or enter website';
    }

    syncNav();
    set({ url }, { relayout: false });
  };
  wv.addEventListener('did-navigate', onNav);
  wv.addEventListener('did-navigate-in-page', onNav);

  wv.addEventListener('page-title-updated', (e) => {
    document.title = e.title ? `${e.title} — iPhone Browser` : 'iPhone Browser';
  });

  wv.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3 || !e.isMainFrame) return; // aborted
    toast(`Couldn't load — ${e.errorDescription || e.errorCode}`);
  });
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
async function sampleTheme() {
  let sampled = null;
  try {
    sampled = await wv.executeJavaScript(`(() => {
      const m = document.querySelector('meta[name="theme-color"]');
      const cs = (el) => el ? getComputedStyle(el).backgroundColor : '';
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

async function screenshot({ fullPage = false } = {}) {
  const res = await window.bridge.screenshot(wv.getWebContentsId(), {
    url: wv.getURL(),
    device: device.name,
    fullPage,
  });
  if (!res?.ok) return toast('Screenshot failed');
  toast(`Saved ${res.width} × ${res.height}${fullPage ? ' full page' : ''} to Desktop`,
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

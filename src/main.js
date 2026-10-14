'use strict'

const {
  app, BrowserWindow, ipcMain, webContents, dialog, shell, nativeTheme, screen,
  nativeImage, session,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { DEVICES, USER_AGENTS, DEFAULTS } = require('./devices');
const { BROWSERS } = require('./browsers');
const buildMenu = require('./menu');

let win = null;

// Apple's trademark guidelines forbid "iPhone" in an App Store app's name.
// `process.mas` is set by Electron only inside an actual Mac App Store
// build, so this switches automatically without touching the GitHub /
// direct-download identity everywhere else.
const APP_NAME = process.mas ? 'Responsive Phone Browser' : 'iPhone Browser';

// The menu bar takes its name from the bundle (CFBundleName), not from anything
// here, so a Store build is renamed by the `mas` script in package.json passing
// -c.productName. Don't reach for app.setName() to do it: userData is derived
// from the app name, so setting it repoints the whole profile directory and
// orphans every existing user's settings, cookies and logins.

/* ------------------------------------------------------------------ state */

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function loadState() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveState(patch) {
  const next = { ...loadState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('[state] could not persist:', err.message);
  }
  return next;
}

/* -------------------------------------------------------------- emulation */

// webContents ids we've attached the CDP debugger to.
const attached = new Set();

function attachDebugger(wc) {
  if (attached.has(wc.id)) return true;
  try {
    wc.debugger.attach('1.3');
    attached.add(wc.id);
    wc.once('destroyed', () => attached.delete(wc.id));
    return true;
  } catch (err) {
    // Usually means DevTools is open — not fatal, we just lose touch emulation.
    console.warn('[cdp] attach failed:', err.message);
    return false;
  }
}

function detachDebugger(wc) {
  if (!attached.has(wc.id)) return;
  try { wc.debugger.detach(); } catch { /* already gone */ }
  attached.delete(wc.id);
}

const send = (wc, method, params) =>
  wc.debugger.sendCommand(method, params).catch((err) => {
    console.warn(`[cdp] ${method}:`, err.message);
  });

// The full device-metrics override: viewport, window.screen, DPR and mobile
// viewport semantics (a page with no <meta viewport> gets 980px). Shared with
// the full-page screenshot path below, which temporarily overrides `height`
// alone and needs to restore exactly this afterward.
function deviceMetricsParams(opts) {
  const { viewWidth, viewHeight, screenWidth, screenHeight, dpr, landscape } = opts;
  return {
    width: viewWidth,
    height: viewHeight,
    deviceScaleFactor: dpr,
    mobile: true,
    screenWidth,
    screenHeight,
    positionX: 0,
    positionY: 0,
    dontSetVisibleSize: false,
    screenOrientation: landscape
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 },
  };
}

/* ---------------------------------------------------------- touch cursor
   Chromium's touch emulation hangs off the window's shared input router, not the
   page it was enabled for. So while any page turns mouse input into touches, the
   whole window is under it: the round touch cursor follows the pointer onto the
   toolbar and bottom bar, and the app's own controls get no mouse moves at all —
   no hover, no cursor change. Confirmed directly: with it on, the shell page
   receives zero mousemove events; switched off on the page, they come straight
   back.

   The page can't report the pointer leaving (it isn't being sent the pointer),
   and the shell can't report it arriving (it isn't being sent anything), so the
   main process watches the pointer itself and keeps mouse-as-finger switched on
   only for the page the pointer is over. The renderer reports where the pages
   are on screen — nothing, while Settings or a menu covers them. */

const pageRects = new Map();       // webContents id → rect, in window content coordinates
const touchForMouse = new Map();   // webContents id → whether it's currently on

ipcMain.on('pages:rects', (_e, rects) => {
  pageRects.clear();
  for (const r of rects || []) pageRects.set(r.wcId, r);
  syncTouchToPointer();
});

function pointerOverPage(wcId) {
  const r = pageRects.get(wcId);
  if (!r || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return false;
  const p = screen.getCursorScreenPoint();
  const c = win.getContentBounds();
  const x = p.x - c.x;
  const y = p.y - c.y;
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

function syncTouchToPointer() {
  const pending = [];
  for (const wcId of attached) {
    const on = pointerOverPage(wcId);
    if (touchForMouse.get(wcId) === on) continue;
    touchForMouse.set(wcId, on);
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) continue;
    pending.push(send(wc, 'Emulation.setEmitTouchEventsForMouse',
      on ? { enabled: true, configuration: 'mobile' } : { enabled: false }));
  }
  return Promise.all(pending);
}

// ~12 checks a second: fast enough that the cursor has changed by the time
// you've moved a few pixels past the edge, and a trivial amount of work
setInterval(syncTouchToPointer, 80);

/**
 * Reproduce what Chrome DevTools' device toolbar does:
 *   - viewport + screen metrics, mobile viewport semantics, device pixel ratio
 *   - touch events instead of mouse events
 *   - an iOS user agent (requests, navigator.userAgent, navigator.platform)
 *   - a forced prefers-color-scheme when the user picks one
 */
async function applyEmulation(wcId, opts) {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return { ok: false };

  const { userAgent, platform, colorScheme, safeArea } = opts;

  wc.setUserAgent(userAgent);

  if (attachDebugger(wc)) {
    await send(wc, 'Emulation.setDeviceMetricsOverride', deviceMetricsParams(opts));
    await send(wc, 'Emulation.setUserAgentOverride', {
      userAgent,
      platform,
      acceptLanguage: app.getLocale() || 'en-US',
    });
    await send(wc, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // mouse-as-finger only while the pointer is actually over this page — see
    // syncTouchToPointer() below for why it can't simply stay on
    touchForMouse.delete(wc.id);
    await syncTouchToPointer();
    // makes env(safe-area-inset-*) real, so notch-aware CSS actually applies
    if (safeArea) {
      await send(wc, 'Emulation.setSafeAreaInsetsOverride', { insets: safeArea });
    }
    await send(wc, 'Emulation.setEmulatedMedia', {
      features: colorScheme === 'system'
        ? []
        : [{ name: 'prefers-color-scheme', value: colorScheme }],
    });
  } else {
    // No CDP (DevTools owns the target) — fall back to Electron's own
    // emulation, which covers the viewport but not window.screen / DPR.
    wc.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: { width: opts.screenWidth, height: opts.screenHeight },
      viewSize: { width: opts.viewWidth, height: opts.viewHeight },
      viewPosition: { x: 0, y: 0 },
      deviceScaleFactor: opts.dpr,
      scale: 1,
    });
  }

  return { ok: true };
}

/* --------------------------------------------------------------- window */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const SHELL_HTML = path.join(__dirname, 'shell', 'index.html');

// Compared by decoded path, not by string: loadFile() and pathToFileURL()
// percent-encode an installed path's spaces ("iPhone Browser.app") the same
// way today, but nothing promises they always will.
function isShellUrl(target) {
  try {
    const u = new URL(target);
    return u.protocol === 'file:' && decodeURIComponent(u.pathname) === SHELL_HTML;
  } catch {
    return false;
  }
}

/**
 * Where the window opens. The first time: the full height of the usable screen,
 * menu bar down to the Dock, so the phone is drawn big enough to read. workArea
 * is what already excludes those, on whatever display and Dock arrangement a
 * given Mac has. After that, wherever and however big it was last left — clamped
 * back onto a display that still exists, in case it was on one since unplugged.
 *
 * Deliberately a different key from the old windowWidth / windowHeight: those
 * were written by the window resizing itself around each device, not by anyone
 * choosing a size, so restoring them would bring the small window straight back.
 */
function initialBounds(state) {
  const saved = state.windowBounds;
  if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) {
    const { workArea } = screen.getDisplayMatching(saved);
    const width = Math.min(saved.width, workArea.width);
    const height = Math.min(saved.height, workArea.height);
    return {
      width,
      height,
      x: clamp(saved.x, workArea.x, workArea.x + workArea.width - width),
      y: clamp(saved.y, workArea.y, workArea.y + workArea.height - height),
    };
  }

  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = Math.round(clamp(workArea.width * 0.55, Math.min(900, workArea.width), 1400));
  return {
    width,
    height: workArea.height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y,
  };
}

function createWindow() {
  const state = loadState();

  win = new BrowserWindow({
    ...initialBounds(state),
    minWidth: 580,
    minHeight: 500,
    show: false,
    title: APP_NAME,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 19 },
    backgroundColor: '#1b1b1f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload needs only contextBridge + ipcRenderer, both of which the
      // sandboxed renderer provides — so the shell runs in Chromium's OS
      // sandbox like any other renderer, and a bug in it can't reach Node.
      sandbox: true,
    },
  });

  win.loadFile(SHELL_HTML);

  // The shell is one local page, and only ever that page. Its frame holds the
  // preload's IPC bridge, so a renderer that was somehow talked into going
  // elsewhere would hand that bridge to whatever it loaded — any navigation
  // that isn't the shell's own file is cancelled. Pages the user opens live in
  // <webview> guests, which navigate freely and never see this handler.
  win.webContents.on('will-navigate', (event, target) => {
    if (!isShellUrl(target)) {
      event.preventDefault();
      console.warn('[shell] blocked navigation to', target);
    }
  });
  // …and it opens no windows of its own; window.open from a page is handled
  // on the guest, below.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());

  // Nothing resizes the window programmatically any more, so every change here
  // is the user's. Debounced: a drag fires resize continuously.
  let rememberTimer = null;
  const remember = () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized() || win.isFullScreen() || win.isMaximized()) return;
    saveState({ windowBounds: win.getBounds() });
  };
  const rememberSoon = () => {
    clearTimeout(rememberTimer);
    rememberTimer = setTimeout(remember, 400);
  };
  win.on('resize', rememberSoon);
  win.on('move', rememberSoon);
  win.on('close', () => { clearTimeout(rememberTimer); remember(); });
  win.on('closed', () => { win = null; });

  buildMenu(() => win);
}

/* ------------------------------------------------------------------- ipc */

ipcMain.handle('state:get', () => ({
  state: loadState(),
  devices: DEVICES,
  browsers: BROWSERS,
  userAgents: USER_AGENTS,
  systemDark: nativeTheme.shouldUseDarkColors,
  appName: APP_NAME,
  version: app.getVersion(),
}));

ipcMain.handle('state:set', (_e, patch) => saveState(patch));

ipcMain.handle('emulate', (_e, wcId, opts) => applyEmulation(wcId, opts));

ipcMain.handle('devtools:toggle', (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return;
  if (wc.isDevToolsOpened()) {
    wc.closeDevTools();
    return;
  }
  // The CDP debugger and the DevTools frontend can't both own the target.
  detachDebugger(wc);
  wc.openDevTools({ mode: 'detach', activate: true });
  wc.once('devtools-closed', () => {
    if (win && !win.isDestroyed()) win.webContents.send('menu:reapply-emulation');
  });
});

// Page.captureScreenshot returns a tiled, corrupted image at dpr=3 on this
// Chromium build (confirmed directly: dpr 1 and 2 both capture cleanly, only
// 3 breaks) — and separately, a <webview>'s guest paints into a surface tied
// to its own on-screen DOM size, so asking for a taller capture than that
// (captureBeyondViewport, or a taller declared height with an explicit clip)
// just tiles what's already painted rather than rendering more. The renderer
// works around both: it captures at a safe dpr, scales the result up to the
// device's real resolution, and — for full-page shots — scrolls in
// increments and stitches the per-scroll-position tiles itself. This handler
// is the primitive that gets called once per tile.
ipcMain.handle('capture-tile', async (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed() || !attached.has(wc.id)) return null;
  try {
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    return data; // base64
  } catch (err) {
    console.warn('[cdp] capture-tile:', err.message);
    return null;
  }
});

ipcMain.handle('screenshot', async (_e, wcId, meta = {}) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return { ok: false };

  // The renderer always does its own capture (see capture-tile above) and
  // hands over the finished PNG here — this direct-CDP path only remains as
  // a fallback for callers that don't. capturePage() renders at the Mac's
  // own scale factor (usually 2x); CDP honours the emulated DPR instead.
  let buffer = null;
  if (meta.stitchedPngBase64) {
    buffer = Buffer.from(meta.stitchedPngBase64, 'base64');
  } else if (attached.has(wc.id)) {
    try {
      const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
      buffer = Buffer.from(data, 'base64');
    } catch (err) {
      console.warn('[cdp] captureScreenshot:', err.message);
    }
  }
  const image = buffer
    ? nativeImage.createFromBuffer(buffer)
    : await wc.capturePage();

  const stamp = new Date()
    .toLocaleString('sv-SE')      // 2026-08-07 12:34:56
    .replace(/:/g, '.');
  const host = (() => {
    try { return new URL(meta.url || '').hostname || 'page'; } catch { return 'page'; }
  })();
  const suffix = meta.fullPage ? ' full page' : '';
  const file = `${meta.device || 'iPhone'} — ${host} — ${stamp}${suffix}.png`;

  let target;
  if (process.mas) {
    // Sandboxed builds have no Desktop access at all — writing there is
    // denied every time, for every user, not just occasionally. The save
    // panel is what the files.user-selected.read-write entitlement actually
    // authorizes: picking a location in it grants a one-time write there.
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('desktop'), file),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    target = filePath;
  } else {
    target = path.join(app.getPath('desktop'), file);
  }

  try {
    fs.writeFileSync(target, buffer || image.toPNG());
    const { width, height } = image.getSize();
    return { ok: true, path: target, width, height };
  } catch (err) {
    dialog.showErrorBox('Could not save screenshot', err.message);
    return { ok: false };
  }
});

// A picture of a page as it currently stands, for the half of a folded display
// that's turned away (see renderPose in duo.js). Taken from the compositor
// rather than through CDP: it's cheap enough to repeat every second or so, and
// it sidesteps the dpr=3 capture bug entirely. Shrunk and JPEG'd because it
// crosses to the renderer as a data URL and will be blurred anyway.
ipcMain.handle('capture-page', async (_e, wcId, maxWidth) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return null;
  try {
    let img = await wc.capturePage();
    const { width } = img.getSize();
    if (maxWidth && width > maxWidth) img = img.resize({ width: Math.round(maxWidth) });
    return `data:image/jpeg;base64,${img.toJPEG(72).toString('base64')}`;
  } catch (err) {
    console.warn('[capture-page]', err.message);
    return null;
  }
});

/* ------------------------------------------- laptop pose: simulated controls
   An image of the user's choosing fills the lower half in the laptop pose — the
   way Netflix puts playback controls there — while the page keeps the upper
   half. Copied into userData so it survives; the picker's grant covers the read
   even under the App Sandbox. */
const controlsPath = () => {
  const name = loadState().laptopControls;
  return name ? path.join(app.getPath('userData'), name) : null;
};
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function imageDataUrl(file) {
  const mime = MIME[path.extname(file).toLowerCase()] || 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

ipcMain.handle('controls:load', () => {
  const file = controlsPath();
  try { return file ? imageDataUrl(file) : null; } catch { return null; }
});

ipcMain.handle('controls:pick', async (_e, fit) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'info',
    message: 'Simulated controls for the laptop pose',
    detail: `Choose an image to fill the lower half of the display — playback controls, a keyboard, whatever the site would put there. The page keeps the upper half.\n\nFor an exact fit, make it ${fit.px.w} × ${fit.px.h} pixels (${fit.pt.w} × ${fit.pt.h} points at 3×). Other sizes are scaled to cover the area.`,
    buttons: ['Choose Image…', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return null;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  });
  if (canceled || !filePaths[0]) return null;
  const ext = path.extname(filePaths[0]).toLowerCase();
  const name = `laptop-controls${MIME[ext] ? ext : '.png'}`;
  const old = controlsPath();
  try {
    fs.copyFileSync(filePaths[0], path.join(app.getPath('userData'), name));
    if (old && path.basename(old) !== name) fs.rmSync(old, { force: true });
    saveState({ laptopControls: name });
    return imageDataUrl(path.join(app.getPath('userData'), name));
  } catch (err) {
    dialog.showErrorBox('Could not use that image', err.message);
    return null;
  }
});

ipcMain.handle('controls:clear', () => {
  const file = controlsPath();
  if (file) fs.rmSync(file, { force: true });
  saveState({ laptopControls: null });
});

ipcMain.handle('reveal', (_e, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('open-external', (_e, url) => {
  // only ever web links — this is reachable from the renderer
  if (/^https?:\/\//i.test(String(url))) return shell.openExternal(url);
});

// Start at Login. The OS owns this setting (System Settings › General › Login
// Items shows and can change it too), so it's read back from there every time
// rather than mirrored in state.json, where the two could disagree.
ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('login:set', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(on) });
  return app.getLoginItemSettings().openAtLogin;
});

// Every tab shares one partition ('persist:ios' — set on each <webview>), so
// clearing it is one operation for every tab at once: cookies, cache, local
// storage, service workers, IndexedDB — everything a site could use to
// remember it's been seen before. Confirmed with the user first, here rather
// than in the renderer, so a compromised page can never trigger it itself.
ipcMain.handle('browsing:clear', async () => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    message: 'Clear browsing data?',
    detail: 'This clears cookies, cache, local storage and site data for every '
      + 'tab — including anything you’re signed into. It can’t be undone.',
    buttons: ['Cancel', 'Clear'],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { ok: false, canceled: true };

  try {
    const ses = session.fromPartition('persist:ios');
    await ses.clearStorageData();
    await ses.clearCache();
    return { ok: true };
  } catch (err) {
    console.warn('[browsing:clear]', err.message);
    return { ok: false };
  }
});

// Cmd+W closes the active tab (see preload/shell.js), not the window — this is
// what the menu's "Close Window" item falls back to instead of Electron's
// default `role: 'close'`, and what the renderer calls when Cmd+W is pressed
// with only one tab left, matching Safari/Chrome closing the window at that point.
ipcMain.handle('window:close', () => {
  if (win && !win.isDestroyed()) win.close();
});

/* ------------------------------------------------------------ permissions
   Electron grants every permission a page asks for unless told otherwise —
   camera, microphone, geolocation, notifications — so any site opened in the
   phone could have had them, with no prompt. Nothing this app does needs a
   page to reach the Mac's hardware or the user's position, so it's deny by
   default, and a site sees what it would from a user who tapped Don't Allow.

   Allowed, because a page can need them to behave and none leaves the page:
     fullscreen                 video players; Esc leaves it, as in Safari
     pointerLock, keyboardLock  games and 3D viewers; also released with Esc
     clipboard-sanitized-write  "Copy" buttons — write-only, so a page can put
                                text on the clipboard but never read it
   Refused, with the reason it's on the list:
     media                      camera and microphone (video or audio)
     geolocation                the Mac's position
     notifications              system banners from a preview tool
     midi, midiSysex            instruments plugged into the Mac
     display-capture            screen sharing of the Mac itself
     clipboard-read             whatever the user last copied
     idle-detection             whether the user is at the keyboard
     openExternal               a page launching another app via a URL scheme
     usb, serial, hid           devices on the Mac (chooser handler below too)
     storage-access, speaker-selection, window-management, fileSystem, and
     anything Chromium adds later — not on the allow list, so refused. */
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write',
]);

function lockDownPermissions(ses) {
  // Asynchronous requests: getUserMedia, Notification.requestPermission,
  // navigator.geolocation.getCurrentPosition, …
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  // Synchronous checks: navigator.permissions.query, Notification.permission,
  // and the gate on device labels in enumerateDevices. Must agree with the
  // request handler, or a page is told "granted" and then refused.
  ses.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.has(permission));
  // WebUSB / Web Serial / WebHID pick a device through a chooser the app would
  // have to draw. It draws none, so there is never a device to grant.
  ses.setDevicePermissionHandler(() => false);
}

/* ------------------------------------------------------------ web contents */

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') {
    // Any window that embeds a <webview> — the shell — is told what a guest
    // may run with, whatever the tag said. The tag's own attributes
    // (partition, allowpopups, useragent, src) arrive as `params` and stay as
    // they are; only the webPreferences a page must never have are forced.
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload;
      delete webPreferences.preloadURL;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
      webPreferences.experimentalFeatures = false;
      // Every tab is created by createTab() on the one shared partition, which
      // is also the one the permission handlers are set on. A guest asking for
      // any other session is not one this app made.
      if (params.partition !== 'persist:ios') {
        event.preventDefault();
        console.warn('[webview] refused guest on partition', params.partition);
      }
    });
    return;
  }

  // target=_blank / window.open should stay inside the phone, like on iOS.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) contents.loadURL(url);
    return { action: 'deny' };
  });

  contents.on('destroyed', () => {
    attached.delete(contents.id);
    touchForMouse.delete(contents.id);
    pageRects.delete(contents.id);
  });
});

// Local dev servers with self-signed certs are the whole point of this app.
app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* ignore */ }
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    host.endsWith('.localhost') || host.endsWith('.local') ||
    /^192\.168\./.test(host) || /^10\./.test(host);

  if (isLocal) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

/* ------------------------------------------------------------- lifecycle */

app.whenReady().then(() => {
  // Before any webContents exists, so no page ever sees the default policy.
  // Both sessions: the webviews' persist:ios, and the default one the shell
  // itself (and a detached DevTools window) runs on.
  lockDownPermissions(session.fromPartition('persist:ios'));
  lockDownPermissions(session.defaultSession);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

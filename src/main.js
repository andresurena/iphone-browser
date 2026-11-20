'use strict'

const {
  app, BrowserWindow, ipcMain, webContents, dialog, shell, nativeTheme, screen,
  nativeImage, session, systemPreferences,
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
    // Written beside the real file and renamed over it. A plain write that's
    // cut short — the app killed, the Mac losing power — leaves half a file,
    // and loadState() answers a file it can't read with the defaults: every
    // setting gone at the next launch. A rename either happens or doesn't.
    const tmp = `${statePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, statePath());
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
  mediaShims.delete(wc.id);   // scripts registered over a session go with it
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
  for (const r of Array.isArray(rects) ? rects : []) if (r && Number.isInteger(r.wcId)) pageRects.set(r.wcId, r);
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
    await syncMediaShim(wc);
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

// Only the settings the shell actually owns. The file names kept in state
// (laptopControls) and the camera choice are written by the main process alone
// — they go through their own handlers, which check them — so a patch can't
// point one of them somewhere else on disk.
const SHELL_STATE_KEYS = new Set(Object.keys(DEFAULTS).filter((k) => k !== 'cameraLabel' && k !== 'micLabel'));
ipcMain.handle('state:set', (_e, patch) => {
  const clean = {};
  for (const [key, value] of Object.entries(patch && typeof patch === 'object' ? patch : {})) {
    if (SHELL_STATE_KEYS.has(key)) clean[key] = value;
  }
  return saveState(clean);
});

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

// One capture of what a page currently shows, at its emulated pixel ratio. The
// renderer sizes the page's surface to match before calling (see "A page's
// picture can be no bigger than the surface it paints into" in shell.js) and,
// for full-page shots, scrolls and stitches these tiles itself.
ipcMain.handle('capture-tile', async (_e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return null;
  // With the Web Inspector open the debugger belongs to it, not to us. The
  // compositor's own picture of the page still works — at the Mac's scale
  // rather than the device's, which the renderer sizes to fit.
  if (!attached.has(wc.id)) {
    try { return (await wc.capturePage()).toPNG().toString('base64'); } catch { return null; }
  }
  try {
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    return data; // base64
  } catch (err) {
    console.warn('[cdp] capture-tile:', err.message);
    return null;
  }
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A device or host name as part of a file name: nothing that could leave the folder. */
const fileNamePart = (text, fallback) =>
  String(text || '').replace(/[\\/:\u0000-\u001f]/g, ' ').replace(/^[.\s]+/, '').trim().slice(0, 80) || fallback;

ipcMain.handle('screenshot', async (_e, wcId, meta) => {
  if (!meta || typeof meta !== 'object') meta = {};
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return { ok: false };

  // The renderer always does its own capture (see capture-tile above) and
  // hands over the finished PNG here — this direct path only remains as a
  // fallback for callers that don't, and is only right at the display's own
  // scale factor.
  let buffer = null;
  if (typeof meta.stitchedPngBase64 === 'string') {
    buffer = Buffer.from(meta.stitchedPngBase64, 'base64');
    // what gets written to disk is a PNG or nothing
    if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false };
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
  const file = `${fileNamePart(meta.device, 'iPhone')} — ${fileNamePart(host, 'page')} — ${stamp}${suffix}.png`;

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
  // only ever the copy this app made — never a path read out of the state file
  if (typeof name !== 'string' || !/^laptop-controls\.(png|jpe?g|webp)$/.test(name)) return null;
  return path.join(app.getPath('userData'), name);
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
    forgetMediaGrants();
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
     geolocation                the Mac's position
     notifications              system banners from a preview tool
     midi, midiSysex            instruments plugged into the Mac
     display-capture            screen sharing of the Mac itself
     clipboard-read             whatever the user last copied
     idle-detection             whether the user is at the keyboard
     openExternal               a page launching another app via a URL scheme
     usb, serial, hid           devices on the Mac (chooser handler below too)
     storage-access, speaker-selection, window-management, fileSystem, and
     anything Chromium adds later — not on the allow list, so refused.
   Asked about, site by site:
     media                      camera and microphone — see "camera & mic" below */
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen', 'pointerLock', 'keyboardLock', 'clipboard-sanitized-write',
]);

function lockDownPermissions(ses) {
  // Asynchronous requests: getUserMedia, Notification.requestPermission,
  // navigator.geolocation.getCurrentPosition, …
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (ALLOWED_PERMISSIONS.has(permission)) { callback(true); return; }
    if (permission === 'media' && wc && !wc.isDestroyed() && wc.getType() === 'webview') {
      requestMedia(wc, details || {}).then(callback, () => callback(false));
      return;
    }
    callback(false);
  });
  // Synchronous checks: navigator.permissions.query, Notification.permission,
  // and the gate on device labels in enumerateDevices. Must agree with the
  // request handler, or a page is told "granted" and then refused.
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    if (ALLOWED_PERMISSIONS.has(permission)) return true;
    if (permission !== 'media') return false;
    // The shell lists cameras and microphones by name in Settings. A check is
    // all it's given: it can read the names, and is still refused the devices.
    if (wc && win && !win.isDestroyed() && wc === win.webContents) return true;
    return mediaAllowed(originOf((details && details.securityOrigin) || requestingOrigin),
      details && details.mediaType);
  });
  // WebUSB / Web Serial / WebHID pick a device through a chooser the app would
  // have to draw. It draws none, so there is never a device to grant.
  ses.setDevicePermissionHandler(() => false);
}

/* ------------------------------------------------------------ camera & mic
   A page gets the camera or the microphone the way it does on a phone: it
   asks, and an alert on the phone's screen asks you. Three things have to
   agree before a page is given either:

   1. You, for that site. The shell draws the alert (media.js) and answers.
      A yes is kept per origin until the app quits or browsing data is
      cleared; a no lasts until that page navigates, so a page can't nag.
   2. macOS, for this app. The first time, that's the system's own prompt;
      after that it's System Settings › Privacy & Security.
   3. Chromium's own rules: a secure page, and a frame the page's
      Permissions-Policy lets have it.

   Which camera and microphone a page gets is chosen in Settings, not by the
   page: a site written for a phone asks for "the front camera" or "the back
   one", and a Mac has neither. See mediaShimSource(). */

const mediaGrants = new Map();    // origin → Set of 'camera' | 'microphone'
const mediaRefused = new Set();   // `${webContents id}|${origin}`, until that page navigates
const mediaAsks = new Map();      // ask id → { wcId, key, settle }
const mediaAsking = new Map();    // `${webContents id}|${origin}|${kinds}` → the promise already waiting
let nextMediaAsk = 1;

// Chromium's test devices: a moving pattern for a camera and a beep for a
// microphone. They never touch hardware, so macOS has nothing to say about them.
const FAKE_MEDIA = app.commandLine.hasSwitch('use-fake-device-for-media-stream');

function originOf(url) {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? '' : origin;
  } catch {
    return '';
  }
}

function mediaAllowed(origin, mediaType) {
  const have = mediaGrants.get(origin);
  if (!have) return false;
  if (mediaType === 'video') return have.has('camera');
  if (mediaType === 'audio') return have.has('microphone');
  return have.size > 0;
}

const toShell = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

async function macAllows(kind) {
  if (process.platform !== 'darwin' || FAKE_MEDIA) return true;
  const status = systemPreferences.getMediaAccessStatus(kind);
  if (status === 'granted') return true;
  if (status !== 'not-determined') return false;   // denied, or restricted by a profile
  try { return await systemPreferences.askForMediaAccess(kind); } catch { return false; }
}

/** Put the alert on the phone's screen and wait for the answer. */
function askShell(wc, origin, kinds) {
  if (!win || win.isDestroyed()) return Promise.resolve(false);
  const key = `${wc.id}|${origin}|${kinds.join('+')}`;
  if (mediaAsking.has(key)) return mediaAsking.get(key);
  const id = nextMediaAsk++;
  const asking = new Promise((resolve) => {
    mediaAsks.set(id, {
      wcId: wc.id,
      settle: (allow) => {
        if (!mediaAsks.delete(id)) return;
        mediaAsking.delete(key);
        resolve(Boolean(allow));
      },
    });
  });
  mediaAsking.set(key, asking);
  let host = origin;
  try { host = new URL(origin).host; } catch { /* keep the origin */ }
  toShell('media:ask', { id, wcId: wc.id, host, kinds });
  return asking;
}

/** A page that has gone can't be answered: drop its alerts and its refusals. */
function dropMediaAsks(wcId) {
  for (const [id, ask] of mediaAsks) {
    if (ask.wcId !== wcId) continue;
    ask.settle(false);
    toShell('media:cancel', id);
  }
  for (const key of mediaRefused) if (key.startsWith(`${wcId}|`)) mediaRefused.delete(key);
}

async function requestMedia(wc, details) {
  const kinds = [];
  for (const type of details.mediaTypes || []) {
    const kind = type === 'video' ? 'camera' : type === 'audio' ? 'microphone' : null;
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  const origin = originOf(details.securityOrigin || details.requestingUrl || wc.getURL());
  if (!kinds.length || !origin) return false;
  const wcId = wc.id;

  const have = mediaGrants.get(origin) || new Set();
  const missing = kinds.filter((k) => !have.has(k));
  if (missing.length) {
    const refusal = `${wcId}|${origin}`;
    if (mediaRefused.has(refusal)) return false;
    if (!(await askShell(wc, origin, missing))) {
      if (!wc.isDestroyed()) mediaRefused.add(refusal);
      return false;
    }
  }
  for (const kind of kinds) {
    if (await macAllows(kind)) continue;
    toShell('media:blocked', kind);
    return false;
  }
  if (wc.isDestroyed()) return false;
  mediaGrants.set(origin, new Set([...(mediaGrants.get(origin) || []), ...kinds]));
  return true;
}

function forgetMediaGrants() {
  mediaGrants.clear();
  mediaRefused.clear();
}

/**
 * Runs in every page before its own scripts, and steers getUserMedia to the
 * camera and microphone chosen in Settings.
 *
 * A page can name a device itself, and then it's left alone. Otherwise a site
 * built for a phone says `facingMode: 'user'` or `{ exact: 'environment' }` —
 * and the second of those fails outright on a Mac, whose cameras face neither
 * way. So facingMode is dropped, and the chosen device put in its place.
 *
 * The chosen device is known here only by its name, because device ids are
 * different for every site. And a site can't see names until it has been
 * allowed once — so the first request may open the default camera, find it
 * isn't the one chosen, and swap. The name stays inside this closure: a page
 * that hasn't been allowed can't read which camera the Mac has.
 *
 * Changing the choice installs a newer copy on top (the page's document can't
 * be reached any other way). The newest one decides and marks the request, so
 * the copies beneath it pass it straight through.
 */
function mediaShimSource(want) {
  return `(() => {
  const proto = window.MediaDevices && MediaDevices.prototype;
  if (!proto || !proto.getUserMedia) return;
  const WANT = ${JSON.stringify({ video: want.camera || '', audio: want.microphone || '' })};
  const DECIDED = Symbol.for('ib.media.decided');
  const realGet = proto.getUserMedia;
  const realList = proto.enumerateDevices;
  const named = (c) => {
    if (!c || typeof c !== 'object' || c.deviceId == null) return false;
    const d = c.deviceId;
    const v = (typeof d === 'object' && !Array.isArray(d)) ? (d.exact != null ? d.exact : d.ideal) : d;
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  };
  const find = async (devices, kind) => {
    if (!WANT[kind]) return null;
    try {
      const list = await realList.call(devices);
      const hit = list.find((d) => d.kind === kind + 'input' && d.label === WANT[kind]);
      return hit ? hit.deviceId : null;
    } catch (e) { return null; }
  };
  const aim = (c, id) => {
    const out = (c && typeof c === 'object') ? Object.assign({}, c) : {};
    delete out.facingMode;
    if (id) out.deviceId = { exact: id };
    return out;
  };
  proto.getUserMedia = async function getUserMedia(constraints) {
    if (!constraints || typeof constraints !== 'object' || constraints[DECIDED]) {
      return realGet.call(this, constraints);
    }
    const asked = Object.assign({}, constraints);
    asked[DECIDED] = true;
    const ours = {};
    for (const kind of ['video', 'audio']) {
      if (!asked[kind] || named(asked[kind])) continue;
      ours[kind] = true;
      const id = await find(this, kind);
      if (id || (kind === 'video' && typeof asked.video === 'object')) asked[kind] = aim(asked[kind], id);
    }
    let stream = await realGet.call(this, asked);
    let again = null;
    for (const kind of ['video', 'audio']) {
      if (!ours[kind] || !WANT[kind]) continue;
      const track = (kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks())[0];
      if (!track || track.label === WANT[kind]) continue;
      const id = await find(this, kind);
      if (!id) continue;
      again = again || Object.assign({}, asked);
      again[kind] = aim(asked[kind], id);
    }
    if (again) {
      for (const t of stream.getTracks()) t.stop();
      stream = await realGet.call(this, again);
    }
    return stream;
  };
})();`;
}

const mediaShims = new Map();   // webContents id → { source, identifier } as last installed

async function syncMediaShim(wc) {
  if (!wc || wc.isDestroyed() || !attached.has(wc.id)) return;
  const state = loadState();
  const source = mediaShimSource({ camera: state.cameraLabel, microphone: state.micLabel });
  const had = mediaShims.get(wc.id);
  if (had && had.source === source) return;
  mediaShims.set(wc.id, { source, identifier: null });
  if (had && had.identifier) {
    await send(wc, 'Page.removeScriptToEvaluateOnNewDocument', { identifier: had.identifier });
  }
  // scripts registered for new documents only run once the Page domain is on;
  // without this they're accepted and then silently never evaluated
  await send(wc, 'Page.enable');
  const added = await send(wc, 'Page.addScriptToEvaluateOnNewDocument', { source });
  const now = mediaShims.get(wc.id);
  if (now && now.source === source) now.identifier = (added && added.identifier) || null;
  // and the document that's already open
  await send(wc, 'Runtime.evaluate', { expression: source });
}

ipcMain.handle('media:answer', (e, id, allow) => {
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
  const ask = mediaAsks.get(id);
  if (ask) ask.settle(allow === true);
});

ipcMain.handle('media:get', () => {
  const state = loadState();
  const status = (kind) => (process.platform === 'darwin' && !FAKE_MEDIA
    ? systemPreferences.getMediaAccessStatus(kind) : 'granted');
  return {
    camera: state.cameraLabel || '',
    microphone: state.micLabel || '',
    allowed: [...mediaGrants].map(([origin, kinds]) => ({ origin, kinds: [...kinds] })),
    mac: { camera: status('camera'), microphone: status('microphone') },
  };
});

ipcMain.handle('media:devices', async (_e, choice) => {
  const label = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
  saveState({ cameraLabel: label(choice && choice.camera), micLabel: label(choice && choice.microphone) });
  for (const wcId of attached) await syncMediaShim(webContents.fromId(wcId));
});

ipcMain.handle('media:reset', () => forgetMediaGrants());

ipcMain.handle('media:privacy', (_e, kind) => shell.openExternal(
  `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'microphone' ? 'Microphone' : 'Camera'}`));

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
    // rejects when the link is a download or the host can't be reached; the
    // page's own did-fail-load already tells the shell
    if (/^https?:/.test(url)) contents.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });

  const wcId = contents.id;   // not readable once it's destroyed
  contents.on('did-navigate', () => dropMediaAsks(wcId));
  contents.on('destroyed', () => {
    attached.delete(wcId);
    touchForMouse.delete(wcId);
    pageRects.delete(wcId);
    mediaShims.delete(wcId);
    dropMediaAsks(wcId);
  });
});

// Local dev servers with self-signed certs are the whole point of this app.
app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
  let host = '';
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { /* ignore */ }   // IPv6 comes bracketed
  // Addresses are matched whole: "10.example.com" is somebody's public site,
  // not a machine on the local network.
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  const a = ip ? Number(ip[1]) : -1;
  const b = ip ? Number(ip[2]) : -1;
  const isLocal =
    host === 'localhost' || host === '::1' ||
    host.endsWith('.localhost') || host.endsWith('.local') ||
    a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);

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

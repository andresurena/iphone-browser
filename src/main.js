'use strict'

const {
  app, BrowserWindow, ipcMain, webContents, dialog, shell, nativeTheme, screen,
  nativeImage,
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
    await send(wc, 'Emulation.setEmitTouchEventsForMouse', {
      enabled: true,
      configuration: 'mobile',
    });
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

function createWindow() {
  const state = loadState();

  // A full-height iPhone is taller than a lot of Mac screens — never open
  // bigger than the space we actually have.
  const area = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: Math.min(state.windowWidth || 600, area.width - 40),
    height: Math.min(state.windowHeight || 1000, area.height - 20),
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
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'shell', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const remember = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const [w, h] = win.getSize();
    saveState({ windowWidth: w, windowHeight: h });
  };
  win.on('resize', remember);
  win.on('close', remember);
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

ipcMain.handle('window:fit', (_e, contentWidth, contentHeight) => {
  if (!win || win.isDestroyed() || win.isFullScreen()) return;
  const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
  // no animate: animated resizes are unreliable when the window isn't frontmost
  win.setContentSize(
    Math.max(580, Math.min(Math.round(contentWidth), area.width - 40)),
    Math.max(500, Math.min(Math.round(contentHeight), area.height - 20)),
  );
});

ipcMain.handle('reveal', (_e, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));

/* ------------------------------------------------------------ web contents */

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;

  // target=_blank / window.open should stay inside the phone, like on iOS.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) contents.loadURL(url);
    return { action: 'deny' };
  });

  contents.on('destroyed', () => attached.delete(contents.id));
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

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

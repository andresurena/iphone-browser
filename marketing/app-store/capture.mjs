// Captures the raw renders the App Store slides are built from, out of the
// running app itself, so every device, bar and number in the listing is the
// app's own output rather than a mockup.
//
//   1. serve the demo sites:   python3 -m http.server 5173 --directory marketing/app-store/demo
//   2. run the app:            npx electron . --remote-debugging-port=9222
//   3. capture, in two passes, relaunching the app between them:
//        window 1240 x 1000:   node marketing/app-store/capture.mjs window
//        window max size:      node marketing/app-store/capture.mjs devices
//   4. render the slides:      sh marketing/app-store/render.sh
//
// The app saves its settings as it's driven, so back up
// ~/Library/Application Support/iphone-browser/state.json first and put it
// back after (render.sh does neither — this script changes the app's state).
//
// Make the app's window as large as the screen allows, on a Retina display,
// before launching it (set windowBounds in state.json, e.g. 2400 x 1600; the
// app clamps it to the screen). Don't resize from here with
// Emulation.setDeviceMetricsOverride: the shell's override reaches the
// <webview> guests, and the demo page lays itself out at the window's size.
//
// Device-only captures sit on a flat backdrop in exactly the slides' colour
// (BACKDROP, matched in slides.html), so they drop onto a slide seamlessly with
// their shadow intact. Not a transparent capture: like the size override, the
// shell's Emulation.setDefaultBackgroundColorOverride reaches the <webview>
// guests and resets their pixel ratio to the Mac's. Window captures are the
// whole app, with the Mac's traffic lights added by the slide.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { connect } from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'captures');
fs.mkdirSync(OUT, { recursive: true });

const SITE = 'http://localhost:5173';
const URLS = {
  halftone: `${SITE}/halftone/`,
  ledger: `${SITE}/ledger/`,
  supper: `${SITE}/supper/`,
};

const { cmd, ev, wait } = await connect();
await wait(1500);
await cmd('Page.enable');

const BACKDROP = '#f2f5f7';

/** A flat backdrop in the slides' colour behind the device, or the app's own. */
async function transparent(on) {
  await ev(`(() => {
    let s = document.getElementById('mk-backdrop');
    if (!s) { s = document.createElement('style'); s.id = 'mk-backdrop'; document.head.appendChild(s); }
    s.textContent = ${on} ? 'html, body, #stage { background: ${BACKDROP} !important; }' : '';
    s.textContent += ' .frame.is-active, *:focus, *:focus-visible { outline: none !important; }';
  })()`);
}

/** Apple's own convention for marketing screenshots: every clock reads 9:41. */
async function nineFortyOne() {
  await ev(`(() => {
    for (const el of document.querySelectorAll('.statusbar .time, [data-clock], #clockIos, #clockAndroid')) el.textContent = '9:41';
  })()`);
}

/** Exactly these tabs, in this order, with the first one active. */
async function tabsFor(names) {
  await ev('while (tabs.length > 1) closeTab(tabs[tabs.length - 1].id)');
  await wait(300);
  await ev(`go(${JSON.stringify(URLS[names[0]])}, tabs[0].id)`);
  for (const n of names.slice(1)) await ev(`createTab(${JSON.stringify(URLS[n])}, { activate: false })`);
  await ev('activateTab(tabs[0].id)');
  await wait(3200);
  for (let i = 0; i < names.length; i++) {
    await ev(`tabs[${i}]?.el.executeJavaScript('window.scrollTo(0, 0); 1', true).catch(() => 0)`);
  }
  await wait(400);
}

async function setup({ device, browser, display = null, compare = false, chrome = true }) {
  await ev(`set({ compare: false, showChrome: ${chrome}, orientation: 'portrait', showMeta: false, zoom: 'fit' })`);
  await wait(300);
  await ev(`pickDevice(${JSON.stringify(device)})`);
  await wait(700);
  if (browser) { await ev(`pickBrowser(${JSON.stringify(browser)})`); await wait(500); }
  if (display) { await ev(`pickDisplay(${JSON.stringify(display)})`); await wait(900); }
  if (compare) { await ev('set({ compare: true })'); await wait(900); }
  await ev('document.activeElement && document.activeElement.blur()');
  await ev('applyEmulation()');
  await wait(300);
}

/**
 * Always a full-window capture, cropped afterwards. A capture with a `clip`
 * rectangle resets the <webview> guests' pixel ratio to the Mac's (2) for
 * good — the page then renders at 2x, not the device's 3x — while a full
 * capture leaves their emulation alone.
 */
async function save(name, crop) {
  await nineFortyOne();
  await wait(150);
  const r = await cmd('Page.captureScreenshot', { format: 'png' });
  if (!r.data) throw new Error(`capture ${name} failed: ${JSON.stringify(r).slice(0, 200)}`);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  if (crop) {
    const k = await ev('devicePixelRatio');
    const box = [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height].map((v) => Math.round(v * k));
    execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1])
x0, y0, x1, y1 = map(int, sys.argv[2:6])
im.crop((max(0, x0), max(0, y0), min(im.width, x1), min(im.height, y1))).save(sys.argv[1])
`, file, ...box.map(String)]);
  }
  console.log('captured', name);
}

/**
 * The device and its shadow, nothing else. Measured from everything drawn
 * inside #phone, not just its box: a pose tilts its halves in 3D, and their
 * projection reaches well past the flat frame. Kept inside the stage, so no
 * toolbar or device bar creeps into the crop.
 */
async function captureDevice(name, pad = 70) {
  const box = JSON.parse(await ev(`(() => {
    const stage = document.getElementById('stage').getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const el of document.querySelectorAll('#phone, #phone *')) {
      if (el.closest('[hidden]') || getComputedStyle(el).display === 'none') continue;
      const q = el.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    l = Math.max(stage.left, l - ${pad}); t = Math.max(stage.top, t - ${pad});
    r = Math.min(stage.right, r + ${pad}); b = Math.min(stage.bottom, b + ${pad});
    return JSON.stringify({ x: l, y: t, width: r - l, height: b - t });
  })()`));
  await save(name, box);
}

const MODE = process.argv[2] || 'devices';

if (MODE === 'window') {
// ------------------------------------------------------------- 1. hero window
await transparent(false);
await setup({ device: 'iphone-18-pro-max', browser: 'safari' });
await tabsFor(['halftone', 'ledger', 'supper']);
await save('window-hero');

// ------------------------------------------------------- 5. localhost window
await tabsFor(['ledger']);
await ev('updateChromeForActiveTab({ forceUrlInput: true })');
await save('window-localhost');
} else {

// ------------------------------------------------------------ device renders
await transparent(true);

await setup({ device: 'iphone-18-pro-max', browser: 'safari' });
await tabsFor(['halftone']);
await captureDevice('dev-18promax-safari-halftone');

await setup({ device: 'iphone-16', browser: 'chrome-ios' });
await tabsFor(['halftone']);
await captureDevice('dev-16-chrome-halftone');

await setup({ device: 'pixel-10-pro', browser: 'chrome-android' });
await tabsFor(['halftone']);
await captureDevice('dev-pixel10pro-chrome-halftone');

// 6. the numbers: the same page, and what it actually sees
await setup({ device: 'iphone-18-pro-max', browser: 'safari' });
await tabsFor(['ledger']);
await captureDevice('dev-18promax-safari-ledger');
const seen = await ev(`(async () => await activeWv().executeJavaScript(\`(() => {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p);
  const out = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    safe: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat),
    touch: navigator.maxTouchPoints, ua: navigator.userAgent };
  p.remove();
  return JSON.stringify(out);
})()\`, true))()`);
fs.writeFileSync(path.join(OUT, 'numbers.json'), seen);
console.log('page sees', seen);

// 3. iPhone Duo: the book pose, and the outer display
await setup({ device: 'iphone-duo', browser: 'safari', display: 'pose-book' });
await tabsFor(['halftone']);
await wait(2500);   // the turned-away half is a picture that follows the page
await captureDevice('dev-duo-book-halftone', 90);

await setup({ device: 'iphone-duo', browser: 'safari', display: 'outer' });
await tabsFor(['supper']);
await captureDevice('dev-duo-outer-supper');

// 4. Compare: two devices, two sites
await setup({ device: 'iphone-18-pro', browser: 'safari' });
await tabsFor(['halftone', 'supper']);
await setup({ device: 'iphone-18-pro', browser: 'safari', compare: true });
await wait(2500);
await captureDevice('dev-compare-18pro');
await ev('set({ compare: false })');

// 7. Apple HomeView (beta)
await setup({ device: 'apple-homeview', browser: 'safari' });
await tabsFor(['supper']);
await captureDevice('dev-homeview-supper', 90);

}

await transparent(false);
console.log('done');
process.exit(0);

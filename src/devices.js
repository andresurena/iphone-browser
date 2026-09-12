'use strict'

/**
 * Device catalogue.
 *
 * All numbers are in CSS pixels — iOS points or Android dp — not physical
 * pixels. `dpr` is what the page sees as window.devicePixelRatio.
 *
 * Viewport sizes and pixel ratios match Chrome DevTools' own device list
 * (devtools-frontend/front_end/models/emulation/EmulatedDevices.ts), so a page
 * measured here measures the same in DevTools' device toolbar.
 *
 * To add a device: copy a block and change the numbers. The picker, the menu
 * and the drawn frame all read from here.
 */

const ISLAND = { type: 'island', w: 126, h: 37, top: 11 };

// iPhone Duo's inner camera sits under the display and stays invisible until
// the camera is in use, so there's nothing to draw and nothing to lay out around.
const UNDER_DISPLAY = { type: 'none', w: 0, h: 0, top: 0 };

const IOS_LANDSCAPE_SAFE = { top: 0, right: 59, bottom: 21, left: 59 };

/**
 * iPhone Duo — Apple's first foldable, September 2026.
 *
 * Folded and unfolded are as different to a layout as an iPhone and an iPad,
 * so they're two entries here rather than one device with a toggle: you test a
 * page against one, then the other.
 *
 * Panel sizes are Apple's — 1398 × 2034 on the 5.4" outer display and
 * 1878 × 2670 on the 7.6" inner one, both @3x, giving 466 × 678 pt and
 * 626 × 890 pt.
 *
 * The part that catches layouts out is where the system UI goes. The outer
 * display is wider and shorter than any other iPhone, so iOS moves the status
 * bar, the Dynamic Island and the browser's toolbars onto a strip down the
 * trailing edge to protect what vertical space there is. The inner display does
 * the same in landscape but keeps ordinary top and bottom bars in portrait,
 * where height isn't scarce. `sideControls` encodes that: 'always' |
 * 'landscape'. The strip stays on the right even in right-to-left languages,
 * because it's aligned to the camera rather than to the reading direction.
 *
 * Caveat worth knowing: the device doesn't reach anyone until 23 October 2026,
 * and Apple has published no numbers for the safe-area insets, the width of that
 * strip, or the Dynamic Island's vertical geometry — its guidance is explicitly
 * "query them at runtime, don't assume opposite edges match". The panel sizes
 * and the trailing-edge placement below are Apple's; `statusBar` here (the strip
 * width) is an estimate, so treat the drawn chrome as indicative until the
 * hardware and the iOS 27.1 simulator land.
 *
 * https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
 */
const DEVICES = [
  {
    id: 'iphone-duo-outer',
    name: 'iPhone Duo (Outer)',
    platform: 'ios',
    width: 466,
    height: 678,
    dpr: 3,
    bezel: 8,
    screenRadius: 44,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,      // the width of the side strip, not a height, when sideControls applies
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
    sideControls: 'always',
    controlEdge: 'right',
  },
  {
    id: 'iphone-duo-inner',
    name: 'iPhone Duo (Inner)',
    platform: 'ios',
    width: 626,
    height: 890,
    dpr: 3,
    bezel: 6,           // the inner bezel is barely there — it has to fold
    screenRadius: 34,
    front: UNDER_DISPLAY,
    buttons: 'iphone',
    statusBar: 48,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
    sideControls: 'landscape',
    controlEdge: 'right',
  },
  {
    // Half the inner display, which is where a lot of layouts will actually
    // land: Split View here is a fixed 50/50 with no draggable divider, so
    // 890 / 2 = 445 is the only width an app ever gets beside another one.
    // Apple sized it to be "roughly the same size and shape as the outer
    // screen", so the two are worth checking against each other.
    //
    // This models the left-hand app, and that flips the one thing the other
    // two Duo entries share: in Split View each app puts its controls on its
    // own *outer* edge, so the left app's strip is on the LEFT while every
    // other Duo state has it on the right. `foldEdge` marks where the display
    // simply carries on into the other app — no bezel, no rounded corner.
    id: 'iphone-duo-split',
    name: 'iPhone Duo (Split View)',
    platform: 'ios',
    width: 445,
    height: 626,
    dpr: 3,
    bezel: 6,
    screenRadius: 34,
    front: UNDER_DISPLAY,
    buttons: 'none',
    statusBar: 48,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
    sideControls: 'always',
    controlEdge: 'left',
    foldEdge: 'right',
  },
  {
    id: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    platform: 'ios',
    width: 440,
    height: 956,
    dpr: 3,
    bezel: 9,           // the 17 Pro's band is a touch thinner than the 16's
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,      // safe-area-inset-top, portrait
    homeIndicator: 34,  // safe-area-inset-bottom, portrait
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    platform: 'ios',
    width: 440,
    height: 956,
    dpr: 3,
    bezel: 10,          // titanium band thickness around the display
    screenRadius: 55,   // display corner radius
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-16-pro',
    name: 'iPhone 16 Pro',
    platform: 'ios',
    width: 402,
    height: 874,
    dpr: 3,
    bezel: 10,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-16-plus',
    name: 'iPhone 16 Plus',
    platform: 'ios',
    width: 430,
    height: 932,
    dpr: 3,
    bezel: 10,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 59,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-16',
    name: 'iPhone 16',
    platform: 'ios',
    width: 393,
    height: 852,
    dpr: 3,
    bezel: 10,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 59,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-15-pro-max',
    name: 'iPhone 15 Pro Max',
    platform: 'ios',
    width: 430,
    height: 932,
    dpr: 3,
    bezel: 10,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 59,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    // Same 2992 × 1344 panel as the Pixel 9 Pro XL, which DevTools lists at
    // 448 × 997 @3x.
    id: 'pixel-10-pro-xl',
    name: 'Pixel 10 Pro XL',
    platform: 'android',
    width: 448,
    height: 997,
    dpr: 3,
    bezel: 9,
    screenRadius: 42,   // Pixels are noticeably less rounded than iPhones
    front: { type: 'punch-hole', d: 12, top: 12 },
    buttons: 'pixel',
    statusBar: 36,      // Android status bar on a punch-hole Pixel
    homeIndicator: 24,  // gesture navigation area
    landscapeSafeArea: { top: 0, right: 36, bottom: 0, left: 36 },
  },
  {
    id: 'pixel-10-pro',
    name: 'Pixel 10 Pro',
    platform: 'android',
    width: 427,
    height: 952,
    dpr: 3,
    bezel: 9,
    screenRadius: 42,
    front: { type: 'punch-hole', d: 12, top: 12 },
    buttons: 'pixel',
    statusBar: 36,
    homeIndicator: 24,
    landscapeSafeArea: { top: 0, right: 36, bottom: 0, left: 36 },
  },
];

/**
 * User agents. Chromium is the engine either way — the UA only changes what
 * the server and any UA-sniffing JS believe they're talking to.
 *
 * The "iPhone OS 18_6" in every iOS string below is deliberate, not a leftover.
 * Apple froze that token at the final iOS 18 release when iOS 26 shipped, so a
 * real iPhone on iOS 26 still reports 18_6 and only `Version/` moves. Reading
 * the OS version out of the platform token has been useless ever since, which
 * is exactly the point of the freeze and worth being able to see here.
 *
 * Chrome does the same on Android: UA reduction pins every device to
 * "Android 10; K" whatever it really is, so a Pixel 10 Pro XL doesn't identify
 * its model or OS version at all.
 */
const USER_AGENTS = [
  {
    id: 'ios-safari',
    name: 'Safari · iOS 26',
    platform: 'iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  },
  {
    // iOS 27 lands 14 September 2026, and iPhone Duo ships on 27.1 in October.
    id: 'ios-safari-27',
    name: 'Safari · iOS 27',
    platform: 'iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  },
  {
    // CriOS carries Chrome for iOS's own major version, which moves every few
    // weeks — so the name here doesn't try to track it.
    id: 'ios-chrome',
    name: 'Chrome · iOS',
    platform: 'iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) CriOS/153.0.0.0 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android-chrome',
    name: 'Chrome · Android',
    platform: 'Linux armv8l',
    value:
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  },
];

const DEFAULTS = {
  deviceId: 'iphone-16-pro-max',
  browserId: 'chrome-ios',
  userAgentId: 'ios-chrome',
  orientation: 'portrait', // 'portrait' | 'landscape'
  zoom: 'fit',             // 'fit' | 1 | 0.85 | 0.75 | 0.5
  showChrome: true,        // draw the browser UI and shrink the viewport
  colorScheme: 'system',   // 'system' | 'light' | 'dark'
  url: '',                 // blank on a fresh install; nobody wants a stranger's site to load
  showMeta: false,         // the "440 × 776 css px · @3x · …" readout — View menu only
};

const byId = (list, id, fallback) => list.find((d) => d.id === id) || fallback || list[0];

module.exports = { DEVICES, USER_AGENTS, DEFAULTS, byId };

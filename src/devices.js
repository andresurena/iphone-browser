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

const IOS_LANDSCAPE_SAFE = { top: 0, right: 59, bottom: 21, left: 59 };

/**
 * iPhone Duo — Apple's first foldable, September 2026.
 *
 * One device with several `displays`, picked from a second menu that only
 * foldables get. Each display is a genuinely different target: the outer
 * display, the inner one, the inner one partially folded, and the inner one in
 * Split View with your page on either side. Orientation stays on the rotate
 * button, so every display comes in both.
 *
 * Screen sizes come from Apple's own bezel templates (Apple Design Resources):
 * 1398 × 2034 for the outer display and 2007 × 2853 for the inner, both @3x —
 * 466 × 678 pt and 669 × 951 pt. The inner figure is larger than the panel's
 * 1878 × 2670 pixels: it renders at 3× and downsamples, as the Plus phones did,
 * and 2007 × 2853 is also what App Store Connect asks for in screenshots.
 *
 * What catches layouts out is where the system UI goes. On the outer display,
 * and on the inner one in landscape, iOS runs the status bar, toolbar and tab
 * bar down the trailing edge instead of across the top and bottom (`rail`). The
 * inner display keeps ordinary horizontal bars in portrait. In Split View each
 * app puts its controls on its own outer edge, so the left-hand app's rail is on
 * the left.
 *
 * The drawn geometry — camera, rail spacing, divider, crease — is measured from
 * the diagrams in Apple's guidelines, not from hardware: the device ships on
 * 23 October 2026 and Apple has published no inset values. See
 * DUO_RAIL in shell.js, and treat those numbers as estimates until then.
 *
 * https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo
 */
const IPHONE_DUO = {
  id: 'iphone-duo',
  name: 'iPhone Duo',
  platform: 'ios',
  dpr: 3,
  buttons: 'none',        // the bezel images carry them
  browsers: ['safari'],   // the only browser Apple has shown on it; the rest are guesswork
  homeIndicator: 34,
  landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  displays: [
    {
      // Wider and shorter than any other iPhone. The hinge runs down the left
      // edge, which is why those corners are tight and the right ones generous;
      // the camera is a plain circle in the top-right corner, in line with the
      // rail beneath it.
      id: 'outer',
      name: 'Outer',
      width: 466,
      height: 678,
      bezel: 8,
      corners: { hinge: 9, free: 59 },
      hinge: 'left',
      camera: 'corner',
      rail: 'always',
      statusBar: 62,
    },
    {
      id: 'inner',
      name: 'Inner',
      width: 669,
      height: 951,
      bezel: 7,
      screenRadius: 55,
      camera: 'hidden',   // under the display, invisible unless in use
      rail: 'landscape',
      statusBar: 48,
    },
    {
      id: 'inner-folded',
      name: 'Inner, partially folded',
      of: 'inner',
      folded: true,
    },
    {
      id: 'split-leading',
      name: 'Split View, page on left',
      nameUpright: 'Split View, page on top',
      of: 'inner',
      split: 'leading',
    },
    {
      id: 'split-trailing',
      name: 'Split View, page on right',
      nameUpright: 'Split View, page on bottom',
      of: 'inner',
      split: 'trailing',
    },
    {
      // Media over an app: the video takes the top quarter and the app below
      // it runs on past the fold, as in Apple's Messages-under-a-video demo
      id: 'split-video',
      name: 'Split View, video on top',
      of: 'inner',
      split: 'trailing',
      splitRatio: 0.25,
      orientation: 'portrait',
    },

    // Poses — Beta. The device drawn in three dimensions the way Apple's
    // "device poses" diagram shows it held or set down. Each pose fixes the
    // orientation, because the hinge is what makes it: a book stands on its
    // long edge, a laptop on its short one. The page is emulated exactly as on
    // the flat display underneath — Safari has no fold-detection API, so this
    // is what a site would actually get. Beta because Apple has published no
    // guidance for web content in any pose; see POSES in shell/duo.js.
    {
      id: 'pose-book',
      name: 'Book, half open',
      of: 'inner',
      pose: 'book',
      orientation: 'landscape',
      beta: true,
    },
    {
      // The book with the website on the right half only and another app on
      // the half turned away — how a site actually sits in a book pose when
      // it's sharing the display, rather than spread across the hinge
      id: 'pose-book-beside',
      name: 'Book, beside another app',
      of: 'inner',
      pose: 'book',
      split: 'trailing',
      placeholderOther: true,
      orientation: 'landscape',
      beta: true,
    },
    {
      id: 'pose-laptop',
      name: 'Laptop, on a surface',
      of: 'inner',
      pose: 'laptop',
      orientation: 'portrait',
      beta: true,
    },
    {
      id: 'pose-tent',
      name: 'Tent, standing',
      of: 'outer',
      pose: 'tent',
      orientation: 'landscape',
      beta: true,
    },
  ],
};

// Newest first within each platform. The device menu opens upward from the
// bottom bar, so this puts the oldest device nearest the button.
/**
 * Apple HomeView — the smart display, announced 13 October 2026, on sale
 * 13 November. Beta: Apple has published the panel (1088 × 1088 px at 220 ppi,
 * 7-inch, rounded corners) and that Safari is built in, and nothing else that
 * a web page would need. Every other number here is an inference:
 *
 * - 544 × 544 pt at 2x is read from the density. 220 ppi at 1x would be twice
 *   as fine as any Apple screen, unreadable from across a kitchen; at 2x it's
 *   a little coarser than an iPad, which suits a display meant to be glanced
 *   at from a distance. Apple hasn't said. (A beta asset named
 *   `apple-logo-1088@2x~home.png` has been read both ways.)
 * - The bezel (36 pt), the metal rim (7 pt), the screen's corners (72 pt) and
 *   the camera's place in the top bezel are measured from Apple's straight-on
 *   product image, scaled to the 544 pt reading above.
 * - No status bar and no home indicator are drawn: none shows in any of
 *   Apple's images, and the clock and controls on the faces are face content.
 *   The safe area is reported as zero all round for the same reason.
 * - Safari's own bars on it are undocumented; the iOS 26 Safari skin stands in.
 *
 * The screen is square and the device only tilts, so there is no rotation.
 * https://www.apple.com/apple-homeview/specs/
 */
const APPLE_HOMEVIEW = {
  id: 'apple-homeview',
  name: 'Apple HomeView',
  platform: 'ios',        // Safari, iOS-derived software ("version 27.2")
  family: 'home',         // its own group in the device menu
  browsers: ['safari'],
  frame: 'homeview',      // drawn by its own CSS: metal rim, black bezel, dome base
  foot: 96,               // room below the frame for the base
  orientation: 'portrait',
  fixedNote: 'Apple HomeView only tilts — its square screen doesn\u2019t rotate.',
  width: 544,
  height: 544,
  dpr: 2,
  bezel: 43,              // 36 bezel + 7 rim; the CSS splits them
  screenRadius: 72,
  front: { type: 'none', w: 0, h: 0, top: 0 },   // the camera sits in the bezel
  buttons: 'none',
  statusBar: 0,
  homeIndicator: 0,
  landscapeSafeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  beta: true,
};

const DEVICES = [
  IPHONE_DUO,
  APPLE_HOMEVIEW,
  {
    // Announced 9 Sept 2026, on sale 18 Sept. Apple's published panel is
    // 2868 x 1320 at 460ppi, which is the 17 Pro Max's exactly — so the page
    // sees the same 440 x 956 at 3x, and the insets carry over with it. The
    // 17 Pro and 17 Pro Max were discontinued the day this was announced.
    id: 'iphone-18-pro-max',
    name: 'iPhone 18 Pro Max',
    platform: 'ios',
    width: 440,
    height: 956,
    dpr: 3,
    bezel: 9,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
  },
  {
    id: 'iphone-18-pro',
    name: 'iPhone 18 Pro',
    platform: 'ios',
    width: 402,
    height: 874,        // Apple's 2622 x 1206 panel at 3x
    dpr: 3,
    bezel: 9,
    screenRadius: 55,
    front: ISLAND,
    buttons: 'iphone',
    statusBar: 62,
    homeIndicator: 34,
    landscapeSafeArea: IOS_LANDSCAPE_SAFE,
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

  displays: {},            // chosen display per foldable, e.g. { 'iphone-duo': 'outer' }

  // Settings. Hidden devices and browsers are stored as the ones switched OFF,
  // so anything added to the catalogue later shows up without anyone having to
  // go and turn it on.
  disabledDevices: [],
  disabledBrowsers: [],
  restoreLast: true,       // reopen on the last device used, or on startDeviceId
  startDeviceId: 'iphone-16-pro-max',
  advanced: false,         // shows the Profile (user agent) menu and Web Inspector button
  compare: false,          // two tabs side by side — see compare.js
};

const byId = (list, id, fallback) => list.find((d) => d.id === id) || fallback || list[0];

module.exports = { DEVICES, USER_AGENTS, DEFAULTS, byId };

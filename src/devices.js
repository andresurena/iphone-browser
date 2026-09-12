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

const DEVICES = [
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
 */
const USER_AGENTS = [
  {
    id: 'ios-safari',
    name: 'Safari · iOS 18',
    platform: 'iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'ios-chrome',
    name: 'Chrome · iOS 18',
    platform: 'iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) CriOS/137.0.7151.107 Mobile/15E148 Safari/604.1',
  },
  {
    id: 'android-chrome',
    name: 'Chrome · Android 16',
    platform: 'Linux armv8l',
    value:
      'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro XL) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
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
  url: 'https://andresurena.com',
  showMeta: false,         // the "440 × 776 css px · @3x · …" readout — View menu only
};

const byId = (list, id, fallback) => list.find((d) => d.id === id) || fallback || list[0];

module.exports = { DEVICES, USER_AGENTS, DEFAULTS, byId };

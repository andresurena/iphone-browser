'use strict'

/**
 * Browser UI skins.
 *
 * Each skin draws its own chrome and, more importantly, takes its own bite out
 * of the screen — so the page gets a different amount of room in each. Heights
 * are in points/dp.
 *
 * `top` and `bottom` are the browser's own bars, and the page is laid out
 * between them. The platform status bar is added on top of `top` separately
 * (see geometry() in shell.js) because it belongs to the OS, not the browser.
 *
 * `floating` is the iOS 26 model: the bar hovers over the page as a glass
 * capsule instead of reserving space, so the page keeps the full height and
 * gets the capsule's footprint reported as safe-area-inset-bottom instead.
 *
 * `statusTint` says where the status bar takes its colour from: the page's
 * theme-colour ('page', what Safari and Chrome on Android do) or the browser's
 * own toolbar ('neutral', what Chrome and Vivaldi on iOS do).
 */

const BROWSERS = [
  {
    id: 'chrome-ios',
    since: 2012,        // first release on the platform — orders the browser menu
    name: 'Chrome',
    platform: 'ios',
    userAgentId: 'ios-chrome',
    statusTint: 'neutral',
    chrome: {
      // omnibox on top (44), back/forward/new tab/tabs/menu below (74)
      portrait: { top: 44, bottom: 74 },
      landscape: { top: 44, bottom: 48, side: 59 },
    },
  },
  {
    id: 'safari',
    since: 2007,        // first release on the platform — orders the browser menu
    name: 'Safari',
    platform: 'ios',
    userAgentId: 'ios-safari',
    statusTint: 'page',
    chrome: {
      // iOS 26: a floating glass capsule the page scrolls underneath
      portrait: { top: 0, bottom: 0, floating: 88 },
      landscape: { top: 0, bottom: 0, floating: 68, side: 59 },
    },
  },
  {
    id: 'vivaldi',
    since: 2022,        // first release on the platform — orders the browser menu
    name: 'Vivaldi',
    platform: 'ios',
    // Browsers on iOS are all WebKit and don't advertise themselves
    // separately, so the user agent stays Safari's.
    userAgentId: 'ios-safari',
    statusTint: 'neutral',
    chrome: {
      // search field row (60) + toolbar row (52) + home indicator zone (14)
      portrait: { top: 0, bottom: 126 },
      landscape: { top: 52, bottom: 0, side: 59 },
    },
  },
  {
    id: 'chrome-android',
    since: 2012,        // first release on the platform — orders the browser menu
    name: 'Chrome',
    platform: 'android',
    userAgentId: 'android-chrome',
    statusTint: 'page',
    chrome: {
      // Android puts the omnibox at the top; the bottom is the gesture area
      portrait: { top: 56, bottom: 24 },
      landscape: { top: 56, bottom: 24 },
    },
  },
];

const forPlatform = (platform) => BROWSERS.filter((b) => b.platform === platform);

module.exports = { BROWSERS, forPlatform };

# iPhone Browser

**A native Mac app that behaves like the browser on your phone.**

This probably exists already. But every version I found was buried inside
Developer Tools, or meant syncing through iPhone Mirroring — which doesn't
always work. I wanted something simpler: a small Chromium browser where I can
check the sites and projects I'm building on a phone-shaped screen, without the
ceremony.

So I built it. It's massively simple (and it was fun). Open sourcing it to all.

![iPhone Browser running andresurena.com in the Chrome for iOS interface](docs/screenshot-chrome-ios.png)

It isn't a mockup with a screenshot inside it. It's a live browser running under
the same device-emulation engine Chrome DevTools uses, so the viewport, pixel
ratio, touch events, safe-area insets and user agent all behave like the real
device.

## Running it

```bash
npm install
npm start
```

To get an actual app you can keep in your Dock:

```bash
npm run dist
```

That writes `iPhone Browser.app` into `dist/mac-arm64/` — drag it to
/Applications. Building it yourself means macOS treats it as a local app and
opens it without any Gatekeeper complaints.

## What it emulates

Measured from the running app on an iPhone 16 Pro Max:

| | value |
|---|---|
| Viewport · Chrome for iOS | 440 × 776 CSS px |
| Viewport · Safari (iOS 26) | 440 × 894 CSS px |
| Viewport · Vivaldi | 440 × 768 CSS px |
| Viewport · no browser UI | 440 × 956 CSS px |
| Landscape | 838 × 392 CSS px |
| `window.screen` | 440 × 956 |
| `devicePixelRatio` | 3 |
| Touch | `ontouchstart`, `maxTouchPoints: 5`, mouse drags become touch drags |
| Media queries | `pointer: coarse`, `hover: none` |
| `env(safe-area-inset-*)` | real — 62/0/34/0 fullscreen, 0/0/88/0 under Safari's floating bar |
| Page with no `<meta viewport>` | falls back to a 980 px layout, like a real phone |

## Controls

Top bar: back, forward, reload, address field.
Bottom bar: device, browser interface, user agent, zoom, then rotate / browser
UI / colour scheme / screenshot / Web Inspector.

| | |
|---|---|
| ⌘L | focus the address field |
| ⌘R / ⌘⇧R | reload / reload ignoring cache |
| ⌘[ / ⌘] | back / forward |
| ⌘⌃R | rotate |
| ⌘⇧B | show or hide the browser interface |
| ⌘0 … ⌘4 | zoom: fit, 100%, 85%, 75%, 50% |
| ⌘⇧1 … ⌘⇧8 | switch device |
| ⌘S / ⌘⇧S | screenshot / full-page screenshot to the Desktop |
| ⌘⌥I | Web Inspector for the page |
| ⌘⌥⇧I | inspect the app's own UI |

Type `3000` in the address field to open `http://localhost:3000`, or
`localhost:5173/some/path`. Anything without a dot becomes a search.

Screenshots go to the Desktop at true device resolution — 1320 × 2868 physical
pixels for a full iPhone 16 Pro Max screen, not your Mac's scale factor.
⌥-click the camera (or ⌘⇧S) to capture the whole scrollable page.

Self-signed certificates on `localhost`, `*.local` and private LAN addresses are
accepted automatically, so an HTTPS dev server just works.

## Devices

| Device | Viewport | DPR |
|---|---|---|
| iPhone 17 Pro Max | 440 × 956 | 3 |
| iPhone 16 Pro Max | 440 × 956 | 3 |
| iPhone 16 Pro | 402 × 874 | 3 |
| iPhone 16 Plus | 430 × 932 | 3 |
| iPhone 16 | 393 × 852 | 3 |
| iPhone 15 Pro Max | 430 × 932 | 3 |
| Pixel 10 Pro XL | 448 × 997 | 3 |
| Pixel 10 Pro | 427 × 952 | 3 |

Every viewport matches Chrome DevTools' own device list, so a page measured here
measures the same in DevTools' device toolbar.

## Browser interfaces

The interface you pick changes the drawn chrome *and* how much screen the page
gets — which is the point, because they genuinely differ:

| Interface | Chrome it draws | Viewport (16 Pro Max) |
|---|---|---|
| **Chrome** (iOS, default) | omnibox on top, toolbar below | 440 × 776 |
| **Safari** (iOS 26) | floating glass capsule the page scrolls under | 440 × 894 |
| **Vivaldi** (iOS) | search field + toolbar stack | 440 × 768 |
| **Chrome** (Android) | omnibox on top, gesture strip below | 448 × 881 on a Pixel |

Pick an Android device and the interface and user agent switch to Chrome for
Android automatically, and back again for an iPhone. The user agent stays
overridable on its own if you want an odd combination.

Safari and Chrome for Android tint the status bar from the page's
`theme-color`, like the real ones do. Chrome and Vivaldi on iOS colour it from
their own toolbar instead, which is also what the real ones do.

<p align="center">
  <img src="docs/screenshot-safari.png" width="45%" alt="Safari's iOS 26 floating glass bar">
  <img src="docs/screenshot-pixel.png" width="45%" alt="Pixel 10 Pro XL with Chrome for Android">
</p>

## Adding a device

Everything lives in [`src/devices.js`](src/devices.js) — copy a block, change
the numbers. The picker, the menu and the drawn frame all read from it, and the
frame is drawn in CSS so it scales to whatever size you give it.

Browser bar heights live in [`src/browsers.js`](src/browsers.js). These are
close approximations of the shipping apps; if a vendor moves something in a
later release, edit those numbers rather than the layout code.

## Known limitations

- **It is Chromium, not WebKit.** The layout engine, JS engine and CSS support
  are Chrome's. Setting the user agent to Safari changes what servers and
  UA-sniffing scripts see, not how the page is actually rendered. For genuine
  WebKit rendering bugs you still want Safari's own responsive design mode or a
  real device. This app is for layout, breakpoints, safe areas and touch flows.
- The browser UI is a drawing, not a browser. The address pill, share and tab
  buttons are decorative; back, forward and reload in them do work.
- Safari's iOS 26 floating bar is modelled as an overlay that reserves no layout
  space and reports its footprint as `safe-area-inset-bottom`. That matches the
  design intent; the exact height a shipping iOS build reports may drift.
- Landscape chrome is simplified to a single top bar for Vivaldi.
- Browsers on iOS are all WebKit underneath and don't advertise themselves, so
  the iOS skins send Safari-family user agents.
- Status bar readings — signal, Wi-Fi, battery — are drawn full. They're
  furniture, not live system state. The clock is real.
- Opening the Web Inspector briefly suspends touch emulation, because DevTools
  and the emulation share one debugging channel. It's restored when you close it.

## How it works

- `src/main.js` — Electron main process. Owns the window, applies emulation over
  the Chrome DevTools Protocol (`Emulation.setDeviceMetricsOverride`,
  `setTouchEmulationEnabled`, `setUserAgentOverride`,
  `setSafeAreaInsetsOverride`, `setEmulatedMedia`), takes screenshots via
  `Page.captureScreenshot`, and persists settings.
- `src/shell/` — the app's own UI: toolbar, the CSS device frame, and a
  `<webview>` holding the page. Emulation calls are serialised so two rapid
  setting changes can't land out of order.
- `src/devices.js` — the device and user-agent catalogue.
- `src/browsers.js` — the browser interface skins.
- `scripts/make-icon.js` — renders the app icon with Electron itself and packs
  it into `build/icon.icns`, so there's no image toolchain to install.

Built with [Claude Code](https://claude.com/claude-code).

## Licence

MIT — see [LICENSE](LICENSE). Do what you like with it.

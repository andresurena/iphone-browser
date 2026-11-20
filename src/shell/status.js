'use strict'

/* ============================================================ status icons
   Two small touches of life in the drawn status bar, both switchable off in
   Settings › General ("Live status icons"):

   · the battery follows this Mac's — its level, green while it's plugged in,
     red when it's nearly flat. A Mac with no battery reads as full and on
     charge, so a desktop's phone is simply always charging.
   · the signal dips now and then — down two bars, back up one, back to full —
     the way a phone's does when you weren't looking at it.

   Neither reaches the page: this is the drawn frame only. navigator.getBattery
   in a page still answers whatever Chromium says, and screenshots are of the
   page, so they never include these.

   A classic script loaded before shell.js; it shares that file's globals and
   only touches them from inside functions. */

const SIGNAL_FULL = 4;          // iOS, Android and the Duo's glyph all draw four steps
const IOS_BATT_FILL_W = 192.9;  // the full widths of the fill rects in index.html

let battery = { level: 1, charging: false };
let signal = SIGNAL_FULL;

function statusLive() { return S.liveStatus !== false; }

function paintStatusIcons() {
  const live = statusLive();
  const level = live ? Math.max(0.04, Math.min(1, battery.level)) : 1;
  const charging = live && battery.charging;
  const low = live && !charging && level <= 0.2;
  const bars = live ? signal : SIGNAL_FULL;

  for (const el of all('#phone .si.batt')) {
    el.querySelector('.fill')?.setAttribute('width', (IOS_BATT_FILL_W * level).toFixed(2));
    el.classList.toggle('charging', charging);
    el.classList.toggle('low', low);
  }
  // Android's battery is one solid glyph: the charge is that glyph again,
  // clipped to its level. The body is 720 of the glyph's 800 units; the last
  // 80 are the cap, which only a full battery reaches.
  for (const el of all('#phone .si.batt-md')) {
    el.querySelector('svg.level')?.setAttribute('width', level >= 0.995 ? '800' : (720 * level).toFixed(1));
    el.classList.toggle('charging', charging);
    el.classList.toggle('low', low);
  }
  for (const el of all('#phone .si.sig')) {
    [...el.querySelectorAll('.bar')].forEach((bar, i) => { bar.style.opacity = i < bars ? '' : '.3'; });
  }
  // Android's signal is one wedge that fills from its point
  for (const el of all('#phone .si.sig-md svg.level')) {
    el.setAttribute('width', (744 * bars / SIGNAL_FULL).toFixed(1));
  }
  // iPhone Duo's round glyph: the ring is the battery, the dots the signal
  for (const el of all('#phone .duo-glyph')) {
    const ring = el.querySelector('.ring.level');
    if (ring) ring.style.strokeDasharray = `${(level * 100).toFixed(1)} 100`;
    el.classList.toggle('charging', charging);
    el.classList.toggle('low', low);
    [...el.querySelectorAll('.dot')].forEach((dot, i) => { dot.style.opacity = i < bars ? '' : '.3'; });
  }
}

/** Down two, up one, up to full — then quiet for a minute or three. */
function wanderSignal() {
  const pause = (min, spread) => min + Math.random() * spread;
  const step = (bars, after) => setTimeout(() => { signal = bars; paintStatusIcons(); }, after);
  setTimeout(() => {
    if (statusLive() && !document.hidden) {
      const hold = pause(2500, 2500);
      step(SIGNAL_FULL - 2, 0);
      step(SIGNAL_FULL - 1, hold);
      step(SIGNAL_FULL, hold * 2);
    }
    wanderSignal();
  }, pause(50000, 130000));
}

async function wireStatusIcons() {
  wanderSignal();
  try {
    const mac = await navigator.getBattery();
    const read = () => {
      battery = { level: mac.level, charging: mac.charging };
      paintStatusIcons();
    };
    mac.addEventListener('levelchange', read);
    mac.addEventListener('chargingchange', read);
    read();
  } catch {
    // no battery API: stays as drawn, full
    paintStatusIcons();
  }
}

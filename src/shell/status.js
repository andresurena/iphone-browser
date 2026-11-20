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
const MD_BATT_FILL_W = 18.2;

let battery = { level: 1, charging: false };
let signal = SIGNAL_FULL;

function statusLive() { return S.liveStatus !== false; }

function paintStatusIcons() {
  const live = statusLive();
  const level = live ? Math.max(0.04, Math.min(1, battery.level)) : 1;
  const charging = live && battery.charging;
  const low = live && !charging && level <= 0.2;
  const bars = live ? signal : SIGNAL_FULL;

  for (const el of all('#phone .si.batt, #phone .si.batt-md')) {
    const full = el.classList.contains('batt') ? IOS_BATT_FILL_W : MD_BATT_FILL_W;
    el.querySelector('.fill')?.setAttribute('width', (full * level).toFixed(2));
    el.classList.toggle('charging', charging);
    el.classList.toggle('low', low);
  }
  for (const el of all('#phone .si.sig')) {
    [...el.querySelectorAll('.bar')].forEach((bar, i) => { bar.style.opacity = i < bars ? '' : '.3'; });
  }
  // Android's signal is one wedge that fills from its point
  for (const el of all('#phone .si.sig-md .level')) {
    const run = 14 * (bars / SIGNAL_FULL);
    el.setAttribute('d', `M1 15h${run}V${15 - run}z`);
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

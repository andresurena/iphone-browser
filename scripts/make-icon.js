'use strict'

/**
 * Renders the app icon with Electron itself (no image dependencies) and
 * packs it into build/icon.icns.
 *
 *   npm run icon
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const OUT = path.join(__dirname, '..', 'build');
const ICONSET = path.join(OUT, 'icon.iconset');

// logical size -> iconset filenames
const MAP = {
  16: ['icon_16x16.png'],
  32: ['icon_16x16@2x.png', 'icon_32x32.png'],
  64: ['icon_32x32@2x.png'],
  128: ['icon_128x128.png'],
  256: ['icon_128x128@2x.png', 'icon_256x256.png'],
  512: ['icon_256x256@2x.png', 'icon_512x512.png'],
  1024: ['icon_512x512@2x.png'],
};

const markup = `
<style>
  html, body { margin: 0; background: transparent; }
  .icon {
    width: 1024px; height: 1024px;
    display: grid; place-items: center;
  }
  /* graphite body, the way most developer tools sit in a Dock */
  .squircle {
    width: 824px; height: 824px;
    border-radius: 185px;
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,.09), transparent 55%),
      linear-gradient(160deg, #3d3d45 0%, #25252b 52%, #151519 100%);
    box-shadow:
      0 0 0 6px rgba(255,255,255,.05) inset,
      0 1px 0 rgba(255,255,255,.12) inset,
      0 24px 60px rgba(0,0,0,.45);
  }
  /* Two viewports — a tall one and a wide one — overlapping off-centre: one
     page, two very different screens. Their shared area gets its own tone. */
  .panel { position: absolute; border-radius: 42px; }
  .tall {
    left: 132px; top: 150px; width: 300px; height: 480px;
    background: linear-gradient(170deg, #f4f5f9, #dfe1e8);
    box-shadow: 0 18px 40px rgba(0,0,0,.35);
  }
  .wide {
    left: 282px; top: 400px; width: 420px; height: 290px;
    background: linear-gradient(160deg, #ff5f95 0%, #f2296f 60%, #d91c5f 100%);
    box-shadow: 0 18px 44px rgba(233, 38, 108, .40), 0 2px 0 rgba(255,255,255,.18) inset;
  }
  .both {
    left: 282px; top: 400px; width: 150px; height: 230px;
    border-radius: 42px 0 42px 0;
    background: linear-gradient(160deg, #ffd6e3, #ffb7cd);
  }
</style>
<div class="icon">
  <div class="squircle">
    <div class="panel tall"></div>
    <div class="panel wide"></div>
    <div class="panel both"></div>
  </div>
</div>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.rmSync(ICONSET, { recursive: true, force: true });
  fs.mkdirSync(ICONSET, { recursive: true });

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(markup));
  await new Promise((r) => setTimeout(r, 400));

  const full = await win.webContents.capturePage();

  for (const [size, names] of Object.entries(MAP)) {
    const n = Number(size);
    const png = full.resize({ width: n, height: n, quality: 'best' }).toPNG();
    for (const name of names) fs.writeFileSync(path.join(ICONSET, name), png);
  }

  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', path.join(OUT, 'icon.icns')]);
  fs.rmSync(ICONSET, { recursive: true, force: true });

  console.log('wrote', path.join(OUT, 'icon.icns'));
  win.destroy();
  app.quit();
});

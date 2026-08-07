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
  .squircle {
    width: 840px; height: 840px;
    border-radius: 190px;
    background: linear-gradient(160deg, #3a3a44 0%, #191920 55%, #0d0d12 100%);
    box-shadow:
      0 0 0 6px rgba(255,255,255,.06) inset,
      0 24px 60px rgba(0,0,0,.45);
    display: grid; place-items: center;
  }
  .phone {
    width: 330px; height: 620px;
    border-radius: 78px;
    background: #ffffff;
    padding: 13px;
    box-shadow: 0 10px 40px rgba(0,0,0,.5);
  }
  .screen {
    width: 100%; height: 100%;
    border-radius: 66px;
    background: linear-gradient(180deg, #0a84ff 0%, #0a63d6 100%);
    position: relative;
    overflow: hidden;
  }
  .island {
    position: absolute; left: 50%; top: 18px;
    transform: translateX(-50%);
    width: 108px; height: 32px;
    border-radius: 99px; background: #101014;
  }
  .line { position: absolute; left: 34px; height: 16px; border-radius: 9px; background: rgba(255,255,255,.9); }
  .l1 { top: 150px; width: 210px; }
  .l2 { top: 196px; width: 150px; opacity: .75; }
  .card { position: absolute; left: 34px; top: 250px; width: 236px; height: 150px; border-radius: 26px; background: rgba(255,255,255,.28); }
  .l3 { top: 430px; width: 236px; opacity: .6; }
  .l4 { top: 476px; width: 170px; opacity: .45; }
</style>
<div class="icon">
  <div class="squircle">
    <div class="phone">
      <div class="screen">
        <div class="island"></div>
        <div class="line l1"></div>
        <div class="line l2"></div>
        <div class="card"></div>
        <div class="line l3"></div>
        <div class="line l4"></div>
      </div>
    </div>
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

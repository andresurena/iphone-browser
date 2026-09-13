'use strict'

const { contextBridge, ipcRenderer } = require('electron');

const MENU_CHANNELS = [
  'menu:reload',
  'menu:hard-reload',
  'menu:back',
  'menu:forward',
  'menu:focus-url',
  'menu:devtools',
  'menu:rotate',
  'menu:toggle-chrome',
  'menu:screenshot',
  'menu:zoom',
  'menu:device',
  'menu:reapply-emulation',
  'menu:toggle-meta',
  'menu:new-tab',
  'menu:close-tab',
  'menu:settings',
];

contextBridge.exposeInMainWorld('bridge', {
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.invoke('state:set', patch),
  emulate: (wcId, opts) => ipcRenderer.invoke('emulate', wcId, opts),
  toggleDevTools: (wcId) => ipcRenderer.invoke('devtools:toggle', wcId),
  screenshot: (wcId, meta) => ipcRenderer.invoke('screenshot', wcId, meta),
  captureTile: (wcId) => ipcRenderer.invoke('capture-tile', wcId),
  reveal: (filePath) => ipcRenderer.invoke('reveal', filePath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  reportPageRects: (rects) => ipcRenderer.send('pages:rects', rects),
  getOpenAtLogin: () => ipcRenderer.invoke('login:get'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('login:set', on),

  onMenu: (handler) => {
    for (const channel of MENU_CHANNELS) {
      ipcRenderer.on(channel, (_e, payload) =>
        handler(channel.replace('menu:', ''), payload));
    }
  },
});

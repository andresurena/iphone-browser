'use strict'

const { app, Menu, shell } = require('electron');
const { DEVICES } = require('./devices');

/**
 * @param {() => Electron.BrowserWindow | null} getWin
 */
module.exports = function buildMenu(getWin) {
  const to = (channel, payload) => () => {
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: to('menu:settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'Cmd+T', click: to('menu:new-tab') },
        // Cmd+W closes the active TAB, not the window — Electron's `role: 'close'`
        // claims Cmd+W by default for closing the window, so it's deliberately
        // not used here; "Close Window" below gets its own shortcut instead. With
        // only one tab open, the renderer treats this as closing the window too,
        // matching how Safari and Chrome behave once there's nothing left to close.
        { label: 'Close Tab', accelerator: 'Cmd+W', click: to('menu:close-tab') },
        { type: 'separator' },
        { label: 'Open Location…', accelerator: 'Cmd+L', click: to('menu:focus-url') },
        { type: 'separator' },
        {
          label: 'Save Screenshot to Desktop',
          accelerator: 'Cmd+S',
          click: to('menu:screenshot'),
        },
        {
          label: 'Save Full-Page Screenshot to Desktop',
          accelerator: 'Cmd+Shift+S',
          click: to('menu:screenshot', { fullPage: true }),
        },
        { type: 'separator' },
        {
          label: 'Clear Browsing Data…',
          click: to('menu:clear-browsing-data'),
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'Cmd+Shift+W',
          click: () => {
            const win = getWin();
            if (win && !win.isDestroyed()) win.close();
          },
        },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'Cmd+R', click: to('menu:reload') },
        { label: 'Reload Ignoring Cache', accelerator: 'Cmd+Shift+R', click: to('menu:hard-reload') },
        { type: 'separator' },
        { label: 'Back', accelerator: 'Cmd+[', click: to('menu:back') },
        { label: 'Forward', accelerator: 'Cmd+]', click: to('menu:forward') },
        { type: 'separator' },
        { label: 'Rotate', accelerator: 'Cmd+Ctrl+R', click: to('menu:rotate') },
        { label: 'Show Browser Interface', accelerator: 'Cmd+Shift+B', click: to('menu:toggle-chrome') },
        { label: 'Show Technical Info', accelerator: 'Cmd+/', click: to('menu:toggle-meta') },
        {
          label: 'Compare Two Tabs Side by Side',
          accelerator: 'Cmd+Shift+C',
          click: to('menu:toggle-compare'),
        },
        { type: 'separator' },
        {
          label: 'Zoom',
          submenu: [
            { label: 'Fit to Window', accelerator: 'Cmd+0', click: to('menu:zoom', 'fit') },
            { label: 'Actual Size (100%)', accelerator: 'Cmd+1', click: to('menu:zoom', 1) },
            { label: '85%', accelerator: 'Cmd+2', click: to('menu:zoom', 0.85) },
            { label: '75%', accelerator: 'Cmd+3', click: to('menu:zoom', 0.75) },
            { label: '50%', accelerator: 'Cmd+4', click: to('menu:zoom', 0.5) },
          ],
        },
        {
          label: 'Device',
          submenu: DEVICES.map((d, i) => ({
            label: d.name,
            accelerator: i < 9 ? `Cmd+Shift+${i + 1}` : undefined,
            click: to('menu:device', d.id),
          })),
        },
        { type: 'separator' },
        {
          label: 'Web Inspector',
          accelerator: 'Cmd+Alt+I',
          click: to('menu:devtools'),
        },
        {
          label: 'Inspect App Shell',
          accelerator: 'Cmd+Alt+Shift+I',
          click: () => {
            const win = getWin();
            if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
          },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'iOS Human Interface Guidelines',
          click: () => shell.openExternal(
            'https://developer.apple.com/design/human-interface-guidelines/designing-for-ios'),
        },
        {
          label: 'Apple Design Resources (device bezels)',
          click: () => shell.openExternal('https://developer.apple.com/design/resources/'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

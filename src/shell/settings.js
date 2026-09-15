'use strict'

/* ============================================================== settings
   The panel behind the gear: General, Devices, Browsers, About. Shares
   shell.js's globals and helpers (S, set, pickDevice, …). */

const PLATFORM_LABELS = { ios: 'iPhone', android: 'Android' };

function openSettings(tab = 'general') {
  closeMenu();
  showSettingsTab(tab);
  renderSettings();
  $('settings').hidden = false;
  reportPageRects();
  // Start at Login lives with the OS, not in state.json — ask it each time
  window.bridge.getOpenAtLogin().then((on) => { $('setLogin').checked = on; });
  $('settings').querySelector('[role="tab"][aria-selected="true"]').focus();
}

function closeSettings() {
  if ($('settings').hidden) return;
  closeMenu();
  $('settings').hidden = true;
  reportPageRects();
  $('settingsBtn').focus();
}

function showSettingsTab(name) {
  for (const t of all('#settings [role="tab"]')) {
    const on = t.dataset.pane === name;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const p of all('#settings .settings-pane')) p.hidden = p.dataset.pane !== name;
}

function renderSettings() {
  $('setRestore').checked = S.restoreLast;
  $('setAdvanced').checked = S.advanced;
  $('startDeviceRow').hidden = S.restoreLast;
  $('startDeviceMenu').querySelector('.label').textContent = deviceById(S.startDeviceId).name;
  renderDeviceToggles();
  renderBrowserToggles();
}

/**
 * One switch per row. The last one left on can't be turned off: an empty
 * device or browser menu would leave the app with nothing to show.
 */
function toggleRow({ title, hint, checked, locked, onChange }) {
  const row = document.createElement('label');
  row.className = 'settings-row';
  const text = document.createElement('span');
  text.className = 'row-text';
  text.innerHTML = '<span class="row-title"></span><span class="row-hint"></span>';
  text.querySelector('.row-title').textContent = title;
  text.querySelector('.row-hint').textContent = locked ? 'At least one has to stay on' : (hint || '');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.checked = checked;
  input.disabled = locked;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(text, input);
  return row;
}

function groupHeading(label) {
  const h = document.createElement('h4');
  h.className = 'settings-group';
  h.textContent = label;
  return h;
}

function renderDeviceToggles() {
  const box = $('deviceToggles');
  box.innerHTML = '';
  const onCount = enabledDevices().length;
  for (const platform of ['ios', 'android']) {
    const list = DEVICES.filter((d) => d.platform === platform);
    if (!list.length) continue;
    box.appendChild(groupHeading(PLATFORM_LABELS[platform]));
    for (const d of list) {
      const on = isDeviceOn(d.id);
      box.appendChild(toggleRow({
        title: d.name,
        hint: d.displays ? d.displays.map((x) => x.name).join(' · ') : `${d.width} × ${d.height}`,
        checked: on,
        locked: on && onCount === 1,
        onChange: (next) => toggleDevice(d.id, next),
      }));
    }
  }
}

function renderBrowserToggles() {
  const box = $('browserToggles');
  box.innerHTML = '';
  for (const platform of ['ios', 'android']) {
    const list = browsersFor(platform);
    if (!list.length) continue;
    box.appendChild(groupHeading(PLATFORM_LABELS[platform]));
    const onCount = enabledBrowsersFor(platform).length;
    for (const b of list) {
      const on = isBrowserOn(b.id);
      box.appendChild(toggleRow({
        title: b.name,
        checked: on,
        locked: on && onCount === 1,
        onChange: (next) => toggleBrowser(b.id, next),
      }));
    }
  }
}

function toggleDevice(id, on) {
  const off = new Set(S.disabledDevices);
  if (on) off.delete(id); else off.add(id);
  set({ disabledDevices: [...off] }, { relayout: false });

  if (!on) {
    const fallback = enabledDevices()[0];
    if (S.startDeviceId === id) set({ startDeviceId: fallback.id }, { relayout: false });
    if (deviceEntry.id === id) pickDevice(fallback.id);
  }
  renderSettings();
}

function toggleBrowser(id, on) {
  const off = new Set(S.disabledBrowsers);
  if (on) off.delete(id); else off.add(id);
  set({ disabledBrowsers: [...off] }, { relayout: false });

  if (!on && browser.id === id) pickBrowser(enabledBrowsersFor(deviceEntry)[0].id);
  renderSettings();
}

function setAdvanced(on) {
  set({ advanced: on }, { relayout: false });
  document.body.classList.toggle('advanced', on);
  // Without the Profile menu there'd be no way to see an override, let alone
  // undo it — so the user agent goes back to following the browser.
  if (!on && S.userAgentId !== browser.userAgentId) {
    if (applyUa({ userAgentId: browser.userAgentId })) reloadShown();
    layout();
  }
}

function wireSettings() {
  $('settingsBtn').onclick = () => openSettings();
  $('settingsClose').onclick = closeSettings;
  $('settings').addEventListener('mousedown', (e) => {
    if (e.target === $('settings')) closeSettings();   // the backdrop, not the card
  });

  const tabsList = all('#settings [role="tab"]');
  for (const t of tabsList) t.onclick = () => showSettingsTab(t.dataset.pane);
  $('settings').querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const at = tabsList.indexOf(document.activeElement);
    const next = tabsList[(at + (e.key === 'ArrowRight' ? 1 : tabsList.length - 1)) % tabsList.length];
    showSettingsTab(next.dataset.pane);
    next.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !openPopover && !$('settings').hidden) closeSettings();
  });

  $('setLogin').onchange = async (e) => {
    e.target.checked = await window.bridge.setOpenAtLogin(e.target.checked);
  };
  $('setRestore').onchange = (e) => {
    set({ restoreLast: e.target.checked }, { relayout: false });
    renderSettings();
  };
  $('setAdvanced').onchange = (e) => setAdvanced(e.target.checked);

  bindMenu($('startDeviceMenu'), () => ({
    sections: deviceMenuSections(),
    value: S.startDeviceId,
    onPick: (id) => { set({ startDeviceId: id }, { relayout: false }); renderSettings(); },
  }));

  for (const el of all('[data-app-name]')) el.textContent = APP_NAME;
  $('aboutVersion').textContent = APP_VERSION;
  $('aboutLink').onclick = () => window.bridge.openExternal('https://andresurena.com');
}

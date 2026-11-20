'use strict'

/* ================================================================ media
   Camera and microphone. A page asks; the alert a phone would show is drawn
   on the phone's screen, over that page; the answer goes back to the main
   process, which holds the actual permission (see "camera & mic" in main.js).

   Settings › Camera chooses which of the Mac's cameras and microphones a page
   is given — an iPhone nearby shows up in that list too, as a Continuity
   Camera. The shell can read the devices' names and nothing more: it is
   never given the devices themselves.

   A classic script loaded before shell.js; it shares that file's globals and
   only touches them from inside functions. */

const mediaAsksOpen = new Map();   // ask id → { tab, el }

/** How each platform words it. iOS names the microphone first. */
function mediaAskText(host, kinds) {
  const cam = kinds.includes('camera');
  const mic = kinds.includes('microphone');
  if (device.platform === 'android') {
    const what = cam && mic ? 'camera and microphone' : cam ? 'camera' : 'microphone';
    return { title: `Allow ${host} to use your ${what}?`, deny: 'Don’t allow', allow: 'Allow' };
  }
  const what = cam && mic ? 'the Microphone and Camera' : cam ? 'the Camera' : 'the Microphone';
  return { title: `“${host}” Would Like to Access ${what}`, deny: 'Don’t Allow', allow: 'Allow' };
}

function tabByWebContentsId(wcId) {
  return tabs.find((t) => {
    try { return t.el.getWebContentsId() === wcId; } catch { return false; }   // guest not created yet
  });
}

function showMediaAsk({ id, wcId, host, kinds }) {
  const tab = tabByWebContentsId(wcId);
  // A page nobody is looking at can't put up an alert — on a phone it couldn't
  // either. Refused for now; it can ask again once it's on screen.
  if (!tab || !tab.el.classList.contains('shown')) {
    window.bridge.answerMedia(id, false);
    if (tab) toast(`${host} asked for the ${kinds.join(' and ')} from a tab that isn’t showing.`);
    return;
  }

  const text = mediaAskText(host, kinds);
  const el = document.createElement('div');
  el.className = 'media-ask';
  el.innerHTML = `
    <div class="media-alert" role="alertdialog" aria-modal="true">
      <p class="media-title"></p>
      <div class="media-buttons"><button data-answer="deny"></button><button data-answer="allow"></button></div>
    </div>`;
  // textContent, never markup: the host comes from the page
  el.querySelector('.media-title').textContent = text.title;
  el.querySelector('[data-answer="deny"]').textContent = text.deny;
  el.querySelector('[data-answer="allow"]').textContent = text.allow;
  el.addEventListener('click', (e) => {
    const answer = e.target.closest('[data-answer]');
    if (!answer) return;
    window.bridge.answerMedia(id, answer.dataset.answer === 'allow');
    closeMediaAsk(id);
  });
  $('prompts').appendChild(el);
  mediaAsksOpen.set(id, { tab, el });
  placeMediaAsks();
  reportPageRects();
  el.querySelector('[data-answer="allow"]').focus();
}

function closeMediaAsk(id) {
  const ask = mediaAsksOpen.get(id);
  if (!ask) return;
  ask.el.remove();
  mediaAsksOpen.delete(id);
  reportPageRects();
}

/** Whether a tab's page is under an alert, and so not to be given the pointer. */
function mediaAskOver(tab) {
  for (const ask of mediaAsksOpen.values()) if (ask.tab === tab) return true;
  return false;
}

/**
 * Keep each alert over its own page as the layout changes. A page that's no
 * longer on screen — its tab closed, or hidden behind another — is answered
 * no: an alert left floating over a different site would be asking the wrong
 * question.
 */
function placeMediaAsks() {
  for (const [id, { tab, el }] of mediaAsksOpen) {
    if (!tabs.includes(tab) || !tab.el.classList.contains('shown')) {
      window.bridge.answerMedia(id, false);
      closeMediaAsk(id);
      continue;
    }
    const s = tab.el.style;
    Object.assign(el.style, { left: s.left, top: s.top, width: s.width, height: s.height, borderRadius: s.borderRadius });
  }
}

/* -------------------------------------------------------------- settings */

let mediaInfo = { camera: '', microphone: '', allowed: [], mac: { camera: 'granted', microphone: 'granted' } };
let mediaDevices = { camera: [], microphone: [] };

async function refreshMediaSettings() {
  try {
    mediaInfo = await window.bridge.getMedia();
    const list = await navigator.mediaDevices.enumerateDevices();
    const names = (kind) => [...new Set(list
      .filter((d) => d.kind === kind && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d) => d.label))];
    mediaDevices = { camera: names('videoinput'), microphone: names('audioinput') };
  } catch (err) {
    console.warn('[media] could not list devices:', err.message);
  }
  paintMediaSettings();
}

function mediaMenuItems(kind) {
  const chosen = mediaInfo[kind];
  const items = [{ value: '', label: 'System Default' }];
  for (const name of mediaDevices[kind]) items.push({ value: name, label: name });
  // still remembered while it's unplugged — an iPhone comes and goes
  if (chosen && !mediaDevices[kind].includes(chosen)) items.push({ value: chosen, label: `${chosen} (not connected)` });
  return items;
}

function paintMediaSettings() {
  for (const kind of ['camera', 'microphone']) {
    const chosen = mediaInfo[kind];
    const here = !chosen || mediaDevices[kind].includes(chosen);
    $(kind === 'camera' ? 'cameraMenu' : 'micMenu').querySelector('.label').textContent =
      !chosen ? 'System Default' : here ? chosen : `${chosen} (not connected)`;
  }

  const sites = mediaInfo.allowed.map(({ origin }) => {
    try { return new URL(origin).host; } catch { return origin; }
  });
  $('mediaSites').textContent = sites.length
    ? `Allowed until you quit: ${sites.join(', ')}.`
    : 'A site asks before it uses either, and is remembered until you quit.';
  $('mediaReset').disabled = !sites.length;

  // only worth a row once macOS has actually said no
  const blocked = ['camera', 'microphone'].filter((k) => ['denied', 'restricted'].includes(mediaInfo.mac[k]));
  $('mediaMacRow').hidden = !blocked.length;
  if (blocked.length) {
    $('mediaMacText').textContent = `macOS is blocking the ${blocked.join(' and ')} for ${APP_NAME}. `
      + 'Turn it on under Privacy & Security, then reopen the app.';
    $('mediaMacBtn').onclick = () => window.bridge.openPrivacySettings(blocked[0]);
  }
}

async function pickMediaDevice(kind, name) {
  mediaInfo = { ...mediaInfo, [kind]: name };
  paintMediaSettings();
  await window.bridge.setMediaDevices({ camera: mediaInfo.camera, microphone: mediaInfo.microphone });
  toast(name
    ? `“${name}” is used the next time a page asks for the ${kind}.`
    : `The system default ${kind} is used the next time a page asks.`);
}

function wireMedia() {
  window.bridge.onMedia((event, payload) => {
    if (event === 'ask') showMediaAsk(payload);
    else if (event === 'cancel') closeMediaAsk(payload);
    else if (event === 'blocked') {
      toast(`macOS is blocking the ${payload} for ${APP_NAME}.`, 'Open Settings',
        () => window.bridge.openPrivacySettings(payload));
    }
  });

  for (const kind of ['camera', 'microphone']) {
    bindMenu($(kind === 'camera' ? 'cameraMenu' : 'micMenu'), () => ({
      sections: [{ items: mediaMenuItems(kind) }],
      value: mediaInfo[kind],
      onPick: (name) => pickMediaDevice(kind, name),
    }));
  }
  $('mediaReset').onclick = async () => {
    await window.bridge.resetMedia();
    refreshMediaSettings();
  };
  // an iPhone joining or leaving as a Continuity Camera, a headset plugged in
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (!$('settings').hidden) refreshMediaSettings();
  });
}

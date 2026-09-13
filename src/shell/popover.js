'use strict'

/* ============================================================== popovers
   The bottom bar's menus. Native <select> popups centre the current item over
   the control, so from a bar at the foot of the window they spill downward and
   off the edge. These open upward from their button instead, listed so the last
   item — the oldest device, the plainest option — sits nearest the button. */

let openPopover = null;   // { el, anchor }

/**
 * Wire a button to open a menu.
 *
 * `describe()` is called each time it opens, so the contents are never stale:
 *   { sections: [{ label?, items: [{ value, label, hint? }] }], value, onPick }
 * Sections and items are listed top to bottom as they'll appear on screen.
 */
function bindMenu(button, describe) {
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => {
    if (openPopover?.anchor === button) { closeMenu(); return; }
    showMenu(button, describe());
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      showMenu(button, describe());
    }
  });
}

function showMenu(anchor, { sections, value, onPick }) {
  closeMenu();

  const el = document.createElement('div');
  el.className = 'popover';
  el.setAttribute('role', 'menu');

  for (const section of sections) {
    if (!section.items.length) continue;
    if (section.label) {
      const head = document.createElement('div');
      head.className = 'popover-head';
      head.textContent = section.label;
      el.appendChild(head);
    }
    for (const item of section.items) {
      const b = document.createElement('button');
      b.className = 'popover-item';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(item.value === value));
      b.dataset.value = String(item.value);
      b.innerHTML = '<svg class="tick" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>';
      const label = document.createElement('span');
      label.className = 'popover-label';
      label.textContent = item.label;
      b.appendChild(label);
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'popover-hint';
        hint.textContent = item.hint;
        b.appendChild(hint);
      }
      b.addEventListener('click', () => {
        closeMenu();
        anchor.focus();
        if (item.value !== value) onPick(item.value);
      });
      el.appendChild(b);
    }
  }

  document.body.appendChild(el);

  // above the button, left-aligned to it, never past the window's edges
  const r = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8));
  el.style.left = `${left}px`;
  el.style.bottom = `${window.innerHeight - r.top + 6}px`;
  el.style.maxHeight = `${Math.max(120, r.top - 14)}px`;
  el.style.minWidth = `${Math.max(r.width, 180)}px`;

  anchor.setAttribute('aria-expanded', 'true');
  anchor.classList.add('open');
  openPopover = { el, anchor };
  reportPageRects();

  const current = el.querySelector('[aria-checked="true"]') || el.querySelector('.popover-item:last-of-type');
  current?.focus({ preventScroll: true });
  current?.scrollIntoView({ block: 'nearest' });
}

function closeMenu() {
  if (!openPopover) return;
  const { el, anchor } = openPopover;
  openPopover = null;
  el.remove();
  anchor.setAttribute('aria-expanded', 'false');
  anchor.classList.remove('open');
  reportPageRects();
}

function moveMenuFocus(step) {
  const items = [...openPopover.el.querySelectorAll('.popover-item')];
  const at = items.indexOf(document.activeElement);
  const next = at === -1 ? (step > 0 ? 0 : items.length - 1)
    : Math.max(0, Math.min(items.length - 1, at + step));
  items[next]?.focus();
}

document.addEventListener('keydown', (e) => {
  if (!openPopover) return;
  if (e.key === 'Escape') { e.preventDefault(); const a = openPopover.anchor; closeMenu(); a.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); moveMenuFocus(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveMenuFocus(-1); }
  else if (e.key === 'Tab') closeMenu();
});

// Clicking anywhere else closes it. A click inside a page never reaches this
// document — the webview swallows it — but focus moving into the webview does.
document.addEventListener('mousedown', (e) => {
  if (openPopover && !openPopover.el.contains(e.target) && !openPopover.anchor.contains(e.target)) closeMenu();
}, true);
document.addEventListener('focusin', (e) => {
  if (openPopover && !openPopover.el.contains(e.target) && e.target !== openPopover.anchor) closeMenu();
});
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

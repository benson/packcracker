import { outsideClick } from './outsideClick.js';
import { isMovingTowardSubmenu } from './safeTriangle.js';
import { applyMotionMode, applyMotionState, setPopoverTransformOrigin } from './motion.js';

const ROW_CONTEXT_MENU_EDGE_BUFFER_PX = 8;
const DEFAULT_GAP_PX = 4;
const HOVER_INTENT_DEFAULT_DELAY_MS = 220;
const HOVER_INTENT_DEFAULT_THRESHOLD_PX = 4;
const SUBMENU_OPEN_CLASS = 'is-submenu-open';

function menuItems(menuEl) {
  return Array.from(menuEl?.querySelectorAll?.('[role="menuitem"]:not([disabled])') || []);
}

function focusItemByDelta(menuEl, current, delta) {
  const items = menuItems(menuEl);
  if (!items.length) return;
  const start = Math.max(0, items.indexOf(current));
  items[(start + delta + items.length) % items.length]?.focus?.();
}

function isFixedPosition(position) {
  return position === 'fixed' || (position && typeof position === 'object' && 'x' in position);
}

function positionMenu(triggerEl, menuEl, options) {
  const doc = menuEl?.ownerDocument;
  const win = doc?.defaultView || globalThis;
  const viewportWidth = Math.max(0, win?.innerWidth || 0);
  const viewportHeight = Math.max(0, win?.innerHeight || 0);
  const edgeBuffer = Math.max(0, Number(options.edgeBuffer) || ROW_CONTEXT_MENU_EDGE_BUFFER_PX);
  const gap = Number.isFinite(options.gap) ? Number(options.gap) : DEFAULT_GAP_PX;
  const mode = options.position || 'anchored';
  const menuRect = menuEl.getBoundingClientRect();

  let left;
  let top;

  if (typeof mode === 'object' && mode && 'x' in mode) {
    left = Number(mode.x) || 0;
    top = Number(mode.y) || 0;
  } else {
    const triggerRect = triggerEl?.getBoundingClientRect?.();
    if (!triggerRect) return;
    left = options.align === 'end' ? triggerRect.right - menuRect.width : triggerRect.left;
    if (
      mode === 'edge-flip' &&
      viewportWidth > 0 &&
      left + menuRect.width > viewportWidth - edgeBuffer
    ) {
      const triggerRight = Number.isFinite(triggerRect.right)
        ? triggerRect.right
        : triggerRect.left;
      left = triggerRight - menuRect.width;
    }
    top = triggerRect.bottom + gap;
    if (viewportHeight > 0 && top + menuRect.height > viewportHeight - edgeBuffer) {
      top = triggerRect.top - menuRect.height - gap;
    }
  }

  if (viewportWidth > 0) {
    left = Math.max(edgeBuffer, Math.min(left, viewportWidth - menuRect.width - edgeBuffer));
  }
  if (viewportHeight > 0) {
    top = Math.max(edgeBuffer, Math.min(top, viewportHeight - menuRect.height - edgeBuffer));
  }

  if (!isFixedPosition(mode)) {
    const offsetParent = menuEl.offsetParent;
    const parentRect = offsetParent?.getBoundingClientRect?.();
    if (parentRect) {
      left -= parentRect.left;
      top -= parentRect.top;
    }
  }

  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
  menuEl.style.right = 'auto';
  menuEl.style.bottom = 'auto';
}

// Find the submenu wrappers inside a menu: each is a `[aria-haspopup="true"]`
// trigger paired with a sibling `[role="menu"]` submenu, both under a common
// wrapper element. Framework-agnostic — driven by ARIA, not app-specific class
// names — so any consumer that marks its submenus this way gets hover-intent.
function findSubmenuWraps(menuEl) {
  const triggers = Array.from(menuEl?.querySelectorAll?.('[aria-haspopup="true"]') || []);
  const wraps = [];
  for (const trigger of triggers) {
    const wrap = trigger.parentElement;
    if (!wrap) continue;
    const submenu = wrap.querySelector(':scope > [role="menu"]');
    if (submenu) wraps.push({ wrap, trigger, submenu });
  }
  return wraps;
}

// Wire safe-triangle hover-intent onto a menu's submenus. Returns a cleanup fn.
// The submenu open state is driven by an `is-submenu-open` class on the wrapper
// (which consumer CSS reveals), taking over from the fragile pure-`:hover`
// rule: once open, the submenu stays open while the pointer path stays inside
// the triangle toward it, and only closes after `delay` ms of the pointer
// clearly heading elsewhere. Focus-within still opens it for keyboard users.
function attachHoverIntent(menuEl, config) {
  const doc = menuEl.ownerDocument;
  const win = doc?.defaultView || globalThis;
  const delay = Number.isFinite(config?.delay) ? config.delay : HOVER_INTENT_DEFAULT_DELAY_MS;
  const threshold = Number.isFinite(config?.threshold)
    ? config.threshold
    : HOVER_INTENT_DEFAULT_THRESHOLD_PX;
  const wraps = findSubmenuWraps(menuEl);
  if (!wraps.length) return () => {};

  const cleanups = [];
  for (const { wrap, trigger, submenu } of wraps) {
    let closeTimer = null;
    let anchor = null; // pointer position when it left the trigger

    const openSub = () => {
      if (closeTimer) {
        win.clearTimeout(closeTimer);
        closeTimer = null;
      }
      wrap.classList.add(SUBMENU_OPEN_CLASS);
    };
    const closeSub = () => {
      if (closeTimer) {
        win.clearTimeout(closeTimer);
        closeTimer = null;
      }
      wrap.classList.remove(SUBMENU_OPEN_CLASS);
      anchor = null;
    };
    const scheduleClose = () => {
      if (closeTimer) return;
      closeTimer = win.setTimeout(() => {
        closeTimer = null;
        wrap.classList.remove(SUBMENU_OPEN_CLASS);
        anchor = null;
      }, delay);
    };

    const onTriggerEnter = () => openSub();
    const onTriggerLeave = (event) => {
      anchor = { x: event.clientX, y: event.clientY };
    };
    // While the submenu is open, track pointer moves anywhere in the wrapper's
    // vicinity: if the pointer is inside the safe triangle toward the submenu,
    // keep it open; otherwise start the close countdown.
    const onDocMove = (event) => {
      if (!wrap.classList.contains(SUBMENU_OPEN_CLASS)) return;
      const point = { x: event.clientX, y: event.clientY };
      // Pointer over the submenu or its trigger → stay open, reset anchor.
      if (submenu.contains(event.target) || trigger.contains(event.target)) {
        openSub();
        return;
      }
      const rect = submenu.getBoundingClientRect();
      const start = anchor || { x: trigger.getBoundingClientRect().right, y: point.y };
      if (isMovingTowardSubmenu(start, point, rect, { buffer: threshold })) {
        // Still heading toward it — hold open, don't reset the timer to zero so
        // a stalled cursor eventually closes.
        if (!closeTimer) return;
        return;
      }
      scheduleClose();
    };
    const onSubEnter = () => openSub();
    const onSubLeave = () => scheduleClose();
    const onFocusIn = () => openSub();
    const onFocusOut = (event) => {
      if (!wrap.contains(event.relatedTarget)) scheduleClose();
    };

    trigger.addEventListener('pointerenter', onTriggerEnter);
    trigger.addEventListener('pointerleave', onTriggerLeave);
    submenu.addEventListener('pointerenter', onSubEnter);
    submenu.addEventListener('pointerleave', onSubLeave);
    wrap.addEventListener('focusin', onFocusIn);
    wrap.addEventListener('focusout', onFocusOut);
    doc.addEventListener('pointermove', onDocMove, true);

    cleanups.push(() => {
      closeSub();
      trigger.removeEventListener('pointerenter', onTriggerEnter);
      trigger.removeEventListener('pointerleave', onTriggerLeave);
      submenu.removeEventListener('pointerenter', onSubEnter);
      submenu.removeEventListener('pointerleave', onSubLeave);
      wrap.removeEventListener('focusin', onFocusIn);
      wrap.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('pointermove', onDocMove, true);
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}

export function floatingMenu(triggerEl, menuEl, options = {}) {
  if (!triggerEl || !menuEl) {
    return { open: () => {}, close: () => {}, isOpen: () => false, destroy: () => {} };
  }
  const doc = menuEl.ownerDocument;
  const closeOn = new Set(Array.isArray(options.closeOn) ? options.closeOn : ['escape', 'outside']);
  let open = false;
  let cleanupOutside = null;
  let cleanupOutsideClick = null;
  let cleanupEscape = null;
  let cleanupScroll = null;
  let cleanupResize = null;
  let cleanupHoverIntent = null;
  // Off by default: only wire hover-intent when a consumer opts in. Accepts
  // `true` or an object `{ delay, threshold }`.
  const hoverIntentConfig =
    options.hoverIntent === true
      ? {}
      : options.hoverIntent && typeof options.hoverIntent === 'object'
        ? options.hoverIntent
        : null;

  const close = ({ restoreFocus = true, reason = 'manual', event = null, motion = 'auto' } = {}) => {
    if (!open) return;
    open = false;
    applyMotionMode(menuEl, { motion, reason, event });
    applyMotionState(menuEl, false);
    menuEl.hidden = true;
    menuEl.setAttribute('aria-hidden', 'true');
    if (typeof cleanupOutside === 'function') cleanupOutside();
    if (typeof cleanupOutsideClick === 'function') cleanupOutsideClick();
    if (typeof cleanupEscape === 'function') cleanupEscape();
    if (typeof cleanupScroll === 'function') cleanupScroll();
    if (typeof cleanupResize === 'function') cleanupResize();
    if (typeof cleanupHoverIntent === 'function') cleanupHoverIntent();
    cleanupOutside = null;
    cleanupOutsideClick = null;
    cleanupEscape = null;
    cleanupScroll = null;
    cleanupResize = null;
    cleanupHoverIntent = null;
    options.onClose?.({ reason, event });
    if (restoreFocus && doc?.activeElement && menuEl.contains(doc.activeElement)) {
      triggerEl.focus?.();
    }
  };

  const onKeydown = (event) => {
    const keyTarget = event.target?.closest?.('[role="menuitem"]');
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ reason: 'escape', event });
      return;
    }
    if (!keyTarget || !menuEl.contains(keyTarget)) return;
    if (!options.keyboard) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusItemByDelta(menuEl, keyTarget, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const items = menuItems(menuEl);
      const next = event.key === 'Home' ? items[0] : items[items.length - 1];
      next?.focus?.();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && keyTarget?.matches?.('[role="menuitem"]')) {
      event.preventDefault();
      keyTarget.click?.();
    }
  };

  const openMenu = ({ focusFirst = false, reason = 'manual', event = null, motion = 'auto' } = {}) => {
    if (open) return;
    open = true;
    applyMotionMode(menuEl, { motion, reason, event });
    applyMotionState(menuEl, true);
    menuEl.hidden = false;
    menuEl.setAttribute('aria-hidden', 'false');
    positionMenu(triggerEl, menuEl, options);
    setPopoverTransformOrigin(triggerEl, menuEl);
    options.onOpen?.({ reason, event });
    if (focusFirst && options.keyboard !== false) {
      menuItems(menuEl)[0]?.focus?.();
    }

    if (hoverIntentConfig) {
      cleanupHoverIntent = attachHoverIntent(menuEl, hoverIntentConfig);
    }

    if (closeOn.has('outside')) {
      cleanupOutside = outsideClick(
        menuEl,
        (event) => {
          if (event?.target && triggerEl.contains?.(event.target)) return;
          close({ restoreFocus: false, reason: 'outside', event });
        },
        { event: 'pointerdown' },
      );
      const clickHandler = (event) => {
        const target = event?.target;
        if (!target) return;
        if (menuEl.contains(target) || triggerEl.contains?.(target) || target === triggerEl) return;
        close({ restoreFocus: false, reason: 'outside', event });
      };
      doc.addEventListener('click', clickHandler, true);
      cleanupOutsideClick = () => doc.removeEventListener('click', clickHandler, true);
    }
    if (closeOn.has('escape')) {
      const handler = (event) => onKeydown(event);
      doc.addEventListener('keydown', handler);
      cleanupEscape = () => doc.removeEventListener('keydown', handler);
    } else if (options.keyboard !== false) {
      menuEl.addEventListener('keydown', onKeydown);
      cleanupEscape = () => menuEl.removeEventListener('keydown', onKeydown);
    }
    if (closeOn.has('scroll')) {
      const handler = (event) => close({ restoreFocus: false, reason: 'scroll', event });
      doc.defaultView?.addEventListener?.('scroll', handler, true);
      cleanupScroll = () => doc.defaultView?.removeEventListener?.('scroll', handler, true);
    }
    if (closeOn.has('resize')) {
      const handler = (event) => close({ restoreFocus: false, reason: 'resize', event });
      doc.defaultView?.addEventListener?.('resize', handler);
      cleanupResize = () => doc.defaultView?.removeEventListener?.('resize', handler);
    }
  };

  return {
    open: openMenu,
    close,
    isOpen: () => open,
    destroy: () => close({ restoreFocus: false, reason: 'destroy', motion: 'none' }),
  };
}

export { focusItemByDelta as moveFloatingMenuFocus };

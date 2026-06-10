import { outsideClick } from './outsideClick.js';

const ROW_CONTEXT_MENU_EDGE_BUFFER_PX = 8;
const DEFAULT_GAP_PX = 4;

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

  const close = ({ restoreFocus = true } = {}) => {
    if (!open) return;
    open = false;
    menuEl.hidden = true;
    menuEl.setAttribute('aria-hidden', 'true');
    if (typeof cleanupOutside === 'function') cleanupOutside();
    if (typeof cleanupOutsideClick === 'function') cleanupOutsideClick();
    if (typeof cleanupEscape === 'function') cleanupEscape();
    if (typeof cleanupScroll === 'function') cleanupScroll();
    if (typeof cleanupResize === 'function') cleanupResize();
    cleanupOutside = null;
    cleanupOutsideClick = null;
    cleanupEscape = null;
    cleanupScroll = null;
    cleanupResize = null;
    options.onClose?.();
    if (restoreFocus && doc?.activeElement && menuEl.contains(doc.activeElement)) {
      triggerEl.focus?.();
    }
  };

  const onKeydown = (event) => {
    const keyTarget = event.target?.closest?.('[role="menuitem"]');
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
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

  const openMenu = ({ focusFirst = false } = {}) => {
    if (open) return;
    open = true;
    menuEl.hidden = false;
    menuEl.setAttribute('aria-hidden', 'false');
    positionMenu(triggerEl, menuEl, options);
    options.onOpen?.();
    if (focusFirst && options.keyboard !== false) {
      menuItems(menuEl)[0]?.focus?.();
    }

    if (closeOn.has('outside')) {
      cleanupOutside = outsideClick(
        menuEl,
        (event) => {
          if (event?.target && triggerEl.contains?.(event.target)) return;
          close({ restoreFocus: false });
        },
        { event: 'pointerdown' },
      );
      const clickHandler = (event) => {
        const target = event?.target;
        if (!target) return;
        if (menuEl.contains(target) || triggerEl.contains?.(target) || target === triggerEl) return;
        close({ restoreFocus: false });
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
      const handler = () => close({ restoreFocus: false });
      doc.defaultView?.addEventListener?.('scroll', handler, true);
      cleanupScroll = () => doc.defaultView?.removeEventListener?.('scroll', handler, true);
    }
    if (closeOn.has('resize')) {
      const handler = () => close({ restoreFocus: false });
      doc.defaultView?.addEventListener?.('resize', handler);
      cleanupResize = () => doc.defaultView?.removeEventListener?.('resize', handler);
    }
  };

  return {
    open: openMenu,
    close,
    isOpen: () => open,
    destroy: () => close({ restoreFocus: false }),
  };
}

export { focusItemByDelta as moveFloatingMenuFocus };

// Canonical popover controller: trigger-anchored open/close with outside-click
// + escape handling. The search-help popover and the collection column-settings
// dropdown consume it. Known exception: the quick-jump palette (quickJump.js) is
// keyboard-launched (Ctrl+K, no trigger element) and stays hand-rolled.
import { outsideClick } from './outsideClick.js';

function normalizedCloseOn(closeOn) {
  if (!Array.isArray(closeOn)) return new Set(['outside', 'escape']);
  return new Set(
    closeOn
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function noop() {}

export function popover(triggerEl, panelEl, options = {}) {
  if (!triggerEl || !panelEl) {
    return {
      isOpen: () => false,
      open: noop,
      close: noop,
      toggle: noop,
      destroy: noop,
    };
  }

  const closeOn = normalizedCloseOn(options.closeOn);
  const hiddenAttr = options.hiddenAttr !== false;
  const openClass =
    typeof options.openClass === 'string' && options.openClass ? options.openClass : '';
  const outsideEvent =
    typeof options.outsideEvent === 'string' && options.outsideEvent
      ? options.outsideEvent
      : 'click';
  const excludeSelectors = Array.isArray(options.excludeSelectors)
    ? options.excludeSelectors.filter((selector) => typeof selector === 'string' && selector.trim())
    : [];
  const useTriggerClick = options.bindTrigger !== false;

  let cleanupOutside = null;
  let destroyed = false;

  const syncExpanded = (open) => {
    if (options.syncExpanded === false) return;
    triggerEl.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const isOpen = () => {
    if (hiddenAttr) return !panelEl.hidden;
    if (!openClass) return false;
    return panelEl.classList.contains(openClass);
  };

  const applyOpenState = (open) => {
    if (hiddenAttr) panelEl.hidden = !open;
    if (openClass) panelEl.classList.toggle(openClass, open);
    panelEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    syncExpanded(open);
  };

  const installOutsideClose = () => {
    if (cleanupOutside || (!closeOn.has('outside') && !closeOn.has('escape'))) return;
    cleanupOutside = outsideClick(
      panelEl,
      (event) => {
        if (event?.target && triggerEl.contains?.(event.target)) return;
        if (event?.type === 'keydown') {
          if (!closeOn.has('escape')) return;
          close({ reason: 'escape', event, restoreFocus: true });
          return;
        }
        if (!closeOn.has('outside')) return;
        close({ reason: 'outside', event });
      },
      {
        event: outsideEvent,
        alsoOnEscape: closeOn.has('escape'),
        excludeSelectors,
      },
    );
  };

  const removeOutsideClose = () => {
    cleanupOutside?.();
    cleanupOutside = null;
  };

  const open = ({ reason = 'manual', event = null } = {}) => {
    if (destroyed || isOpen()) return;
    applyOpenState(true);
    installOutsideClose();
    options.onOpen?.({ reason, event });
  };

  const close = ({ reason = 'manual', event = null, restoreFocus = false } = {}) => {
    if (destroyed || !isOpen()) return;
    applyOpenState(false);
    removeOutsideClose();
    options.onClose?.({ reason, event });
    if (restoreFocus) triggerEl.focus?.();
  };

  const toggle = ({ reason = 'toggle', event = null } = {}) => {
    if (isOpen()) close({ reason, event });
    else open({ reason, event });
  };

  const onTriggerClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle({ reason: 'trigger', event });
  };

  if (useTriggerClick) triggerEl.addEventListener('click', onTriggerClick);
  applyOpenState(isOpen());

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    removeOutsideClose();
    if (useTriggerClick) triggerEl.removeEventListener('click', onTriggerClick);
  };

  return {
    isOpen,
    open,
    close,
    toggle,
    destroy,
  };
}

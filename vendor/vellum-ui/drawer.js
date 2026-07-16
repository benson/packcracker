import { applyMotionMode, applyMotionState } from './motion.js';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const SIDES = new Set(['left', 'right', 'bottom']);
const GESTURE_SLOP = 8;

export function drawer(layerEl, options = {}) {
  if (!layerEl) return emptyController();

  const doc = layerEl.ownerDocument;
  const win = doc?.defaultView || globalThis;
  const panelSelector = options.panelSelector || '.ui-drawer';
  const backdropSelector = options.backdropSelector || '.ui-drawer-backdrop';
  const closeSelector = options.closeSelector || '[data-drawer-close]';
  const handleSelector = options.handleSelector || '[data-vui-drawer-handle]';
  const panelEl = layerEl.querySelector?.(panelSelector);
  const backdropEl = layerEl.querySelector?.(backdropSelector);
  const handleEl = layerEl.querySelector?.(handleSelector) || panelEl;
  if (!panelEl) return emptyController();

  const side = normalizeSide(options.side || panelEl.dataset?.vuiDrawerSide || layerEl.dataset?.vuiDrawerSide);
  const bodyClass = options.bodyClass === undefined ? 'vui-drawer-open' : options.bodyClass;
  const closeOnBackdrop = options.closeOnBackdrop !== false;
  const closeOnEscape = options.closeOnEscape !== false;
  const trapFocus = options.trapFocus !== false;
  const gestures = options.gestures !== false;
  let destroyed = false;
  let openState = layerEl.getAttribute?.('data-vui-state') === 'open' || !layerEl.hidden;
  let returnFocusEl = null;
  let hideTimer = null;
  let settleFrame = null;
  let gesture = null;

  layerEl.dataset.vuiDrawerSide = side;
  panelEl.dataset.vuiDrawerSide = side;
  if (!panelEl.getAttribute?.('role')) panelEl.setAttribute?.('role', 'dialog');
  panelEl.setAttribute?.('aria-modal', 'true');

  function isOpen() {
    return openState;
  }

  function applyOpenState(open) {
    openState = open;
    applyMotionState(layerEl, open);
    layerEl.classList?.toggle(options.openClass || 'open', open);
    layerEl.setAttribute?.('aria-hidden', open ? 'false' : 'true');
    panelEl.setAttribute?.('aria-hidden', open ? 'false' : 'true');
    if (bodyClass) doc?.body?.classList?.toggle(bodyClass, open);
  }

  function open({ reason = 'manual', event = null, focusTarget = null, motion = 'auto', trigger = null } = {}) {
    if (destroyed || openState) return;
    clearPendingSettle();
    returnFocusEl = trigger || event?.currentTarget || doc?.activeElement || returnFocusEl;
    applyMotionMode(layerEl, { motion, reason, event });
    const currentOffset = layerEl.hidden ? null : drawerOffsetFromElement(panelEl, side, win);
    layerEl.hidden = false;
    if (currentOffset > 0) panelEl.style.transform = drawerTransform(side, currentOffset);
    applyOpenState(true);
    settlePanel(currentOffset, true);
    focusDrawer(focusTarget);
    options.onOpen?.({ reason, event });
  }

  function close({ reason = 'manual', event = null, motion = 'auto', restoreFocus = true } = {}) {
    if (destroyed || !openState) return;
    clearPendingSettle();
    applyMotionMode(layerEl, { motion, reason, event });
    const currentOffset = drawerOffsetFromElement(panelEl, side, win);
    if (currentOffset > 0) panelEl.style.transform = drawerTransform(side, currentOffset);
    applyOpenState(false);
    settlePanel(currentOffset, false);
    if (restoreFocus) restoreFocusSoon();
    options.onClose?.({ reason, event });
  }

  function toggle(detail = {}) {
    if (openState) close({ reason: 'toggle', ...detail });
    else open({ reason: 'toggle', ...detail });
  }

  function requestClose(reason, event) {
    if (!openState) return;
    const allowed = options.onRequestClose?.({ reason, event });
    if (allowed === false) return;
    close({ reason, event });
  }

  function focusDrawer(explicitTarget) {
    const target =
      explicitTarget ||
      (typeof options.focusTarget === 'function' ? options.focusTarget() : options.focusTarget) ||
      panelEl.querySelector?.('[autofocus]') ||
      focusableElements(panelEl)[0] ||
      panelEl;
    if (target === panelEl && !panelEl.hasAttribute?.('tabindex')) panelEl.setAttribute?.('tabindex', '-1');
    try {
      target?.focus?.({ preventScroll: true });
      target?.select?.();
    } catch (_error) {}
  }

  function restoreFocusSoon() {
    const target = returnFocusEl;
    returnFocusEl = null;
    if (!target?.focus) return;
    queueMicrotask(() => {
      if (destroyed) return;
      try { target.focus({ preventScroll: true }); } catch (_error) {}
    });
  }

  function settlePanel(currentOffset, opening) {
    panelEl.classList?.remove('is-vui-drawer-dragging');
    if (settleFrame) win.cancelAnimationFrame?.(settleFrame);
    const mode = layerEl.getAttribute?.('data-vui-motion');
    if (mode === 'none') {
      panelEl.style.removeProperty?.('transition');
      panelEl.style.removeProperty?.('transform');
      if (!opening) layerEl.hidden = true;
      return;
    }
    if (currentOffset > 0) {
      // Preserve the presentation position for this frame. Removing the
      // inline transform on the next frame lets CSS settle from exactly where
      // an interrupted transition or direct gesture left the surface.
      panelEl.style.setProperty?.('transition', 'none');
      panelEl.getBoundingClientRect?.();
    }
    settleFrame = win.requestAnimationFrame?.(() => {
      settleFrame = null;
      panelEl.style.removeProperty?.('transition');
      panelEl.style.removeProperty?.('transform');
    });
    if (!opening) scheduleHidden();
  }

  function scheduleHidden() {
    const duration = transitionTotalMs(panelEl, win) || 320;
    hideTimer = win.setTimeout?.(() => {
      hideTimer = null;
      if (!openState) layerEl.hidden = true;
    }, duration + 40);
  }

  function clearPendingSettle() {
    if (hideTimer) win.clearTimeout?.(hideTimer);
    if (settleFrame) win.cancelAnimationFrame?.(settleFrame);
    hideTimer = null;
    settleFrame = null;
  }

  function onClick(event) {
    const closeControl = event.target?.closest?.(closeSelector);
    if (closeControl && layerEl.contains?.(closeControl)) {
      requestClose('close-button', event);
      return;
    }
    if (closeOnBackdrop && (event.target === backdropEl || (!backdropEl && event.target === layerEl))) {
      requestClose('backdrop', event);
    }
  }

  function onKeydown(event) {
    if (!openState) return;
    if (closeOnEscape && event.key === 'Escape') {
      event.preventDefault?.();
      requestClose('escape', event);
      return;
    }
    if (!trapFocus || event.key !== 'Tab') return;
    const focusables = focusableElements(panelEl);
    if (!focusables.length) {
      event.preventDefault?.();
      panelEl.focus?.({ preventScroll: true });
      return;
    }
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && doc.activeElement === first) {
      event.preventDefault?.();
      last.focus?.();
    } else if (!event.shiftKey && doc.activeElement === last) {
      event.preventDefault?.();
      first.focus?.();
    }
  }

  function onPointerDown(event) {
    if (
      !gestures ||
      destroyed ||
      layerEl.hidden ||
      event.button > 0 ||
      gesture ||
      (options.gesturesUnderReducedMotion !== true && prefersReducedMotion(win))
    ) return;
    clearPendingSettle();
    const offset = drawerOffsetFromElement(panelEl, side, win);
    if (!openState) applyOpenState(true);
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
      offset,
      side,
      started: false,
      samples: [{ t: event.timeStamp || performance.now(), p: mainPoint(event, side) }],
    };
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const mainDelta = closeDirectionDelta(event, gesture, side);
    const crossDelta = crossDirectionDelta(event, gesture, side);
    if (!gesture.started) {
      if (Math.abs(mainDelta) < GESTURE_SLOP && Math.abs(crossDelta) < GESTURE_SLOP) return;
      if (Math.abs(crossDelta) > Math.abs(mainDelta)) {
        endGesture(event, true);
        return;
      }
      gesture.started = true;
      capturePointer(handleEl, event.pointerId);
      panelEl.classList?.add('is-vui-drawer-dragging');
      panelEl.style.setProperty?.('transition', 'none');
    }
    event.preventDefault?.();
    const size = drawerSize(panelEl, side);
    gesture.offset = rubberbandDrawerOffset(gesture.startOffset + mainDelta, size);
    panelEl.style.setProperty?.('transform', drawerTransform(side, gesture.offset));
    recordSample(gesture, event);
  }

  function onPointerUp(event) {
    endGesture(event, false);
  }

  function onPointerCancel(event) {
    endGesture(event, true);
  }

  function endGesture(event, cancelled) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const active = gesture;
    gesture = null;
    releasePointer(handleEl, event.pointerId);
    if (!active.started) return;
    recordSample(active, event);
    const velocity = drawerGestureVelocity(active.samples, side);
    const decision = resolveDrawerGesture({
      offset: active.offset,
      velocity,
      size: drawerSize(panelEl, side),
      cancelled,
    });
    if (decision === 'close') close({ reason: 'gesture', event, restoreFocus: true });
    else settlePanel(active.offset, true);
  }

  function destroy() {
    if (destroyed) return;
    close({ reason: 'destroy', motion: 'none', restoreFocus: false });
    destroyed = true;
    clearPendingSettle();
    layerEl.removeEventListener?.('click', onClick);
    doc?.removeEventListener?.('keydown', onKeydown);
    handleEl?.removeEventListener?.('pointerdown', onPointerDown);
    handleEl?.removeEventListener?.('pointermove', onPointerMove);
    handleEl?.removeEventListener?.('pointerup', onPointerUp);
    handleEl?.removeEventListener?.('pointercancel', onPointerCancel);
  }

  layerEl.addEventListener?.('click', onClick);
  doc?.addEventListener?.('keydown', onKeydown);
  handleEl?.addEventListener?.('pointerdown', onPointerDown);
  handleEl?.addEventListener?.('pointermove', onPointerMove, { passive: false });
  handleEl?.addEventListener?.('pointerup', onPointerUp);
  handleEl?.addEventListener?.('pointercancel', onPointerCancel);
  applyOpenState(openState);

  return { open, close, toggle, destroy, isOpen, requestClose };
}

export function rubberbandDrawerOffset(offset, size, factor = 0.18) {
  const boundedSize = Math.max(1, Number(size) || 1);
  if (offset < 0) return -rubberbandDistance(-offset, boundedSize, factor);
  if (offset > boundedSize) return boundedSize + rubberbandDistance(offset - boundedSize, boundedSize, factor);
  return offset;
}

export function projectDrawerOffset(offset, velocity, horizonMs = 180) {
  return Math.max(0, (Number(offset) || 0) + (Number(velocity) || 0) * horizonMs);
}

export function resolveDrawerGesture({ offset = 0, velocity = 0, size = 1, cancelled = false } = {}) {
  if (cancelled) return 'open';
  const boundedSize = Math.max(1, Number(size) || 1);
  const projected = projectDrawerOffset(offset, velocity);
  return velocity > 0.11 || projected > boundedSize * 0.42 ? 'close' : 'open';
}

export function drawerOffsetFromTransform(transform, side = 'right') {
  if (!transform || transform === 'none') return 0;
  const matrix3d = transform.match(/^matrix3d\((.+)\)$/);
  const matrix = transform.match(/^matrix\((.+)\)$/);
  let x = 0;
  let y = 0;
  if (matrix3d) {
    const values = matrix3d[1].split(',').map(Number);
    x = values[12] || 0;
    y = values[13] || 0;
  } else if (matrix) {
    const values = matrix[1].split(',').map(Number);
    x = values[4] || 0;
    y = values[5] || 0;
  } else {
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?/);
    if (translate) {
      x = Number(translate[1]) || 0;
      y = Number(translate[2]) || 0;
    } else {
      const translateY = transform.match(/translateY\(\s*(-?[\d.]+)px/);
      const translateX = transform.match(/translateX\(\s*(-?[\d.]+)px/);
      x = Number(translateX?.[1]) || 0;
      y = Number(translateY?.[1]) || 0;
    }
  }
  if (side === 'left') return Math.max(0, -x);
  if (side === 'bottom') return Math.max(0, y);
  return Math.max(0, x);
}

function normalizeSide(side) {
  return SIDES.has(side) ? side : 'right';
}

function drawerOffsetFromElement(panelEl, side, win) {
  return drawerOffsetFromTransform(win.getComputedStyle?.(panelEl)?.transform || panelEl.style?.transform, side);
}

function drawerSize(panelEl, side) {
  const rect = panelEl.getBoundingClientRect?.() || {};
  return side === 'bottom' ? rect.height || panelEl.offsetHeight || 1 : rect.width || panelEl.offsetWidth || 1;
}

function drawerTransform(side, offset) {
  const value = `${Math.round(offset * 100) / 100}px`;
  if (side === 'left') return `translate3d(-${value}, 0, 0)`;
  if (side === 'bottom') return `translate3d(0, ${value}, 0)`;
  return `translate3d(${value}, 0, 0)`;
}

function closeDirectionDelta(event, state, side) {
  if (side === 'left') return state.startX - event.clientX;
  if (side === 'bottom') return event.clientY - state.startY;
  return event.clientX - state.startX;
}

function crossDirectionDelta(event, state, side) {
  return side === 'bottom' ? event.clientX - state.startX : event.clientY - state.startY;
}

function mainPoint(event, side) {
  if (side === 'left') return -event.clientX;
  if (side === 'bottom') return event.clientY;
  return event.clientX;
}

function recordSample(state, event) {
  const now = event.timeStamp || performance.now();
  state.samples.push({ t: now, p: mainPoint(event, state.side) });
  state.samples = state.samples.filter((sample) => now - sample.t <= 100).slice(-6);
}

// Samples already store their point in the close direction. `side` is kept in
// the signature for readability at the callsite and future axis tuning.
function drawerGestureVelocity(samples, _side) {
  const first = samples[0];
  const last = samples.at(-1);
  const elapsed = Math.max(1, (last?.t || 0) - (first?.t || 0));
  return ((last?.p || 0) - (first?.p || 0)) / elapsed;
}

function rubberbandDistance(distance, dimension, factor) {
  return (distance * dimension * factor) / (dimension + factor * distance);
}

function prefersReducedMotion(win) {
  return Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

function capturePointer(element, pointerId) {
  try { element?.setPointerCapture?.(pointerId); } catch (_error) {}
}

function releasePointer(element, pointerId) {
  try {
    if (!element?.hasPointerCapture || element.hasPointerCapture(pointerId)) {
      element?.releasePointerCapture?.(pointerId);
    }
  } catch (_error) {}
}

function focusableElements(panelEl) {
  return [...(panelEl.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])].filter(
    (node) => !node.hidden && node.getAttribute?.('aria-hidden') !== 'true',
  );
}

function transitionTotalMs(element, win) {
  const style = win.getComputedStyle?.(element);
  const durations = String(style?.transitionDuration || '').split(',').map(timeToMs);
  const delays = String(style?.transitionDelay || '').split(',').map(timeToMs);
  return durations.reduce((max, duration, index) => Math.max(max, duration + (delays[index] || delays[0] || 0)), 0);
}

function timeToMs(value) {
  const text = String(value).trim();
  if (text.endsWith('ms')) return Number.parseFloat(text) || 0;
  if (text.endsWith('s')) return (Number.parseFloat(text) || 0) * 1000;
  return 0;
}

function emptyController() {
  return { open() {}, close() {}, toggle() {}, destroy() {}, requestClose() {}, isOpen: () => false };
}

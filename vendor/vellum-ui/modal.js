import { applyMotionMode, applyMotionState } from './motion.js';

const RESIZE_EDGES = ['bottom', 'left', 'bottom-left'];
const MODAL_STACK_BASE = 100;
const MODAL_STACK_KEY = '__vuiModalStackIndex';
const DRAG_HANDLE_SELECTOR = '.ui-modal-head';
const DRAG_BLOCK_SELECTOR = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[data-vui-modal-resize-handle]',
].join(',');

// Every headed modal gets a close ✕ without per-consumer markup: inject a
// rune-close into .ui-modal-head when nothing already matches the close
// selector. Re-init is naturally idempotent — the injected button matches
// the selector on the next pass.
function ensureModalCloseButton(modalEl, closeSelector) {
  const head = modalEl.querySelector?.('.ui-modal-head');
  if (!head || modalEl.querySelector(closeSelector)) return;
  const doc = modalEl.ownerDocument;
  if (typeof doc?.createElement !== 'function') return;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'rune-close';
  button.setAttribute('aria-label', 'close');
  button.setAttribute('data-modal-close', '');
  const glyph = doc.createElement('span');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = '✕';
  button.appendChild(glyph);
  // a custom closeSelector that wouldn't wire this button means no injection
  if (!button.matches(closeSelector)) return;
  head.appendChild(button);
}

export function modal(modalEl, options = {}) {
  if (!modalEl) return { open() {}, close() {}, toggle() {}, destroy() {}, isOpen: () => false };

  const doc = modalEl.ownerDocument;
  const {
    bodyClass = '',
    closeSelector = '[data-modal-close], .rune-close',
    closeOnBackdrop = true,
    closeOnEnter = false,
    closeOnEscape = true,
    onClose,
    onOpen,
    onRequestClose,
    openClass = 'open',
  } = options;
  let destroyed = false;

  ensureModalCloseButton(modalEl, closeSelector);

  const interaction =
    options.interactive === false
      ? null
      : makeModalInteractive(modalEl, {
          cardSelector: options.cardSelector,
          draggable: options.draggable,
          resizable: options.resizable,
          resizeEdges: options.resizeEdges,
          minWidth: options.minWidth,
          minHeight: options.minHeight,
          margin: options.margin,
          dragHandleSelector: options.dragHandleSelector,
          centeredX: options.centeredX,
          centeredY: options.centeredY,
        });

  const isOpen = () => modalEl.classList.contains(openClass) || !modalEl.hidden;

  function applyOpenState(open) {
    applyMotionState(modalEl, open);
    modalEl.hidden = !open;
    modalEl.classList.toggle(openClass, open);
    modalEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (bodyClass) doc?.body?.classList.toggle(bodyClass, open);
  }

  function open({ reason = 'manual', event = null, focusTarget = null, motion = 'auto' } = {}) {
    if (destroyed || isOpen()) return;
    applyMotionMode(modalEl, { motion, reason, event });
    const target =
      focusTarget ||
      (typeof options.focusTarget === 'function' ? options.focusTarget() : options.focusTarget);
    modalEl.hidden = false;
    applyOpenState(true);
    interaction?.refresh();
    interaction?.raise();
    if (typeof onOpen === 'function') onOpen({ reason, event });
    try {
      target?.focus?.();
      target?.select?.();
    } catch (_error) {}
  }

  function close({ reason = 'manual', event = null, motion = 'auto' } = {}) {
    if (destroyed || !isOpen()) return;
    applyMotionMode(modalEl, { motion, reason, event });
    applyOpenState(false);
    if (typeof onClose === 'function') onClose({ reason, event });
  }

  function requestClose(reason, event) {
    if (destroyed || !isOpen()) return;
    const allowed = typeof onRequestClose === 'function' ? onRequestClose({ reason, event }) : true;
    if (allowed === false) return;
    close({ reason, event });
  }

  function toggle({ reason = 'toggle', event = null, focusTarget = null, motion = 'auto' } = {}) {
    if (isOpen()) close({ reason, event, motion });
    else open({ reason, event, focusTarget, motion });
  }

  function onClick(event) {
    if (!isOpen()) return;
    const closeButton = event.target?.closest?.(closeSelector);
    if (closeButton && modalEl.contains(closeButton)) {
      requestClose('close-button', event);
      return;
    }
    if (closeOnBackdrop && event.target === modalEl) requestClose('backdrop', event);
  }

  function onKeydown(event) {
    if (!isOpen()) return;
    if (closeOnEscape && event.key === 'Escape') {
      event.preventDefault();
      requestClose('escape', event);
      return;
    }
    if (closeOnEnter && event.key === 'Enter') {
      event.preventDefault();
      requestClose('enter', event);
    }
  }

  function destroy() {
    if (destroyed) return;
    close({ reason: 'destroy' });
    destroyed = true;
    modalEl.removeEventListener('click', onClick);
    doc?.removeEventListener?.('keydown', onKeydown);
    interaction?.destroy();
  }

  modalEl.addEventListener('click', onClick);
  doc?.addEventListener?.('keydown', onKeydown);
  applyOpenState(isOpen());

  return { open, close, toggle, destroy, isOpen, interaction };
}

export function makeModalInteractive(target, options = {}) {
  const card = resolveModalCard(target, options.cardSelector);
  if (!card) return { destroy() {}, refresh() {}, reset() {}, raise() {}, getLayout: () => null };

  const doc = card.ownerDocument;
  const win = doc?.defaultView || globalThis;
  const cleanups = [];
  const handles = [];
  const dragHandles = [...card.querySelectorAll(options.dragHandleSelector || DRAG_HANDLE_SELECTOR)];
  let dragState = null;
  let resizeState = null;
  let destroyed = false;

  card.dataset.vuiModalInteractive = 'true';

  if (options.draggable !== false) {
    for (const handle of dragHandles) {
      handle.addEventListener('pointerdown', onDragStart);
      cleanups.push(() => handle.removeEventListener('pointerdown', onDragStart));
    }
  }

  if (options.resizable !== false) {
    for (const edge of options.resizeEdges || RESIZE_EDGES) {
      const handle = ensureResizeHandle(card, edge);
      handle.addEventListener('pointerdown', onResizeStart);
      handles.push(handle);
      cleanups.push(() => handle.removeEventListener('pointerdown', onResizeStart));
    }
  }

  win?.addEventListener?.('resize', refresh);
  cleanups.push(() => win?.removeEventListener?.('resize', refresh));

  function onDragStart(event) {
    if (destroyed || event.button !== 0 || event.target?.closest?.(DRAG_BLOCK_SELECTOR)) return;
    if (event.pointerType === 'touch') return;
    const layout = currentLayout(card, options);
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
    raise();
    card.classList.add('is-vui-modal-dragging');
    card.setPointerCapture?.(event.pointerId);
    doc.addEventListener('pointermove', onDragMove);
    doc.addEventListener('pointerup', onDragEnd);
    doc.addEventListener('pointercancel', onDragEnd);
    event.preventDefault();
  }

  function onDragMove(event) {
    if (!dragState || !samePointer(event, dragState)) return;
    const next = clampModalInteractionLayout(
      {
        ...dragState.layout,
        x: dragState.layout.x + event.clientX - dragState.startX,
        y: dragState.layout.y + event.clientY - dragState.startY,
      },
      modalViewport(doc),
      interactionConstraints(card, options),
    );
    applyModalLayout(card, next, { size: false });
    event.preventDefault();
  }

  function onDragEnd(event) {
    if (!dragState || !samePointer(event, dragState)) return;
    dragState = null;
    card.classList.remove('is-vui-modal-dragging');
    card.releasePointerCapture?.(event.pointerId);
    doc.removeEventListener('pointermove', onDragMove);
    doc.removeEventListener('pointerup', onDragEnd);
    doc.removeEventListener('pointercancel', onDragEnd);
  }

  function onResizeStart(event) {
    if (destroyed || event.button !== 0) return;
    const edge = event.currentTarget?.dataset?.vuiModalResizeHandle;
    if (!edge) return;
    const layout = currentLayout(card, options);
    resizeState = {
      pointerId: event.pointerId,
      edge,
      handle: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      layout,
    };
    raise();
    card.classList.add('is-vui-modal-resizing');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    doc.addEventListener('pointermove', onResizeMove);
    doc.addEventListener('pointerup', onResizeEnd);
    doc.addEventListener('pointercancel', onResizeEnd);
    event.preventDefault();
  }

  function onResizeMove(event) {
    if (!resizeState || !samePointer(event, resizeState)) return;
    const next = calculateModalResizeLayout({
      edge: resizeState.edge,
      layout: resizeState.layout,
      delta: {
        x: event.clientX - resizeState.startX,
        y: event.clientY - resizeState.startY,
      },
      viewport: modalViewport(doc),
      constraints: interactionConstraints(card, options),
    });
    applyModalLayout(card, next, { size: true });
    event.preventDefault();
  }

  function onResizeEnd(event) {
    if (!resizeState || !samePointer(event, resizeState)) return;
    const handle = resizeState.handle;
    resizeState = null;
    card.classList.remove('is-vui-modal-resizing');
    handle?.releasePointerCapture?.(event.pointerId);
    doc.removeEventListener('pointermove', onResizeMove);
    doc.removeEventListener('pointerup', onResizeEnd);
    doc.removeEventListener('pointercancel', onResizeEnd);
  }

  function refresh() {
    if (destroyed) return;
    const next = clampModalInteractionLayout(currentLayout(card, options), modalViewport(doc), interactionConstraints(card, options));
    applyModalLayout(card, next, { size: hasExplicitSize(card) });
  }

  function reset() {
    card.style.removeProperty('--vui-modal-x');
    card.style.removeProperty('--vui-modal-y');
    card.style.removeProperty('width');
    card.style.removeProperty('height');
  }

  function raise() {
    return raiseModalStack(card);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cleanups.forEach((cleanup) => cleanup());
    handles.forEach((handle) => {
      if (handle.dataset.vuiModalGenerated === 'true') handle.remove();
    });
    card.classList.remove('is-vui-modal-dragging', 'is-vui-modal-resizing');
    delete card.dataset.vuiModalInteractive;
  }

  return { destroy, refresh, reset, raise, getLayout: () => currentLayout(card, options) };
}

export function calculateModalResizeLayout({ edge, layout, delta, viewport, constraints = {} }) {
  let width = finite(layout.width, 0);
  let height = finite(layout.height, 0);
  let x = finite(layout.x, 0);
  let y = finite(layout.y, 0);

  if (edge.includes('left')) {
    const nextWidth = clampSize(width - finite(delta.x, 0), constraints.minWidth, constraints.maxWidth ?? viewport.width);
    x += (width - nextWidth) * leftResizeOffsetRatio(constraints.centeredX);
    width = nextWidth;
  }

  if (edge.includes('bottom')) {
    const nextHeight = clampSize(height + finite(delta.y, 0), constraints.minHeight, constraints.maxHeight ?? viewport.height);
    y += (nextHeight - height) * bottomResizeOffsetRatio(constraints.centeredY);
    height = nextHeight;
  }

  return clampModalInteractionLayout({ ...layout, x, y, width, height }, viewport, constraints);
}

export function calculateNextModalStackIndex({ current = 0, host = 0, card = 0, base = MODAL_STACK_BASE } = {}) {
  return Math.max(
    finite(Number(current), MODAL_STACK_BASE),
    finite(Number(host), 0),
    finite(Number(card), 0),
    finite(Number(base), MODAL_STACK_BASE),
  ) + 1;
}

export function clampModalInteractionLayout(layout, viewport, constraints = {}) {
  const margin = finite(constraints.margin, 12);
  const minWidth = finite(constraints.minWidth, 220);
  const minHeight = finite(constraints.minHeight, 140);
  const maxWidth = Math.max(minWidth, finite(constraints.maxWidth, finite(viewport.width, 1024) - margin * 2));
  const maxHeight = Math.max(minHeight, finite(constraints.maxHeight, finite(viewport.height, 768) - margin * 2));
  const width = clampSize(layout.width, minWidth, maxWidth);
  const height = clampSize(layout.height, minHeight, maxHeight);
  const viewportWidth = finite(viewport.width, width + margin * 2);
  const viewportHeight = finite(viewport.height, height + margin * 2);
  const rawX = finite(layout.x, 0);
  const rawY = finite(layout.y, 0);

  return {
    x:
      constraints.centeredX === false
        ? clampAnchoredOffset(rawX, layout.originLeft, width, viewportWidth, margin)
        : clampCenteredOffset(rawX, width, viewportWidth, margin),
    y:
      constraints.centeredY === false
        ? clampAnchoredOffset(rawY, layout.originTop, height, viewportHeight, margin)
        : clampCenteredOffset(rawY, height, viewportHeight, margin),
    width,
    height,
  };
}

function resolveModalCard(target, cardSelector = '.ui-modal-card') {
  if (!target) return null;
  if (target.matches?.(cardSelector)) return target;
  return target.querySelector?.(cardSelector) || null;
}

function raiseModalStack(card) {
  const host = modalStackHost(card);
  const win = card.ownerDocument?.defaultView || globalThis;
  const hostIndex = cssZIndex(host);
  const cardIndex = cssZIndex(card);
  const next = calculateNextModalStackIndex({
    current: win?.[MODAL_STACK_KEY],
    host: hostIndex,
    card: cardIndex,
    base: hostIndex || cardIndex || MODAL_STACK_BASE,
  });

  if (win) win[MODAL_STACK_KEY] = next;
  if (host && host !== card) {
    host.style.zIndex = String(next);
    host.dataset.vuiModalStack = String(next);
  }
  card.style.zIndex = String(next);
  card.dataset.vuiModalStack = String(next);
  return next;
}

function modalStackHost(card) {
  return card.closest?.('.ui-modal, .ui-modal-backdrop') || card;
}

function ensureResizeHandle(card, edge) {
  const existing = [...card.querySelectorAll('[data-vui-modal-resize-handle]')].find(
    (node) => node.parentElement === card && node.dataset.vuiModalResizeHandle === edge,
  );
  if (existing) return existing;
  const handle = card.ownerDocument.createElement('div');
  handle.className = `vui-modal-resize-handle vui-modal-resize-${edge}`;
  handle.dataset.vuiModalResizeHandle = edge;
  handle.dataset.vuiModalGenerated = 'true';
  handle.setAttribute('aria-hidden', 'true');
  card.append(handle);
  return handle;
}

function currentLayout(card, options) {
  const rect = card.getBoundingClientRect?.() || {};
  const x = cssNumber(card, '--vui-modal-x', 0);
  const y = cssNumber(card, '--vui-modal-y', 0);
  return {
    x,
    y,
    originLeft: finite(rect.left, 0) - x,
    originTop: finite(rect.top, 0) - y,
    width: finite(rect.width, finite(options.defaultWidth, 360)),
    height: finite(rect.height, finite(options.defaultHeight, 260)),
  };
}

function applyModalLayout(card, layout, { size }) {
  card.style.setProperty('--vui-modal-x', `${Math.round(layout.x)}px`);
  card.style.setProperty('--vui-modal-y', `${Math.round(layout.y)}px`);
  if (size) {
    card.style.width = `${Math.round(layout.width)}px`;
    card.style.height = `${Math.round(layout.height)}px`;
  }
}

function interactionConstraints(card, options) {
  const computed = card.ownerDocument?.defaultView?.getComputedStyle?.(card);
  const viewport = modalViewport(card.ownerDocument);
  const handleMargin =
    cssPixel(computed?.getPropertyValue?.('--vui-modal-resize-corner-size'), 18) + 6;
  const margin = finite(options.margin, Math.max(18, handleMargin));
  return {
    margin,
    minWidth: finite(options.minWidth, cssPixel(computed?.minWidth, 220)),
    minHeight: finite(options.minHeight, cssPixel(computed?.minHeight, 140)),
    maxWidth: finite(options.maxWidth, viewport.width - margin * 2),
    maxHeight: finite(options.maxHeight, viewport.height - margin * 2),
    centeredX: options.centeredX ?? isCenteredByParent(card, 'x'),
    centeredY: options.centeredY ?? isCenteredByParent(card, 'y'),
  };
}

function isCenteredByParent(card, axis) {
  const parent = card.parentElement;
  const computed = parent?.ownerDocument?.defaultView?.getComputedStyle?.(parent);
  if (!computed) return false;
  const display = computed.display || '';
  if (!display.includes('flex') && !display.includes('grid')) return false;
  const value = axis === 'x' ? computed.justifyContent : computed.alignItems;
  return value === 'center';
}

function modalViewport(doc) {
  const win = doc?.defaultView || globalThis;
  return {
    width: finite(win?.innerWidth, doc?.documentElement?.clientWidth || 1024),
    height: finite(win?.innerHeight, doc?.documentElement?.clientHeight || 768),
  };
}

function hasExplicitSize(card) {
  return Boolean(card.style.width || card.style.height);
}

function samePointer(event, state) {
  return event.pointerId === undefined || state.pointerId === undefined || event.pointerId === state.pointerId;
}

function cssNumber(node, property, fallback) {
  return finite(Number.parseFloat(node.style.getPropertyValue(property)), fallback);
}

function cssPixel(value, fallback) {
  return finite(Number.parseFloat(value), fallback);
}

function cssZIndex(node) {
  const computed = node?.ownerDocument?.defaultView?.getComputedStyle?.(node)?.zIndex;
  return finite(Number.parseInt(computed, 10), 0);
}

function clampSize(value, min, max) {
  return Math.min(Math.max(finite(value, min), finite(min, 0)), finite(max, Number.POSITIVE_INFINITY));
}

function clampCenteredOffset(offset, size, viewportSize, margin) {
  const min = margin + size / 2 - viewportSize / 2;
  const max = viewportSize / 2 - margin - size / 2;
  if (min > max) return 0;
  return Math.min(Math.max(offset, min), max);
}

function clampAnchoredOffset(offset, origin, size, viewportSize, margin) {
  if (!Number.isFinite(origin)) return offset;
  const min = margin - origin;
  const max = viewportSize - margin - origin - size;
  if (min > max) return max;
  return Math.min(Math.max(offset, min), max);
}

function leftResizeOffsetRatio(centered) {
  return centered === false ? 1 : 0.5;
}

function bottomResizeOffsetRatio(centered) {
  return centered === false ? 0 : 0.5;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/*
 * Drag-only edge resizing with snap-to-collapsed. One primitive drives a
 * resizable panel through consumer callbacks: drag the handle to resize, drag
 * past snapClosedAt to snap the panel closed, drag a collapsed edge back open.
 * The ONLY click action is opening a collapsed panel (a click there has one
 * possible meaning); while open the handle is drag-only — no click-vs-drag
 * threshold or trailing-click suppression anywhere.
 *
 * The consumer owns state: classes, persistence, and the CSS custom prop the
 * size lands in. Drag math is startSize + delta only — layout is never
 * re-read mid-drag, so snap transitions can't feed back into the gesture.
 */

export function defaultSnapClosedAt(min) {
  return Math.max(40, min - 60);
}

// Pure: where does a drag land? Below snapClosedAt the panel collapses;
// otherwise the size clamps to [min, max].
export function resolveEdgeDrag({ startSize, delta, min, max, snapClosedAt }) {
  const snapAt = snapClosedAt ?? defaultSnapClosedAt(min);
  const raw = startSize + delta;
  if (raw < snapAt) return { collapsed: true, size: null };
  return { collapsed: false, size: Math.round(Math.min(max, Math.max(min, raw))) };
}

export function edgeResize(
  handle,
  {
    axis = 'x',
    grow = 1, // -1 when a positive pointer delta should shrink (panel docked at the far edge)
    min,
    max,
    snapClosedAt = defaultSnapClosedAt(min),
    getSize,
    isCollapsed = () => false,
    setCollapsed = () => {},
    applySize,
    commitSize = () => {},
    resizingClass = '',
    ignoreFrom = 'button, a, input, select',
    keyboardStep = 16,
    documentObj = globalThis.document,
  } = {},
) {
  if (!handle || typeof getSize !== 'function' || typeof applySize !== 'function') return () => {};

  let drag = null;

  const syncAria = (size) => {
    if (size != null) handle.setAttribute?.('aria-valuenow', String(size));
  };
  handle.setAttribute?.('aria-valuemin', String(min));
  handle.setAttribute?.('aria-valuemax', String(max));
  if (!isCollapsed()) syncAria(Math.round(getSize() || 0));

  const pointerPos = (event) => (axis === 'y' ? event.clientY : event.clientX);

  const applyResolved = (resolved) => {
    if (resolved.collapsed) {
      if (!drag.collapsed) {
        drag.collapsed = true;
        setCollapsed(true);
      }
      return;
    }
    if (drag.collapsed) {
      drag.collapsed = false;
      setCollapsed(false);
    }
    drag.lastSize = resolved.size;
    applySize(resolved.size);
    syncAria(resolved.size);
  };

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (ignoreFrom && event.target?.closest?.(ignoreFrom)) return;
    const collapsed = !!isCollapsed();
    drag = {
      pointerId: event.pointerId,
      startPos: pointerPos(event),
      startSize: collapsed ? 0 : getSize(),
      wasCollapsed: collapsed,
      collapsed,
      moved: false,
      lastSize: null,
    };
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
    if (resizingClass) documentObj?.body?.classList?.add(resizingClass);
  };

  const onPointerMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.moved = true;
    const delta = (pointerPos(event) - drag.startPos) * grow;
    applyResolved(resolveEdgeDrag({ startSize: drag.startSize, delta, min, max, snapClosedAt }));
  };

  const endDrag = (event, commit) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (resizingClass) documentObj?.body?.classList?.remove(resizingClass);
    const done = drag;
    drag = null;
    if (!commit) return;
    if (!done.moved) {
      // The only click action: opening a collapsed panel.
      if (done.wasCollapsed) setCollapsed(false);
      return;
    }
    if (!done.collapsed && done.lastSize != null) commitSize(done.lastSize);
  };

  const onPointerUp = (event) => endDrag(event, true);
  const onPointerCancel = (event) => endDrag(event, false);

  const onKeyDown = (event) => {
    const incKey = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
    const decKey = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
    const clamp = (value) => Math.round(Math.min(max, Math.max(min, value)));
    const applyAndCommit = (size) => {
      applySize(size);
      commitSize(size);
      syncAria(size);
    };
    if (event.key === 'Enter' || event.key === ' ') {
      setCollapsed(!isCollapsed());
      event.preventDefault?.();
      return;
    }
    if (isCollapsed()) return;
    if (event.key === incKey || event.key === decKey) {
      const positional = event.key === incKey ? 1 : -1;
      applyAndCommit(clamp(getSize() + positional * grow * keyboardStep));
    } else if (event.key === 'Home') {
      applyAndCommit(min);
    } else if (event.key === 'End') {
      applyAndCommit(max);
    } else {
      return;
    }
    event.preventDefault?.();
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerCancel);
  handle.addEventListener('keydown', onKeyDown);
  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerCancel);
    handle.removeEventListener('keydown', onKeyDown);
  };
}

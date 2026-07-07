/*
 * Shared pointer-drag wiring for floating panels that aren't built on the
 * .ui-modal-card frame (makeModalInteractive covers that family — see
 * modal.js). Settings popovers, chat panels, and vellum's own feedback
 * capture widget all need the same pointerdown/move/up state machine; this
 * is the one copy call sites converge on.
 *
 * Upstreamed from biblioplex's app-owned makeDraggable.js (BEN-731/BEN-735)
 * so app code and the design system share a single implementation.
 *
 * The helper only knows about pointer plumbing (capture, guards, delta
 * math). Positioning — where the delta gets written, how it's clamped,
 * whether it's persisted — stays with the caller via onMove/onEnd, since
 * that varies by site (CSS custom properties vs. absolute left/top,
 * clamp-every-move vs. clamp-on-drop, persist-to-storage or not).
 */
const DEFAULT_IGNORE_SELECTOR = 'button, input, select, textarea, a';

export function makeDraggable(
  handleEl,
  {
    targetEl = handleEl,
    documentObj = handleEl?.ownerDocument,
    ignoreSelector = DEFAULT_IGNORE_SELECTOR,
    activeClass = 'is-dragging',
    onStart,
    onMove,
    onEnd,
  } = {},
) {
  if (!handleEl || !documentObj) return { destroy() {} };

  let dragState = null;

  const onPointerDown = (event) => {
    if (event.pointerType === 'touch') return;
    if (event.button !== undefined && event.button !== 0) return;
    if (ignoreSelector && event.target?.closest?.(ignoreSelector)) return;
    const start = onStart?.(event);
    if (start === false) return;
    dragState = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ...start,
    };
    targetEl?.classList.add(activeClass);
    handleEl.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const samePointer = (event) =>
    event.pointerId === undefined ||
    dragState?.pointerId === undefined ||
    event.pointerId === dragState.pointerId;

  const onPointerMove = (event) => {
    if (!dragState || !samePointer(event)) return;
    onMove?.({
      dx: event.clientX - dragState.x,
      dy: event.clientY - dragState.y,
      start: dragState,
      event,
    });
  };

  const onPointerUp = (event) => {
    if (!dragState || !samePointer(event)) return;
    const finished = dragState;
    dragState = null;
    targetEl?.classList.remove(activeClass);
    handleEl.releasePointerCapture?.(event?.pointerId);
    onEnd?.({
      dx: event.clientX - finished.x,
      dy: event.clientY - finished.y,
      start: finished,
      event,
    });
  };

  handleEl.addEventListener('pointerdown', onPointerDown);
  documentObj.addEventListener('pointermove', onPointerMove);
  documentObj.addEventListener('pointerup', onPointerUp);
  documentObj.addEventListener('pointercancel', onPointerUp);

  return {
    destroy() {
      dragState = null;
      handleEl.removeEventListener('pointerdown', onPointerDown);
      documentObj.removeEventListener('pointermove', onPointerMove);
      documentObj.removeEventListener('pointerup', onPointerUp);
      documentObj.removeEventListener('pointercancel', onPointerUp);
    },
  };
}

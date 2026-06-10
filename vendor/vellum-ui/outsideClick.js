const activeOutsideClickHandlers = new WeakMap();

function normalizeExcludeSelectors(excludeSelectors) {
  if (!Array.isArray(excludeSelectors)) return [];
  return excludeSelectors.filter((selector) => typeof selector === 'string' && selector.trim());
}

export function outsideClick(targetEl, onOutside, options = {}) {
  const target = targetEl && typeof targetEl === 'object' ? targetEl : null;
  const doc = target?.ownerDocument;
  if (!target || !doc || typeof onOutside !== 'function') return () => {};

  const eventName =
    typeof options.event === 'string' && options.event ? options.event : 'pointerdown';
  const capture = !!options.capture;
  const alsoOnEscape = !!options.alsoOnEscape;
  const excludeSelectors = normalizeExcludeSelectors(options.excludeSelectors);

  const prevCleanup = activeOutsideClickHandlers.get(target);
  if (typeof prevCleanup === 'function') prevCleanup();

  let cleaned = false;

  const isInside = (eventTarget) => {
    if (!eventTarget || typeof eventTarget.closest !== 'function')
      return target.contains(eventTarget);
    if (target.contains(eventTarget)) return true;
    return excludeSelectors.some((selector) => !!eventTarget.closest(selector));
  };

  const handleOutside = (event) => {
    if (isInside(event?.target)) return;
    onOutside(event);
  };

  const handleEscape = (event) => {
    if (event?.key !== 'Escape') return;
    onOutside(event);
  };

  doc.addEventListener(eventName, handleOutside, capture);
  if (alsoOnEscape) doc.addEventListener('keydown', handleEscape);

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    doc.removeEventListener(eventName, handleOutside, capture);
    if (alsoOnEscape) doc.removeEventListener('keydown', handleEscape);
    if (activeOutsideClickHandlers.get(target) === cleanup)
      activeOutsideClickHandlers.delete(target);
  };

  activeOutsideClickHandlers.set(target, cleanup);
  return cleanup;
}

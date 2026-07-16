const INSTANT_REASONS = new Set([
  'enter',
  'escape',
  'hotkey',
  'keyboard',
  'shortcut',
]);

export function motionMode({ motion = 'auto', reason = '', event = null } = {}) {
  if (motion === false || motion === 'none') return 'none';
  if (motion === true) return 'auto';
  if (event?.type === 'keydown' || event?.type === 'keyup') return 'none';
  // Keyboard-activated and programmatic clicks have detail 0; pointer clicks
  // have a positive click count.
  if (event?.type === 'click' && Number(event.detail) === 0) return 'none';
  return INSTANT_REASONS.has(String(reason).trim().toLowerCase()) ? 'none' : 'auto';
}

export function applyMotionMode(element, detail = {}) {
  const mode = motionMode(detail);
  element?.setAttribute?.('data-vui-motion', mode);
  return mode;
}

export function applyMotionState(element, open) {
  const state = open ? 'open' : 'closed';
  element?.setAttribute?.('data-vui-state', state);
  return state;
}

export function setPopoverTransformOrigin(triggerEl, panelEl) {
  const trigger = triggerEl?.getBoundingClientRect?.();
  const panel = panelEl?.getBoundingClientRect?.();
  if (!trigger || !panel || !panelEl?.style?.setProperty) return null;

  const width = finite(panel.width, finite(panel.right, 0) - finite(panel.left, 0));
  const height = finite(panel.height, finite(panel.bottom, 0) - finite(panel.top, 0));
  if (width <= 0 || height <= 0) return null;

  const triggerX = midpoint(trigger.left, trigger.right);
  const triggerY = midpoint(trigger.top, trigger.bottom);
  const x = clamp(triggerX - finite(panel.left, 0), 0, width);
  const y = clamp(triggerY - finite(panel.top, 0), 0, height);
  const origin = { x, y };

  panelEl.style.setProperty('--vui-popover-origin-x', `${round(x)}px`);
  panelEl.style.setProperty('--vui-popover-origin-y', `${round(y)}px`);
  return origin;
}

function midpoint(start, end) {
  return (finite(start, 0) + finite(end, finite(start, 0))) / 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

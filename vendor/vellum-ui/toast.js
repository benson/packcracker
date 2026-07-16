import { applyMotionMode, applyMotionState } from './motion.js';

const MIN_LEAVE_FALLBACK_MS = 260;

function ensureStack(documentRef) {
  let stack = documentRef.querySelector('.toast-stack');
  if (!stack) {
    stack = documentRef.createElement('div');
    stack.className = 'toast-stack';
    documentRef.body.append(stack);
  }
  return stack;
}

export function toast(message, options = {}) {
  const {
    tone = 'neutral',
    duration = 4000,
    dismissLabel = 'dismiss',
    documentRef = globalThis.document,
    motion = 'auto',
    reason = 'manual',
    event = null,
  } = options;
  if (!documentRef?.createElement) return null;

  const stack = ensureStack(documentRef);
  const node = documentRef.createElement('div');
  node.className = `toast toast-${String(tone || 'neutral').trim()}`;
  node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  applyMotionMode(node, { motion, reason, event });
  applyMotionState(node, true);

  const messageNode = documentRef.createElement('span');
  messageNode.className = 'toast-message';
  messageNode.textContent = String(message ?? '');
  node.append(messageNode);

  let timer = null;
  let leaving = false;
  let removed = false;
  let startedAt = 0;
  let remaining = Math.max(0, Number(duration) || 0);
  const pausedBy = new Set();
  const win = documentRef.defaultView || globalThis;
  const setTimer = win.setTimeout?.bind(win) || globalThis.setTimeout;
  const clearTimer = win.clearTimeout?.bind(win) || globalThis.clearTimeout;

  const clearScheduledDismiss = ({ debit = false } = {}) => {
    if (timer == null) return;
    clearTimer(timer);
    timer = null;
    if (debit) remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };

  const cleanup = () => {
    if (removed) return;
    removed = true;
    clearScheduledDismiss();
    node.removeEventListener('pointerenter', onPointerEnter);
    node.removeEventListener('pointerleave', onPointerLeave);
    node.removeEventListener('focusin', onFocusIn);
    node.removeEventListener('focusout', onFocusOut);
    documentRef.removeEventListener?.('visibilitychange', onVisibilityChange);
    node.remove();
    if (!stack.childElementCount) stack.remove();
  };

  const dismiss = ({ reason: dismissReason = 'manual', event: dismissEvent = null, motion: dismissMotion = motion } = {}) => {
    if (leaving) return;
    leaving = true;
    clearScheduledDismiss();
    applyMotionMode(node, { motion: dismissMotion, reason: dismissReason, event: dismissEvent });
    applyMotionState(node, false);
    node.classList.add('is-leaving');
    const onTransitionEnd = (transitionEvent) => {
      if (transitionEvent.target !== node) return;
      node.removeEventListener('transitionend', onTransitionEnd);
      cleanup();
    };
    node.addEventListener('transitionend', onTransitionEnd);
    setTimer(cleanup, leaveFallbackMs(node, win));
  };

  const scheduleDismiss = () => {
    if (leaving || remaining <= 0 || pausedBy.size) return;
    startedAt = Date.now();
    timer = setTimer(() => dismiss({ reason: 'timeout' }), remaining);
  };

  const pause = (source = 'manual') => {
    pausedBy.add(source);
    clearScheduledDismiss({ debit: true });
  };

  const resume = (source = 'manual') => {
    pausedBy.delete(source);
    scheduleDismiss();
  };

  function onPointerEnter() {
    pause('pointer');
  }

  function onPointerLeave() {
    resume('pointer');
  }

  function onFocusIn() {
    pause('focus');
  }

  function onFocusOut(focusEvent) {
    if (!node.contains?.(focusEvent.relatedTarget)) resume('focus');
  }

  function onVisibilityChange() {
    if (documentRef.hidden) pause('document');
    else resume('document');
  }

  const dismissButton = documentRef.createElement('button');
  dismissButton.className = 'icon-btn toast-dismiss';
  dismissButton.type = 'button';
  dismissButton.setAttribute('aria-label', dismissLabel);
  dismissButton.textContent = '×';
  dismissButton.addEventListener('click', (clickEvent) =>
    dismiss({ reason: 'dismiss', event: clickEvent }),
  );
  node.append(dismissButton);

  node.addEventListener('pointerenter', onPointerEnter);
  node.addEventListener('pointerleave', onPointerLeave);
  node.addEventListener('focusin', onFocusIn);
  node.addEventListener('focusout', onFocusOut);
  documentRef.addEventListener?.('visibilitychange', onVisibilityChange);
  stack.append(node);
  if (documentRef.hidden) pausedBy.add('document');
  scheduleDismiss();
  return { el: node, dismiss, pause, resume };
}

function leaveFallbackMs(node, win) {
  const style = win.getComputedStyle?.(node);
  return resolveToastLeaveFallbackMs(style);
}

export function resolveToastLeaveFallbackMs(style = {}) {
  const durations = cssTimeList(style?.transitionDuration);
  const delays = cssTimeList(style?.transitionDelay);
  const longest = durations.reduce(
    (max, duration, index) => Math.max(max, duration + (delays[index % Math.max(delays.length, 1)] || 0)),
    0,
  );
  return Math.max(MIN_LEAVE_FALLBACK_MS, longest + 50);
}

function cssTimeList(value = '') {
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const number = Number.parseFloat(part);
      if (!Number.isFinite(number)) return 0;
      return part.endsWith('ms') ? number : number * 1000;
    });
}

const LEAVE_FALLBACK_MS = 260;

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
  } = options;
  if (!documentRef?.createElement) return null;

  const stack = ensureStack(documentRef);
  const node = documentRef.createElement('div');
  node.className = `toast toast-${String(tone || 'neutral').trim()}`;
  node.setAttribute('role', tone === 'danger' ? 'alert' : 'status');

  const messageNode = documentRef.createElement('span');
  messageNode.className = 'toast-message';
  messageNode.textContent = String(message ?? '');
  node.append(messageNode);

  let timer = null;
  let leaving = false;
  const dismiss = () => {
    if (leaving) return;
    leaving = true;
    if (timer) clearTimeout(timer);
    node.classList.add('is-leaving');
    const remove = () => {
      node.remove();
      if (!stack.childElementCount) stack.remove();
    };
    node.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, LEAVE_FALLBACK_MS);
  };

  const dismissButton = documentRef.createElement('button');
  dismissButton.className = 'icon-btn toast-dismiss';
  dismissButton.type = 'button';
  dismissButton.setAttribute('aria-label', dismissLabel);
  dismissButton.textContent = '×';
  dismissButton.addEventListener('click', dismiss);
  node.append(dismissButton);

  stack.append(node);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return { el: node, dismiss };
}

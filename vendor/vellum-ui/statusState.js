import { esc } from './escape.js';
import { buttonHtml } from './controlPrimitives.js';

const VALID_TONES = new Set(['neutral', 'success', 'warn', 'danger']);
const VALID_KINDS = new Set([
  'empty',
  'loading',
  'inline-error',
  'blocking-error',
  'retryable-error',
  'compact',
]);

export function statusStateHtml(options = {}) {
  if ('kind' in options || 'message' in options || 'detail' in options || 'retryAction' in options) {
    return statusPanelHtml(options);
  }
  const safeTone = normalizeTone(options.tone);
  const icon = options.icon || '';
  const iconHtml = icon ? `<span class="status-state-icon">${esc(icon)}</span>` : '';
  return `<span class="status-state status-state-${safeTone}">${iconHtml}<span class="status-state-label">${esc(options.label || '')}</span></span>`;
}

export function renderStatusState(targetEl, options = {}) {
  if (!targetEl) return null;
  const documentObj = targetEl.ownerDocument || document;
  const node =
    'kind' in options || 'message' in options || 'detail' in options || 'retryAction' in options
      ? statusPanelNode(documentObj, options)
      : statusChipNode(documentObj, options);
  targetEl.replaceChildren(node);
  return node;
}

function statusPanelHtml({ kind = 'compact', message = '', detail = '', retryAction = '', retryLabel = 'retry' } = {}) {
  const resolvedKind = normalizeKind(kind);
  const safeDetail = detail ? `<span class="status-state-detail">${esc(detail)}</span>` : '';
  const loadingMarker = resolvedKind === 'loading' ? '<span class="loading-spinner" aria-hidden="true"></span>' : '';
  const retryButton =
    resolvedKind === 'retryable-error' && retryAction
      ? buttonHtml({
          label: retryLabel || 'retry',
          variant: 'secondary',
          classes: 'status-state-retry',
          attrs: { 'data-status-action': retryAction },
        })
      : '';
  return `<div class="status-state status-state-${resolvedKind}" role="${roleForKind(resolvedKind)}" aria-live="${liveForKind(resolvedKind)}">${loadingMarker}<span class="status-state-message">${esc(message || '')}</span>${safeDetail}${retryButton}</div>`;
}

function statusChipNode(documentObj, { label, tone = 'neutral', icon = '' } = {}) {
  const node = documentObj.createElement('span');
  node.className = `status-state status-state-${normalizeTone(tone)}`;
  if (icon) {
    const iconNode = documentObj.createElement('span');
    iconNode.className = 'status-state-icon';
    iconNode.textContent = icon;
    node.append(iconNode);
  }
  const labelNode = documentObj.createElement('span');
  labelNode.className = 'status-state-label';
  labelNode.textContent = label || '';
  node.append(labelNode);
  return node;
}

function statusPanelNode(documentObj, options = {}) {
  const resolvedKind = normalizeKind(options.kind);
  const root = documentObj.createElement('div');
  root.className = `status-state status-state-${resolvedKind}`;
  root.setAttribute('role', roleForKind(resolvedKind));
  root.setAttribute('aria-live', liveForKind(resolvedKind));

  if (resolvedKind === 'loading') {
    const spinner = documentObj.createElement('span');
    spinner.className = 'loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    root.append(spinner);
  }

  const message = documentObj.createElement('span');
  message.className = 'status-state-message';
  message.textContent = options.message || '';
  root.append(message);

  if (options.detail) {
    const detail = documentObj.createElement('span');
    detail.className = 'status-state-detail';
    detail.textContent = options.detail;
    root.append(detail);
  }

  if (resolvedKind === 'retryable-error' && options.retryAction) {
    const retryButton = documentObj.createElement('button');
    retryButton.className = 'btn btn-secondary status-state-retry';
    retryButton.type = 'button';
    retryButton.dataset.statusAction = options.retryAction;
    retryButton.textContent = options.retryLabel || 'retry';
    root.append(retryButton);
  }
  return root;
}

function normalizeTone(tone) {
  return VALID_TONES.has(tone) ? tone : 'neutral';
}

function normalizeKind(kind) {
  return VALID_KINDS.has(kind) ? kind : 'compact';
}

function roleForKind(kind) {
  return kind === 'inline-error' || kind === 'blocking-error' || kind === 'retryable-error'
    ? 'alert'
    : 'status';
}

function liveForKind(kind) {
  return kind === 'inline-error' || kind === 'blocking-error' || kind === 'retryable-error'
    ? 'assertive'
    : 'polite';
}

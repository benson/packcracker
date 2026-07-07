/*
 * Feedback capture — the shared file-it-to-Linear widget.
 *
 * Upstreamed from biblioplex's feedbackCapture.js. The widget collects a note,
 * optional annotated screenshot, and page diagnostics into a bundle and POSTs
 * it to a feedback endpoint (the biblioplex worker's /feedback, which routes
 * to a Linear project by the bundle's `project` slug).
 *
 * Two integration levels:
 * - mountFeedbackCapture(options): builds the whole widget DOM (plus an
 *   optional floating opener button), binds it, and returns a cleanup. The
 *   one-liner for static sites. Pass requireOwnerKey: true on public pages so
 *   the widget only mounts for machines holding the owner key.
 * - bindFeedbackCapture(options): binds existing markup (see
 *   mountFeedbackCaptureDom for the expected element contract). Used by apps
 *   that own their markup, e.g. biblioplex.
 */
import { el } from './dom.js';
import { toast } from './toast.js';
import { makeDraggable } from './makeDraggable.js';

export const FEEDBACK_CAPTURE_KIND = 'vellum.feedback';
export const FEEDBACK_CAPTURE_VERSION = 1;
export const FEEDBACK_CAPTURE_SHORTCUT = 'Ctrl+Alt+F';
export const FEEDBACK_OWNER_KEY_STORAGE = 'vui_feedback_owner_key';
export const FEEDBACK_OWNER_KEY_PARAM = 'feedback-key';
export const FEEDBACK_OWNER_KEY_HEADER = 'X-Feedback-Owner-Key';

const FEEDBACK_EDGE_MARGIN = 12;
const FEEDBACK_RESIZE_HANDLES = ['left', 'right', 'bottom', 'bottom-left'];
const DEFAULT_ANNOTATION_COLORS = {
  pen: '#ff2f2f',
  highlight: 'rgba(255, 226, 72, 0.46)',
};
const ANNOTATION_TOOL_BY_MODE = new Map([
  ['pointer', null],
  ['draw', 'pen'],
]);
const ANNOTATION_MODES = new Set(ANNOTATION_TOOL_BY_MODE.keys());

const REPORTER_FLOWS = new Map([
  ['owner-dogfood', 'owner / dogfood'],
  ['public-user', 'other user'],
]);

function cleanText(value, max = 5000) {
  return String(value == null ? '' : value)
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, max);
}

function screenshotMimeType(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);/);
  return match?.[1] || 'image/png';
}

function blobToDataUrl(blob) {
  if (!blob) return Promise.resolve('');
  const Reader = globalThis.FileReader;
  if (typeof Reader !== 'function') return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('failed to read clipboard image'));
    reader.readAsDataURL(blob);
  });
}

export function reporterFlowLabel(flow) {
  return REPORTER_FLOWS.get(flow) || REPORTER_FLOWS.get('public-user');
}

export function normalizeReporterFlow(value) {
  const flow = String(value || '').trim();
  return REPORTER_FLOWS.has(flow) ? flow : 'public-user';
}

function readJsonStorage(key, storageObj = globalThis.localStorage) {
  try {
    const raw = storageObj?.getItem?.(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

function writeJsonStorage(key, value, storageObj = globalThis.localStorage) {
  try {
    storageObj?.setItem?.(key, JSON.stringify(value));
  } catch (_e) {
    return;
  }
}

// ---- owner key ----
// Public static sites gate the widget on a key stored per machine. Visit any
// page once with ?feedback-key=<key> to adopt it (the param is stripped from
// the URL); the worker validates the key on tokenless submissions.

export function feedbackOwnerKey(storageObj = globalThis.localStorage) {
  try {
    return String(storageObj?.getItem?.(FEEDBACK_OWNER_KEY_STORAGE) || '');
  } catch (_e) {
    return '';
  }
}

export function adoptFeedbackOwnerKeyFromUrl({
  locationObj = globalThis.location,
  historyObj = globalThis.history,
  storageObj = globalThis.localStorage,
} = {}) {
  try {
    const url = new URL(String(locationObj?.href || ''));
    const key = url.searchParams.get(FEEDBACK_OWNER_KEY_PARAM);
    if (!key) return feedbackOwnerKey(storageObj);
    storageObj?.setItem?.(FEEDBACK_OWNER_KEY_STORAGE, key);
    url.searchParams.delete(FEEDBACK_OWNER_KEY_PARAM);
    historyObj?.replaceState?.(null, '', url.pathname + url.search + url.hash);
    return key;
  } catch (_e) {
    return feedbackOwnerKey(storageObj);
  }
}

// ---- layout math ----

function feedbackViewport(documentObj = globalThis.document) {
  const win = documentObj?.defaultView || globalThis;
  const docEl = documentObj?.documentElement;
  return {
    width: win?.innerWidth || docEl?.clientWidth || 1024,
    height: win?.innerHeight || docEl?.clientHeight || 768,
  };
}

export function clampFeedbackSize(size, viewport = feedbackViewport()) {
  const maxWidth = Math.max(300, viewport.width - FEEDBACK_EDGE_MARGIN * 2);
  const maxHeight = Math.max(260, viewport.height - FEEDBACK_EDGE_MARGIN * 2);
  return {
    width: Math.max(Math.min(320, maxWidth), Math.min(Number(size?.width) || 360, maxWidth)),
    height: Math.max(Math.min(280, maxHeight), Math.min(Number(size?.height) || 360, maxHeight)),
  };
}

export function clampFeedbackPosition(
  position,
  viewport = feedbackViewport(),
  size = { width: 360, height: 360 },
) {
  const width = Math.min(Number(size?.width) || 360, viewport.width - FEEDBACK_EDGE_MARGIN * 2);
  const height = Math.min(Number(size?.height) || 360, viewport.height - FEEDBACK_EDGE_MARGIN * 2);
  const maxLeft = Math.max(FEEDBACK_EDGE_MARGIN, viewport.width - width - FEEDBACK_EDGE_MARGIN);
  const maxTop = Math.max(FEEDBACK_EDGE_MARGIN, viewport.height - height - FEEDBACK_EDGE_MARGIN);
  return {
    left: Math.max(FEEDBACK_EDGE_MARGIN, Math.min(Number(position?.left) || maxLeft, maxLeft)),
    top: Math.max(FEEDBACK_EDGE_MARGIN, Math.min(Number(position?.top) || maxTop, maxTop)),
  };
}

export function calculateFeedbackResize({ edge, startRect, delta, viewport = feedbackViewport() }) {
  let left = startRect.left;
  const top = startRect.top;
  let width = startRect.width;
  let height = startRect.height;
  if (edge.includes('right')) width += delta.x;
  if (edge.includes('left')) {
    left += delta.x;
    width -= delta.x;
  }
  if (edge.includes('bottom')) height += delta.y;
  const size = clampFeedbackSize({ width, height }, viewport);
  if (edge.includes('left')) left = startRect.left + startRect.width - size.width;
  const position = clampFeedbackPosition({ left, top }, viewport, size);
  return { position, size };
}

// ---- bundle ----

export function buildFeedbackBundle({
  project = '',
  note = '',
  reporter = null,
  screenshotDataUrl = '',
  annotations = null,
  diagnostics = null,
  recentHistory = [],
  extras = null,
  documentObj = globalThis.document,
  locationObj = globalThis.location,
  navigatorObj = globalThis.navigator,
  now = () => new Date(),
} = {}) {
  const capturedAt = now();
  const win = documentObj?.defaultView || globalThis;
  const flow = normalizeReporterFlow(reporter?.flow);
  const bundle = {
    kind: FEEDBACK_CAPTURE_KIND,
    version: FEEDBACK_CAPTURE_VERSION,
    project: cleanText(project, 40),
    capturedAt: capturedAt.toISOString(),
    note: cleanText(note),
    reporter: {
      flow,
      label: cleanText(reporter?.label || reporterFlowLabel(flow), 160),
      signedIn: Boolean(reporter?.signedIn),
      userLabel: cleanText(reporter?.userLabel || '', 160),
    },
    url: String(locationObj?.href || ''),
    diagnostics: {
      app: cleanText(project, 40),
      capturedAt: capturedAt.toISOString(),
      route: {
        path: String(locationObj?.pathname || ''),
        search: String(locationObj?.search || ''),
      },
      ...(diagnostics || {}),
      browser: {
        userAgent: String(navigatorObj?.userAgent || ''),
        language: String(navigatorObj?.language || ''),
        online: navigatorObj?.onLine ?? null,
        viewport: {
          width: win?.innerWidth || null,
          height: win?.innerHeight || null,
          devicePixelRatio: win?.devicePixelRatio || 1,
        },
      },
      ui: {
        title: String(documentObj?.title || ''),
        bodyClasses: Array.from(documentObj?.body?.classList || []).sort(),
        activeElement:
          documentObj?.activeElement?.id ||
          documentObj?.activeElement?.getAttribute?.('aria-label') ||
          documentObj?.activeElement?.tagName ||
          '',
      },
    },
    recentHistory: Array.isArray(recentHistory) ? recentHistory.slice(0, 8) : [],
    screenshot: screenshotDataUrl
      ? {
          mimeType: screenshotMimeType(screenshotDataUrl),
          dataUrl: screenshotDataUrl,
        }
      : null,
  };
  if (annotations) bundle.annotations = annotations;
  if (extras && typeof extras === 'object') Object.assign(bundle, extras);
  return bundle;
}

// ---- annotation drawing ----

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect?.() || { left: 0, top: 0 };
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function strokeStyle(tool, colors) {
  if (tool === 'highlight') return { color: colors.highlight, width: 18 };
  return { color: colors.pen, width: 4 };
}

function drawPath(ctx, points, style) {
  if (!ctx || !points?.length) return;
  ctx.save?.();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath?.();
  ctx.moveTo?.(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo?.(point.x, point.y);
  if (points.length === 1) ctx.lineTo?.(points[0].x + 0.01, points[0].y + 0.01);
  ctx.stroke?.();
  ctx.restore?.();
}

function drawAnnotationStroke(ctx, stroke, colors) {
  drawPath(ctx, stroke.points, strokeStyle(stroke.tool, colors));
}

async function readPasteEventImageDataUrl(event) {
  const clipboardData = event?.clipboardData;
  const items = Array.from(clipboardData?.items || []);
  for (const item of items) {
    if (!/^image\//i.test(String(item.type || ''))) continue;
    const blob = item.getAsFile?.();
    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl) return dataUrl;
  }
  const files = Array.from(clipboardData?.files || []);
  for (const file of files) {
    if (!/^image\//i.test(String(file.type || ''))) continue;
    const dataUrl = await blobToDataUrl(file);
    if (dataUrl) return dataUrl;
  }
  return '';
}

function annotationSummary(strokes) {
  const tools = Array.from(new Set(strokes.map((stroke) => stroke.tool))).sort();
  return { count: strokes.length, tools };
}

// ---- screen capture ----

function waitAnimationFrame(win = globalThis) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(done, 100);
    if (typeof win?.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => {
        clearTimeout(timeout);
        done();
      });
    } else {
      clearTimeout(timeout);
      setTimeout(done, 16);
    }
  });
}

function withTimeout(promise, timeoutMs, message) {
  if (!promise || typeof promise.then !== 'function') return promise;
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

export async function captureScreenDataUrl({
  documentObj = globalThis.document,
  navigatorObj = globalThis.navigator,
  beforeCaptureFrame = null,
  afterCaptureFrame = null,
} = {}) {
  const mediaDevices = navigatorObj?.mediaDevices;
  if (!mediaDevices?.getDisplayMedia) {
    throw new Error('screen capture unavailable');
  }
  const stream = await mediaDevices.getDisplayMedia({
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    video: { displaySurface: 'browser' },
    audio: false,
  });
  try {
    const video = documentObj.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await withTimeout(video.play?.(), 1000, 'screen capture video timed out');
    if (!video.videoWidth || !video.videoHeight) {
      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
        setTimeout(resolve, 250);
      });
    }
    const win = documentObj?.defaultView || globalThis;
    const canvas = documentObj.createElement('canvas');
    const sourceWidth = video.videoWidth || win.innerWidth || 1280;
    const sourceHeight = video.videoHeight || win.innerHeight || 720;
    const scale = Math.min(1, 1600 / sourceWidth, 1000 / sourceHeight);
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('screen capture canvas unavailable');
    await beforeCaptureFrame?.();
    await waitAnimationFrame(win);
    await waitAnimationFrame(win);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    await afterCaptureFrame?.();
    for (const track of stream?.getTracks?.() || []) track.stop?.();
  }
}

// ---- submission ----

export function prepareFeedbackSubmission(bundle) {
  const screenshot = bundle?.screenshot?.dataUrl
    ? {
        captured: true,
        mimeType: bundle.screenshot.mimeType || screenshotMimeType(bundle.screenshot.dataUrl),
        dataUrl: bundle.screenshot.dataUrl,
        approxBytes: Math.ceil(String(bundle.screenshot.dataUrl).length * 0.75),
      }
    : null;
  const { screenshot: _screenshot, ...rest } = bundle || {};
  return {
    ...rest,
    screenshot,
  };
}

async function readJsonResponse(res) {
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    // Non-JSON error bodies are reported as plain text below.
  }
  if (!res.ok) {
    const err = new Error(data?.error || text || 'feedback submit failed: ' + res.status);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function feedbackEndpoint(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/g, '') + '/feedback';
}

export async function submitFeedbackBundle(
  bundle,
  { apiUrl, fetchImpl = globalThis.fetch, getToken = null, ownerKey = '' } = {},
) {
  if (typeof fetchImpl !== 'function') throw new Error('feedback service unavailable');
  if (!apiUrl) throw new Error('feedback apiUrl not configured');
  const token = await getToken?.();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (ownerKey) headers[FEEDBACK_OWNER_KEY_HEADER] = ownerKey;
  const res = await fetchImpl(feedbackEndpoint(apiUrl), {
    method: 'POST',
    headers,
    body: JSON.stringify(prepareFeedbackSubmission(bundle)),
  });
  return readJsonResponse(res);
}

// ---- shortcut ----

export function isFeedbackShortcut(event) {
  if (!event) return false;
  const key = String(event.key || '').toLowerCase();
  if (key !== 'f') return false;
  if (event.altKey && (event.ctrlKey || event.metaKey)) return true;
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return !event.target?.closest?.('input, select, textarea, button, [contenteditable="true"]');
}

// ---- markup builder ----

// Builds the widget DOM that bindFeedbackCapture expects. Returns the nodes;
// callers append them (mountFeedbackCapture does this for you).
export function mountFeedbackCaptureDom(documentObj = globalThis.document, { fab = true } = {}) {
  const canvas = el('canvas', {
    className: 'feedback-annotation-canvas',
    id: 'feedbackCaptureAnnotationCanvas',
    ariaHidden: 'true',
  });
  canvas.hidden = true;

  const head = el(
    'header',
    {
      className: 'feedback-capture-head',
      id: 'feedbackCaptureDragHandle',
      title: 'drag feedback',
    },
    el('h3', { className: 'feedback-capture-title', id: 'feedbackCaptureTitle', text: 'capture feedback' }),
    el('button', {
      className: 'feedback-capture-close rune-close',
      type: 'button',
      ariaLabel: 'close feedback',
      text: '✕',
    }),
  );
  head.setAttribute('data-feedback-capture-drag-handle', '');
  head.querySelector('.feedback-capture-close').setAttribute('data-feedback-capture-close', '');

  const tools = el('div', { className: 'feedback-annotation-tools', ariaLabel: 'annotation tools' });
  for (const [mode, label] of [
    ['pointer', 'pointer'],
    ['draw', 'draw'],
  ]) {
    const button = el('button', {
      className: mode === 'pointer' ? 'feedback-annotation-tool active' : 'feedback-annotation-tool',
      type: 'button',
      text: label,
      ariaPressed: mode === 'pointer' ? 'true' : 'false',
    });
    button.dataset.feedbackAnnotationTool = mode;
    tools.append(button);
  }
  for (const [attr, label] of [
    ['data-feedback-annotation-undo', 'undo'],
    ['data-feedback-annotation-clear', 'clear'],
    ['data-feedback-capture-screenshot', 'screenshot'],
  ]) {
    const button = el('button', { className: 'feedback-annotation-tool', type: 'button', text: label });
    button.setAttribute(attr, '');
    tools.append(button);
  }

  const note = el('textarea', {
    className: 'feedback-capture-note',
    id: 'feedbackCaptureNote',
    placeholder: 'what felt off?',
  });
  note.rows = 4;

  const details = el(
    'details',
    { className: 'feedback-capture-details' },
    el('summary', { text: 'state summary' }),
    el('pre', { id: 'feedbackCaptureSummary' }),
  );
  details.setAttribute('data-feedback-capture-summary-details', '');

  const body = el(
    'div',
    { className: 'feedback-capture-body' },
    tools,
    el('label', { className: 'feedback-capture-label', htmlFor: 'feedbackCaptureNote', text: 'note' }),
    note,
    details,
    el('div', { className: 'feedback-capture-status', id: 'feedbackCaptureStatus', ariaLive: 'polite' }),
  );

  const submit = el(
    'button',
    { className: 'btn', type: 'button' },
    'submit',
    el('span', { className: 'btn-shortcut', ariaHidden: 'true', text: 'ctrl enter' }),
  );
  submit.setAttribute('data-feedback-capture-submit', '');
  submit.setAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  submit.querySelector('.btn-shortcut').setAttribute('data-feedback-capture-submit-shortcut', '');

  const widget = el(
    'section',
    {
      className: 'feedback-capture-widget',
      id: 'feedbackCaptureModal',
      role: 'dialog',
      ariaModal: 'true',
      ariaLabelledby: 'feedbackCaptureTitle',
      ariaHidden: 'true',
    },
    head,
    body,
    el('footer', { className: 'feedback-capture-actions' }, submit),
  );
  widget.hidden = true;

  const nodes = [canvas, widget];
  if (fab) {
    const opener = el(
      'button',
      {
        className: 'fab-btn feedback-capture-fab',
        type: 'button',
        ariaLabel: 'capture feedback',
        title: 'capture feedback (f)',
      },
      el('span', { className: 'fab-glyph', text: '!' }),
      el('span', { className: 'fab-label', text: 'feedback' }),
      el('span', { className: 'fab-shortcut', ariaHidden: 'true', text: 'f' }),
    );
    opener.setAttribute('data-feedback-capture-open', '');
    opener.setAttribute('aria-keyshortcuts', 'F Control+Alt+F');
    nodes.push(el('div', { className: 'fab-cluster' }, opener));
  }
  return nodes;
}

// ---- bind ----

export function bindFeedbackCapture({
  documentObj = globalThis.document,
  navigatorObj = globalThis.navigator,
  locationObj = globalThis.location,
  project = '',
  apiUrl = '',
  getReporter = null,
  getDiagnostics = null,
  getRecentHistory = null,
  getExtras = null,
  getAuthToken = null,
  getOwnerKey = () => feedbackOwnerKey(),
  notify = (message, tone) => toast(message, { tone: tone === 'error' ? 'danger' : 'success' }),
  summaryLines = null,
  captureScreenImpl = captureScreenDataUrl,
  submitFeedbackImpl = submitFeedbackBundle,
  annotationColors = DEFAULT_ANNOTATION_COLORS,
  storagePrefix = 'vui',
  now = () => new Date(),
} = {}) {
  const modal = documentObj?.getElementById('feedbackCaptureModal');
  if (!modal) return () => {};
  const positionKey = storagePrefix + '_feedback_position_v1';
  const sizeKey = storagePrefix + '_feedback_size_v1';
  const noteEl = modal.querySelector('#feedbackCaptureNote');
  const statusEl = modal.querySelector('#feedbackCaptureStatus');
  const summaryEl = modal.querySelector('#feedbackCaptureSummary');
  const summaryDetailsEl = modal.querySelector('[data-feedback-capture-summary-details]');
  const submitShortcutEl = modal.querySelector('[data-feedback-capture-submit-shortcut]');
  const annotationCanvasEl = documentObj.getElementById('feedbackCaptureAnnotationCanvas');
  const dragHandleEl = modal.querySelector('[data-feedback-capture-drag-handle]');
  const openButtons = Array.from(documentObj.querySelectorAll('[data-feedback-capture-open]'));
  const storageObj = documentObj.defaultView?.localStorage || globalThis.localStorage;
  const cleanups = [];
  let screenshotDataUrl = '';
  let submitting = false;
  const isMacLike = /(mac|iphone|ipad|ipod)/i.test(
    String(navigatorObj?.platform || navigatorObj?.userAgent || ''),
  );
  let resizeState = null;
  let annotationMode = 'pointer';
  let annotationTool = null;
  let annotationPointerId = null;
  let draftStroke = null;
  const annotationStrokes = [];

  const setStatus = (message = '') => {
    if (statusEl) statusEl.textContent = message;
  };
  const currentReporter = () => {
    const reporter = getReporter?.();
    if (reporter) return reporter;
    const owner = Boolean(getOwnerKey?.());
    return { flow: owner ? 'owner-dogfood' : 'public-user' };
  };
  const isOwnerReporter = () => normalizeReporterFlow(currentReporter()?.flow) === 'owner-dogfood';

  const viewport = () => feedbackViewport(documentObj);

  const feedbackSize = () => {
    const rect = modal.getBoundingClientRect?.();
    return {
      width: rect?.width || modal.offsetWidth || 360,
      height: rect?.height || modal.offsetHeight || 360,
    };
  };

  const setFeedbackSize = (size, { persist = false } = {}) => {
    const next = clampFeedbackSize(size, viewport());
    modal.style.setProperty('--feedback-capture-width', Math.round(next.width) + 'px');
    modal.style.setProperty('--feedback-capture-height', Math.round(next.height) + 'px');
    if (persist) writeJsonStorage(sizeKey, next, storageObj);
    return next;
  };

  const currentFeedbackPosition = () => {
    const left = parseFloat(modal.style.getPropertyValue('--feedback-capture-left') || '');
    const top = parseFloat(modal.style.getPropertyValue('--feedback-capture-top') || '');
    if (Number.isFinite(left) && Number.isFinite(top)) return { left, top };
    const rect = modal.getBoundingClientRect?.();
    if (rect && (rect.width || rect.height)) return { left: rect.left, top: rect.top };
    return null;
  };

  const setFeedbackPosition = (position, { persist = false, size = null } = {}) => {
    const next = clampFeedbackPosition(position, viewport(), size || feedbackSize());
    modal.style.setProperty('--feedback-capture-left', Math.round(next.left) + 'px');
    modal.style.setProperty('--feedback-capture-top', Math.round(next.top) + 'px');
    modal.classList.add('is-positioned');
    if (persist) writeJsonStorage(positionKey, next, storageObj);
    return next;
  };

  const applyStoredLayout = () => {
    const storedSize = readJsonStorage(sizeKey, storageObj);
    if (storedSize) setFeedbackSize(storedSize);
    const storedPosition = readJsonStorage(positionKey, storageObj);
    if (storedPosition) setFeedbackPosition(storedPosition);
  };

  const clampCurrentFeedbackPosition = ({ persist = false } = {}) => {
    const current = currentFeedbackPosition();
    if (current && modal.classList.contains('is-positioned')) {
      setFeedbackPosition(current, { persist });
    }
  };

  const ensureResizeHandles = () => {
    for (const edge of FEEDBACK_RESIZE_HANDLES) {
      let handle = modal.querySelector(`[data-feedback-capture-resize-handle="${edge}"]`);
      if (!handle) {
        handle = documentObj.createElement('div');
        handle.className = 'feedback-capture-resize-handle feedback-capture-resize-' + edge;
        handle.dataset.feedbackCaptureResizeHandle = edge;
        handle.setAttribute('aria-hidden', 'true');
        modal.appendChild(handle);
      }
      if (!handle.dataset.feedbackCaptureResizeBound) {
        handle.dataset.feedbackCaptureResizeBound = '1';
        handle.addEventListener('pointerdown', onResizeStart);
      }
    }
  };

  const annotationContext = () => {
    try {
      return annotationCanvasEl?.getContext?.('2d') || null;
    } catch (_e) {
      return null;
    }
  };

  const renderAnnotations = (draft = draftStroke) => {
    const ctx = annotationContext();
    if (!ctx || !annotationCanvasEl) return;
    const win = documentObj.defaultView || globalThis;
    const width = win.innerWidth || documentObj.documentElement?.clientWidth || 1024;
    const height = win.innerHeight || documentObj.documentElement?.clientHeight || 768;
    const dpr = win.devicePixelRatio || 1;
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect?.(0, 0, width, height);
    for (const stroke of annotationStrokes) drawAnnotationStroke(ctx, stroke, annotationColors);
    if (draft) drawAnnotationStroke(ctx, draft, annotationColors);
  };

  const resizeAnnotationCanvas = () => {
    if (!annotationCanvasEl) return;
    const win = documentObj.defaultView || globalThis;
    const width = win.innerWidth || documentObj.documentElement?.clientWidth || 1024;
    const height = win.innerHeight || documentObj.documentElement?.clientHeight || 768;
    const dpr = win.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(width * dpr));
    const nextHeight = Math.max(1, Math.round(height * dpr));
    annotationCanvasEl.style.width = width + 'px';
    annotationCanvasEl.style.height = height + 'px';
    if (annotationCanvasEl.width !== nextWidth) annotationCanvasEl.width = nextWidth;
    if (annotationCanvasEl.height !== nextHeight) annotationCanvasEl.height = nextHeight;
    renderAnnotations();
  };

  const clearAnnotations = () => {
    annotationStrokes.splice(0, annotationStrokes.length);
    draftStroke = null;
    renderAnnotations(null);
    syncSummary();
  };

  const setAnnotationMode = (mode) => {
    annotationMode = ANNOTATION_MODES.has(mode) ? mode : 'pointer';
    annotationTool = ANNOTATION_TOOL_BY_MODE.get(annotationMode) || null;
    const drawMode = annotationMode === 'draw';
    documentObj.body?.classList.toggle('feedback-capture-draw-mode', drawMode);
    if (annotationCanvasEl) annotationCanvasEl.hidden = !drawMode || modal.hidden;
    for (const button of modal.querySelectorAll('[data-feedback-annotation-tool]')) {
      const active = button.dataset.feedbackAnnotationTool === annotationMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const setOpen = (open) => {
    modal.hidden = !open;
    modal.classList.toggle('visible', open);
    modal.setAttribute('aria-hidden', open ? 'false' : 'true');
    documentObj.body?.classList.toggle('feedback-capture-open', open);
    setAnnotationMode(annotationMode);
    for (const button of openButtons) button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      applyStoredLayout();
      resizeAnnotationCanvas();
      clearAnnotations();
      setAnnotationMode('pointer');
      if (noteEl) noteEl.value = '';
      screenshotDataUrl = '';
      syncSummary();
      if (summaryDetailsEl) summaryDetailsEl.hidden = !isOwnerReporter();
      setStatus('');
      noteEl?.focus?.();
    } else {
      documentObj.body?.classList.remove('feedback-capture-capturing');
      draftStroke = null;
      annotationPointerId = null;
      setAnnotationMode('pointer');
    }
  };

  const currentBundle = () =>
    buildFeedbackBundle({
      project,
      note: noteEl?.value || '',
      reporter: currentReporter(),
      screenshotDataUrl,
      annotations: annotationStrokes.length ? annotationSummary(annotationStrokes) : null,
      diagnostics: getDiagnostics?.() || null,
      recentHistory: getRecentHistory?.() || [],
      extras: getExtras?.() || null,
      documentObj,
      locationObj,
      navigatorObj,
      now,
    });

  function syncSummary() {
    if (!summaryEl) return;
    const bundle = currentBundle();
    const status = {
      screenshotAttached: Boolean(screenshotDataUrl),
      annotationCount: annotationStrokes.length,
    };
    const lines = summaryLines?.(bundle, status) || [
      'project: ' + (bundle.project || '?'),
      'reporter: ' + (bundle.reporter.label || reporterFlowLabel(bundle.reporter.flow)),
      'route: ' + (bundle.diagnostics.route.path || '/') + (bundle.diagnostics.route.search || ''),
      'screenshot: ' + (status.screenshotAttached ? 'attached' : 'not attached'),
      'annotations: ' + status.annotationCount,
    ];
    summaryEl.textContent = lines.join('\n');
  }

  function syncSubmitShortcutLabel() {
    if (!submitShortcutEl) return;
    submitShortcutEl.textContent = isMacLike ? 'cmd enter' : 'ctrl enter';
  }

  const close = () => setOpen(false);
  const open = () => setOpen(true);

  const captureForSubmit = async () => {
    setStatus('opening browser screenshot prompt...');
    try {
      screenshotDataUrl = await captureScreenImpl({
        documentObj,
        navigatorObj,
        beforeCaptureFrame: () => {
          documentObj.body?.classList.add('feedback-capture-capturing');
        },
        afterCaptureFrame: () => {
          documentObj.body?.classList.remove('feedback-capture-capturing');
        },
      });
      syncSummary();
      return true;
    } catch (_error) {
      documentObj.body?.classList.remove('feedback-capture-capturing');
      screenshotDataUrl = '';
      setStatus('screenshot skipped; feedback will submit without it');
      return false;
    }
  };

  const onCaptureScreenshot = async () => {
    if (submitting) return;
    const capturedScreenshot = await captureForSubmit();
    setStatus(capturedScreenshot ? 'screenshot attached' : 'screenshot not attached');
  };

  const onSubmit = async () => {
    if (submitting) return;
    submitting = true;
    try {
      if (!screenshotDataUrl && annotationStrokes.length) {
        await captureForSubmit();
      }
      setStatus(
        screenshotDataUrl ? 'submitting with screenshot...' : 'submitting without screenshot...',
      );
      const result = await submitFeedbackImpl(currentBundle(), {
        apiUrl,
        getToken: getAuthToken,
        ownerKey: getOwnerKey?.() || '',
      });
      const issue = result?.issue;
      const label = issue?.identifier || issue?.url || 'task';
      const ownerReporter = isOwnerReporter();
      setStatus(
        issue?.url
          ? ownerReporter
            ? 'created ' + label
            : 'feedback received! thank you!'
          : 'feedback saved',
      );
      notify(
        issue?.identifier ? 'feedback sent to Linear as ' + issue.identifier : 'feedback saved',
        'success',
      );
      if (noteEl) noteEl.value = '';
      screenshotDataUrl = '';
      clearAnnotations();
      if (ownerReporter && issue?.url && statusEl) {
        statusEl.textContent = 'created ';
        const link = documentObj.createElement('a');
        link.href = issue.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = issue.identifier || issue.url;
        statusEl.appendChild(link);
      }
    } catch (error) {
      const missingConfig = error?.status === 503 && error?.data?.code === 'linear_not_configured';
      setStatus(missingConfig ? 'Linear is not configured yet' : 'submit failed');
      notify(
        (missingConfig ? 'feedback service needs Linear setup: ' : 'feedback submit failed: ') +
          (error?.message || error),
        'error',
      );
    } finally {
      submitting = false;
    }
  };

  const dragHandle = dragHandleEl
    ? makeDraggable(dragHandleEl, {
        targetEl: modal,
        documentObj,
        onStart: () => {
          const start = setFeedbackPosition(
            currentFeedbackPosition() ||
              readJsonStorage(positionKey, storageObj) || {
                left: FEEDBACK_EDGE_MARGIN,
                top: FEEDBACK_EDGE_MARGIN,
              },
          );
          return { left: start.left, top: start.top };
        },
        onMove: ({ dx, dy, start }) => {
          setFeedbackPosition({ left: start.left + dx, top: start.top + dy });
        },
        onEnd: () => {
          const current = currentFeedbackPosition();
          if (current) setFeedbackPosition(current, { persist: true });
        },
      })
    : { destroy() {} };

  function onResizeStart(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const handle = event.currentTarget?.dataset?.feedbackCaptureResizeHandle
      ? event.currentTarget
      : event.target?.closest?.('[data-feedback-capture-resize-handle]');
    const edge = handle?.dataset?.feedbackCaptureResizeHandle;
    if (!edge) return;
    const currentSize = setFeedbackSize(feedbackSize()) || feedbackSize();
    const currentPosition = setFeedbackPosition(
      currentFeedbackPosition() ||
        readJsonStorage(positionKey, storageObj) || {
          left: FEEDBACK_EDGE_MARGIN,
          top: FEEDBACK_EDGE_MARGIN,
        },
      { size: currentSize },
    );
    resizeState = {
      pointerId: event.pointerId,
      edge,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      startRect: {
        left: currentPosition.left,
        top: currentPosition.top,
        width: currentSize.width,
        height: currentSize.height,
      },
      next: null,
    };
    modal.classList.add('is-resizing');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onResizeMove(event) {
    if (!resizeState) return;
    if (
      event.pointerId !== undefined &&
      resizeState.pointerId !== undefined &&
      event.pointerId !== resizeState.pointerId
    )
      return;
    const next = calculateFeedbackResize({
      edge: resizeState.edge,
      startRect: resizeState.startRect,
      delta: { x: event.clientX - resizeState.startX, y: event.clientY - resizeState.startY },
      viewport: viewport(),
    });
    resizeState.next = next;
    setFeedbackSize(next.size);
    setFeedbackPosition(next.position, { size: next.size });
    event.preventDefault();
  }

  function onResizeEnd(event) {
    if (!resizeState) return;
    if (
      event?.pointerId !== undefined &&
      resizeState.pointerId !== undefined &&
      event.pointerId !== resizeState.pointerId
    )
      return;
    const state = resizeState;
    resizeState = null;
    modal.classList.remove('is-resizing');
    if (state.next) {
      setFeedbackSize(state.next.size, { persist: true });
      setFeedbackPosition(state.next.position, { persist: true, size: state.next.size });
    } else {
      setFeedbackSize(feedbackSize(), { persist: true });
      clampCurrentFeedbackPosition({ persist: true });
    }
    state.handle?.releasePointerCapture?.(event?.pointerId);
  }

  function onAnnotationPointerDown(event) {
    if (!annotationCanvasEl || annotationCanvasEl.hidden) return;
    if (!annotationTool) return;
    if (event.button !== undefined && event.button !== 0) return;
    annotationPointerId = event.pointerId;
    draftStroke = { tool: annotationTool, points: [canvasPoint(event, annotationCanvasEl)] };
    annotationCanvasEl.setPointerCapture?.(event.pointerId);
    renderAnnotations();
    event.preventDefault();
  }

  function onAnnotationPointerMove(event) {
    if (!draftStroke) return;
    if (
      event.pointerId !== undefined &&
      annotationPointerId !== undefined &&
      event.pointerId !== annotationPointerId
    )
      return;
    draftStroke.points.push(canvasPoint(event, annotationCanvasEl));
    renderAnnotations();
    event.preventDefault();
  }

  function onAnnotationPointerEnd(event) {
    if (!draftStroke) return;
    if (
      event?.pointerId !== undefined &&
      annotationPointerId !== undefined &&
      event.pointerId !== annotationPointerId
    )
      return;
    annotationStrokes.push(draftStroke);
    draftStroke = null;
    annotationPointerId = null;
    annotationCanvasEl?.releasePointerCapture?.(event?.pointerId);
    renderAnnotations();
    syncSummary();
    event?.preventDefault?.();
  }

  const onClick = (event) => {
    const toolButton = event.target.closest('[data-feedback-annotation-tool]');
    if (toolButton) {
      setAnnotationMode(toolButton.dataset.feedbackAnnotationTool);
      return;
    }
    if (event.target.closest('[data-feedback-annotation-undo]')) {
      annotationStrokes.pop();
      renderAnnotations();
      syncSummary();
      return;
    }
    if (event.target.closest('[data-feedback-annotation-clear]')) {
      clearAnnotations();
      return;
    }
    if (event.target.closest('[data-feedback-capture-screenshot]')) {
      void onCaptureScreenshot();
      return;
    }
    if (event.target.closest('[data-feedback-capture-close]')) {
      close();
      return;
    }
    if (event.target.closest('[data-feedback-capture-submit]')) {
      onSubmit();
    }
  };

  const onKeydown = (event) => {
    if (isFeedbackShortcut(event)) {
      event.preventDefault();
      open();
      return;
    }
    if (
      !modal.hidden &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.altKey &&
      (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      void onSubmit();
      return;
    }
    if (event.key === 'Escape' && !modal.hidden) {
      event.preventDefault();
      close();
    }
  };

  const onPaste = async (event) => {
    if (modal.hidden || submitting) return;
    const dataUrl = await readPasteEventImageDataUrl(event);
    if (!dataUrl) return;
    screenshotDataUrl = dataUrl;
    syncSummary();
    setStatus('pasted screenshot attached');
    event.preventDefault();
  };

  ensureResizeHandles();
  syncSubmitShortcutLabel();
  modal.addEventListener('click', onClick);
  cleanups.push(() => modal.removeEventListener('click', onClick));
  noteEl?.addEventListener('input', syncSummary);
  cleanups.push(() => noteEl?.removeEventListener('input', syncSummary));
  cleanups.push(() => dragHandle.destroy());
  documentObj.addEventListener('pointermove', onResizeMove);
  documentObj.addEventListener('pointerup', onResizeEnd);
  documentObj.addEventListener('pointercancel', onResizeEnd);
  cleanups.push(() => documentObj.removeEventListener('pointermove', onResizeMove));
  cleanups.push(() => documentObj.removeEventListener('pointerup', onResizeEnd));
  cleanups.push(() => documentObj.removeEventListener('pointercancel', onResizeEnd));
  annotationCanvasEl?.addEventListener('pointerdown', onAnnotationPointerDown);
  annotationCanvasEl?.addEventListener('pointermove', onAnnotationPointerMove);
  annotationCanvasEl?.addEventListener('pointerup', onAnnotationPointerEnd);
  annotationCanvasEl?.addEventListener('pointercancel', onAnnotationPointerEnd);
  cleanups.push(() =>
    annotationCanvasEl?.removeEventListener('pointerdown', onAnnotationPointerDown),
  );
  cleanups.push(() =>
    annotationCanvasEl?.removeEventListener('pointermove', onAnnotationPointerMove),
  );
  cleanups.push(() => annotationCanvasEl?.removeEventListener('pointerup', onAnnotationPointerEnd));
  cleanups.push(() =>
    annotationCanvasEl?.removeEventListener('pointercancel', onAnnotationPointerEnd),
  );
  const onResize = () => {
    resizeAnnotationCanvas();
    clampCurrentFeedbackPosition({ persist: true });
  };
  documentObj.defaultView?.addEventListener?.('resize', onResize);
  cleanups.push(() => documentObj.defaultView?.removeEventListener?.('resize', onResize));
  for (const button of openButtons) {
    button.addEventListener('click', open);
    cleanups.push(() => button.removeEventListener('click', open));
  }
  documentObj.addEventListener('keydown', onKeydown);
  modal.addEventListener('paste', onPaste);
  cleanups.push(() => documentObj.removeEventListener('keydown', onKeydown));
  cleanups.push(() => modal.removeEventListener('paste', onPaste));

  return () => {
    close();
    cleanups.forEach((cleanup) => cleanup());
  };
}

// ---- one-call mount ----

export function mountFeedbackCapture({
  documentObj = globalThis.document,
  requireOwnerKey = false,
  fab = true,
  ...bindOptions
} = {}) {
  const ownerKey = adoptFeedbackOwnerKeyFromUrl();
  if (requireOwnerKey && !ownerKey) return () => {};
  if (documentObj.getElementById('feedbackCaptureModal')) return () => {};
  const nodes = mountFeedbackCaptureDom(documentObj, { fab });
  for (const node of nodes) documentObj.body.append(node);
  const unbind = bindFeedbackCapture({ documentObj, ...bindOptions });
  return () => {
    unbind();
    for (const node of nodes) node.remove();
  };
}

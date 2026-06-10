import { esc } from './escape.js';

function normalizeChipText(value) {
  return String(value ?? '').trim();
}

function normalizeClassTokens(input) {
  const values = Array.isArray(input) ? input : [input];
  return values
    .flatMap((value) => String(value || '').split(/\s+/))
    .map((value) => value.trim())
    .filter(Boolean);
}

function appendDataset(node, dataset = {}) {
  for (const [key, value] of Object.entries(dataset || {})) {
    if (!key || value == null) continue;
    node.dataset[key] = String(value);
  }
}

function datasetAttrsHtml(dataset = {}) {
  return Object.entries(dataset || {})
    .filter(([key, value]) => key && value != null)
    .map(
      ([key, value]) =>
        ` data-${key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}="${esc(String(value))}"`,
    )
    .join('');
}

function removeModel(remove = {}) {
  return {
    enabled: Boolean(remove.enabled),
    className: normalizeClassTokens(remove.className).join(' '),
    label: String(remove.label || 'remove'),
    text: remove.text == null ? '×' : String(remove.text),
    dataset: remove.dataset || {},
  };
}

export function chipNode(documentRef, options) {
  // Allow chipNode(options) with the global document.
  if (documentRef && !documentRef.createElement) {
    options = documentRef;
    documentRef = globalThis.document;
  }
  const {
    text = '',
    className = '',
    variant = 'default',
    dataset = {},
    title = '',
    prefixNode = null,
    remove = {},
  } = options || {};
  if (!documentRef?.createElement) return null;
  const label = normalizeChipText(text);
  if (!label && !prefixNode) return null;

  const classes = ['ui-chip', `ui-chip-${String(variant || 'default').trim()}`];
  classes.push(...normalizeClassTokens(className));

  const chip = documentRef.createElement('span');
  chip.className = classes.join(' ');
  if (title) chip.title = String(title);
  appendDataset(chip, dataset);

  if (prefixNode) chip.append(prefixNode);

  const labelNode = documentRef.createElement('span');
  labelNode.className = 'ui-chip-label';
  labelNode.textContent = label;
  chip.append(labelNode);

  const removeCfg = removeModel(remove);
  if (removeCfg.enabled) {
    const removeButton = documentRef.createElement('button');
    removeButton.className = ['ui-chip-remove', removeCfg.className].filter(Boolean).join(' ');
    removeButton.type = 'button';
    removeButton.setAttribute('aria-label', removeCfg.label);
    appendDataset(removeButton, removeCfg.dataset);
    removeButton.textContent = removeCfg.text;
    chip.append(removeButton);
  }

  return chip;
}

export function chipHtml({
  text = '',
  className = '',
  variant = 'default',
  dataset = {},
  title = '',
  prefixHtml = '',
  remove = {},
} = {}) {
  const label = normalizeChipText(text);
  if (!label && !prefixHtml) return '';
  const removeCfg = removeModel(remove);
  const classes = ['ui-chip', `ui-chip-${String(variant || 'default').trim()}`];
  classes.push(...normalizeClassTokens(className));

  const titleAttr = title ? ` title="${esc(String(title))}"` : '';
  const removeHtml = removeCfg.enabled
    ? `<button class="ui-chip-remove${removeCfg.className ? ' ' + esc(removeCfg.className) : ''}" type="button" aria-label="${esc(removeCfg.label)}"${datasetAttrsHtml(removeCfg.dataset)}>${esc(removeCfg.text)}</button>`
    : '';

  return `<span class="${esc(classes.join(' '))}"${titleAttr}${datasetAttrsHtml(dataset)}>${prefixHtml}<span class="ui-chip-label">${esc(label)}</span>${removeHtml}</span>`;
}

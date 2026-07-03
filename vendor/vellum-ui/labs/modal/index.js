import { buttonHtml, el, fieldRowHtml, makeModalInteractive, modal } from '../../index.js';

const mount = document.getElementById('modalLabMount');

const CLOSE_DEFAULTS = {
  close: 'quiet',
  closeBg: 'var(--vui-color-surface-raised)',
  closeHoverBg: '#ac4133',
  closeColor: 'var(--vui-color-text-muted)',
  closeHoverColor: 'var(--vui-color-neutral-white)',
  closeSize: 28,
  closeInset: 11,
  closeRadius: 0,
  closeBorder: 3,
};

const DESIGN_SYSTEM_COLOR_CHOICES = [
  ['line', 'var(--vui-color-line)'],
  ['line strong', 'var(--vui-color-line-strong)'],
  ['text', 'var(--vui-color-text-strong)'],
  ['muted', 'var(--vui-color-text-muted)'],
  ['inverse', 'var(--vui-color-text-inverse)'],
  ['surface', 'var(--vui-color-surface)'],
  ['raised', 'var(--vui-color-surface-raised)'],
  ['sunken', 'var(--vui-color-surface-sunken)'],
  ['warm', 'var(--vui-color-neutral-surface-warm)'],
  ['white', 'var(--vui-color-neutral-white)'],
  ['accent', 'var(--vui-color-accent)'],
  ['accent soft', 'var(--vui-color-accent-soft)'],
  ['accent strong', 'var(--vui-color-accent-strong)'],
  ['warn', 'var(--vui-color-warn)'],
  ['danger', 'var(--vui-color-danger)'],
  ['danger hover', 'var(--vui-color-danger-hover)'],
  ['info', 'var(--vui-color-info)'],
  ['success', 'var(--vui-color-success)'],
  ['shadow', 'var(--vui-color-shadow)'],
].map(([label, value]) => ({ label, value }));

const PRESETS = {
  current: {
    label: 'current',
    ...CLOSE_DEFAULTS,
    surface: 'var(--vui-color-surface)',
    backdrop: 0.4,
    border: 3,
    borderColor: 'var(--vui-color-text-strong)',
    radius: 6,
    shadow: 7,
    padding: 14,
  },
  softer: {
    label: 'softer',
    ...CLOSE_DEFAULTS,
    surface: 'var(--vui-color-surface-raised)',
    backdrop: 0.28,
    border: 2,
    borderColor: 'var(--vui-color-line)',
    radius: 8,
    shadow: 4,
    padding: 18,
    closeBg: 'var(--vui-color-neutral-white)',
    closeHoverBg: 'var(--vui-color-accent-soft)',
  },
  paper: {
    label: 'paper',
    ...CLOSE_DEFAULTS,
    surface: 'var(--vui-color-neutral-surface-warm)',
    backdrop: 0.22,
    border: 2,
    borderColor: 'var(--vui-color-line)',
    radius: 3,
    shadow: 0,
    padding: 20,
    close: 'tab',
    closeBg: 'var(--vui-color-neutral-surface-warm)',
    closeHoverBg: 'var(--vui-color-warn)',
  },
  compact: {
    label: 'compact',
    ...CLOSE_DEFAULTS,
    surface: 'var(--vui-color-surface)',
    backdrop: 0.32,
    border: 3,
    borderColor: 'var(--vui-color-line)',
    radius: 0,
    shadow: 5,
    padding: 10,
    closeSize: 26,
    closeInset: 6,
  },
};

const DEFAULT_STATE = PRESETS.current;
const KNOB_KEYS = ['surface', 'backdrop', 'border', 'borderColor', 'radius', 'shadow', 'padding'];
const CLOSE_KEYS = ['close', 'closeBg', 'closeHoverBg', 'closeColor', 'closeHoverColor', 'closeSize', 'closeInset', 'closeRadius', 'closeBorder'];
const state = { ...PRESETS.current };
const controls = {};
let output;
let liveApi;

renderModalLab(mount);

function renderModalLab(target) {
  if (!target) return;
  target.append(header(), shell());
  target.querySelectorAll('.modal-lab-preview .ui-modal-card').forEach((card) => makeModalInteractive(card, { centeredX: false, centeredY: false }));
  liveApi = modal(document.getElementById('modalLabLive'));
  applyState();
}

function header() {
  return el(
    'header',
    { className: 'lab-head' },
    el(
      'div',
      {},
      el('h1', { className: 'lab-title', text: 'Modal Lab' }),
      el('p', {
        className: 'lab-sub',
        text: 'A Vellum UI workbench for testing modal weight, paper feel, backdrop, spacing, drag behavior, resize affordances, and close-button treatment.',
      }),
    ),
    el(
      'nav',
      { className: 'lab-head-actions', ariaLabel: 'Vellum UI pages' },
      el('a', { className: 'btn btn-secondary', href: '/vellum-ui/design-system/', text: 'design system' }),
      el('button', { className: 'btn', type: 'button', text: 'open live modal', onClick: () => liveApi.open() }),
    ),
  );
}

function shell() {
  output = el('textarea', { className: 'modal-lab-copy', readOnly: true, rows: 10, spellcheck: false });
  return el(
    'div',
    { className: 'lab-shell' },
    el(
      'aside',
      { className: 'lab-controls' },
      panel('Presets', presetButtons()),
      panel('Knobs', knobControls(), resetButton('reset knobs', KNOB_KEYS)),
      panel('Close Button', closeControls(), resetButton('reset close', CLOSE_KEYS)),
      panel(
        'Token output',
        el('div', { className: 'lab-control-list' }, output, el('button', { className: 'btn btn-secondary', type: 'button', text: 'copy', onClick: copyOutput })),
      ),
    ),
    el(
      'section',
      { className: 'lab-stage' },
      el(
        'div',
        { className: 'modal-lab-preview-grid' },
        preview('PoolBuilder confirm', poolBuilderModal()),
        preview('Biblioplex editor', biblioplexModal()),
        preview('Long content', longModal()),
        preview('Destructive action', dangerModal()),
      ),
      liveModal(),
    ),
  );
}

function panel(title, body, action = null) {
  return el('section', { className: 'lab-panel' }, el('div', { className: 'lab-panel-head' }, el('h2', { className: 'lab-panel-title', text: title }), action), body);
}

function resetButton(label, keys) {
  const button = el('button', {
    className: 'lab-reset-btn',
    type: 'button',
    text: 'reset',
    onClick: () => resetKeys(keys),
  });
  button.setAttribute('aria-label', label);
  return button;
}

function resetKeys(keys) {
  keys.forEach((key) => {
    state[key] = DEFAULT_STATE[key];
  });
  syncControls();
  applyState();
}

function presetButtons() {
  const wrap = el('div', { className: 'segmented', role: 'group', ariaLabel: 'Modal presets' });
  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = el('button', {
      className: key === 'current' ? 'segment-btn active' : 'segment-btn',
      type: 'button',
      text: preset.label,
      ariaPressed: key === 'current' ? 'true' : 'false',
      onClick: () => {
        Object.assign(state, preset);
        wrap.querySelectorAll('.segment-btn').forEach((other) => {
          const active = other === btn;
          other.classList.toggle('active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        syncControls();
        applyState();
      },
    });
    wrap.append(btn);
  }
  return wrap;
}

function knobControls() {
  const wrap = el('div', { className: 'lab-control-list' });
  const coreControls = [
    (controls.surface = colorTokenControl('surface', 'surface', state.surface)),
    (controls.backdrop = rangeControl('backdrop', 'backdrop', state.backdrop, 0, 0.75, 0.01)),
    (controls.border = rangeControl('border', 'border', state.border, 0, 6, 1)),
    (controls.borderColor = colorTokenControl('border color', 'borderColor', state.borderColor)),
    (controls.radius = rangeControl('radius', 'radius', state.radius, 0, 16, 1)),
    (controls.shadow = rangeControl('shadow', 'shadow', state.shadow, 0, 14, 1)),
    (controls.padding = rangeControl('padding', 'padding', state.padding, 8, 26, 1)),
  ];

  coreControls.forEach((control) => wrap.append(control.row));
  return wrap;
}

function closeControls() {
  const wrap = el('div', { className: 'lab-control-list' });
  controls.close = selectControl('close button', 'close', state.close, [
    ['rune', 'rune'],
    ['quiet', 'quiet'],
    ['tab', 'tab'],
  ]);
  controls.closeBg = colorTokenControl('bg', 'closeBg', state.closeBg);
  controls.closeHoverBg = colorTokenControl('hover bg', 'closeHoverBg', state.closeHoverBg);
  controls.closeColor = colorTokenControl('text', 'closeColor', state.closeColor);
  controls.closeHoverColor = colorTokenControl('hover text', 'closeHoverColor', state.closeHoverColor);
  controls.closeSize = rangeControl('size', 'closeSize', state.closeSize, 22, 38, 1);
  controls.closeInset = rangeControl('inset', 'closeInset', state.closeInset, -18, 18, 1);
  controls.closeRadius = rangeControl('radius', 'closeRadius', state.closeRadius, 0, 18, 1);
  controls.closeBorder = rangeControl('border', 'closeBorder', state.closeBorder, 0, 3, 1);

  [
    controls.close,
    controls.closeBg,
    controls.closeHoverBg,
    controls.closeColor,
    controls.closeHoverColor,
    controls.closeSize,
    controls.closeInset,
    controls.closeRadius,
    controls.closeBorder,
  ].forEach((control) => wrap.append(control.row));
  return wrap;
}

function colorTokenControl(label, key, value, options = DESIGN_SYSTEM_COLOR_CHOICES) {
  const buttons = [];
  const grid = el('div', { className: 'lab-swatch-grid', role: 'group', ariaLabel: label });
  const readout = el('output', { text: swatchLabel(value, options) });
  const defaultValue = DEFAULT_STATE[key];
  const customInput = el('input', { className: 'lab-swatch-custom-input', type: 'color', value: customColorValue(value), hidden: isTokenColor(value, options) });
  const customDefault = !isTokenColor(defaultValue, options);
  const customButton = el('button', {
    className: swatchClass({
      active: !isTokenColor(value, options),
      custom: true,
      defaulted: customDefault,
    }),
    type: 'button',
    title: customDefault ? 'new variant (default)' : 'new variant',
    ariaLabel: 'new variant',
    text: '+',
    onClick: () => {
      setValue(customInput.value);
      customInput.hidden = false;
      customInput.focus();
      applyState();
    },
  });
  customButton.setAttribute('aria-label', 'new variant');
  if (customDefault) customButton.dataset.default = 'true';

  customInput.addEventListener('input', () => {
    setValue(customInput.value);
    applyState();
  });

  function setValue(nextValue) {
    state[key] = nextValue;
    readout.textContent = swatchLabel(nextValue, options);
    const custom = !isTokenColor(nextValue, options);
    customInput.hidden = !custom;
    if (customColorValue(nextValue) === nextValue) customInput.value = nextValue;
    customButton.classList.toggle('active', custom);
    customButton.setAttribute('aria-pressed', String(custom));
    buttons.forEach((button) => {
      const active = button.dataset.value === nextValue;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  options.forEach((option) => {
    const defaulted = option.value === defaultValue;
    const button = el('button', {
      className: swatchClass({
        active: option.value === value,
        defaulted,
      }),
      type: 'button',
      title: defaulted ? `${option.label} (default)` : option.label,
      ariaLabel: option.label,
      ariaPressed: option.value === value ? 'true' : 'false',
      dataset: { value: option.value },
      onClick: () => {
        setValue(option.value);
        applyState();
      },
    });
    button.setAttribute('aria-label', option.label);
    button.setAttribute('aria-pressed', String(option.value === value));
    if (defaulted) button.dataset.default = 'true';
    button.style.setProperty('--lab-swatch-color', option.value);
    buttons.push(button);
    grid.append(button);
  });
  customButton.setAttribute('aria-pressed', String(!isTokenColor(value, options)));
  grid.append(customButton);

  return {
    row: el('div', { className: 'lab-control lab-swatch-control' }, el('span', { text: label }), readout, grid, customInput),
    setValue,
    readout,
  };
}

function rangeControl(label, key, value, min, max, step) {
  const readout = el('output', { text: formatRange(key, value) });
  const input = el('input', { type: 'range', value, min, max, step });
  input.addEventListener('input', () => {
    state[key] = Number(input.value);
    readout.textContent = formatRange(key, state[key]);
    applyState();
  });
  return { row: el('label', { className: 'lab-control' }, el('span', { text: label }), readout, input), input, readout };
}

function selectControl(label, key, value, options) {
  const input = el('select');
  for (const [optionValue, optionLabel] of options) input.append(el('option', { value: optionValue, text: optionLabel, selected: optionValue === value }));
  input.addEventListener('change', () => {
    state[key] = input.value;
    applyState();
  });
  return { row: el('label', { className: 'lab-control' }, el('span', { text: label }), input), input };
}

function syncControls() {
  for (const [key, control] of Object.entries(controls)) {
    if (control.setValue) {
      control.setValue(state[key]);
      continue;
    }
    if (control.input) control.input.value = state[key];
    if (control.readout) control.readout.textContent = formatRange(key, state[key]);
  }
}

function applyState() {
  const root = document.documentElement;
  const values = tokenValues();
  for (const [token, value] of Object.entries(values)) root.style.setProperty(token, value);
  document.body.dataset.closeStyle = state.close;
  output.value = `:root {\n${Object.entries(values)
    .map(([token, value]) => `  ${token}: ${value};`)
    .join('\n')}\n}`;
}

function tokenValues() {
  const borderColor = state.border === 0 ? 'transparent' : state.borderColor || 'var(--vui-color-line)';
  const closeBorder = state.closeBorder === 0 ? '0 solid transparent' : `${state.closeBorder}px solid var(--vui-color-line)`;
  return {
    '--vui-modal-backdrop': `rgba(0, 0, 0, ${state.backdrop.toFixed(2)})`,
    '--vui-modal-card-bg': state.surface,
    '--vui-modal-card-border': `${state.border}px solid ${borderColor}`,
    '--vui-modal-card-radius': `${state.radius}px`,
    '--vui-modal-card-shadow': state.shadow === 0 ? '0 0 0 transparent' : `${state.shadow}px ${state.shadow}px 0 var(--vui-color-shadow)`,
    '--vui-modal-head-padding': `${state.padding}px ${state.padding + 2}px`,
    '--vui-modal-body-padding': `${state.padding}px ${state.padding + 2}px`,
    '--vui-modal-actions-padding': `${Math.max(8, state.padding - 2)}px ${state.padding + 2}px`,
    '--vui-modal-close-size': `${state.closeSize}px`,
    '--vui-modal-close-offset': `${state.closeInset}px`,
    '--vui-modal-close-radius': `${state.closeRadius}px`,
    '--vui-modal-close-border': closeBorder,
    '--vui-modal-close-bg': state.closeBg,
    '--vui-modal-close-color': state.closeColor,
    '--vui-modal-close-hover-bg': state.closeHoverBg,
    '--vui-modal-close-hover-color': state.closeHoverColor,
    '--vui-modal-close-shadow': 'none',
    '--vui-modal-close-hover-shadow': 'none',
  };
}

function formatRange(key, value) {
  if (key === 'backdrop') return value.toFixed(2);
  return `${value}px`;
}

function swatchLabel(value, options) {
  return options.find((option) => option.value === value)?.label || 'new variant';
}

function isTokenColor(value, options) {
  return options.some((option) => option.value === value);
}

function customColorValue(value) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ac4133';
}

function swatchClass({ active = false, custom = false, defaulted = false }) {
  return ['lab-swatch', custom && 'lab-swatch-custom', active && 'active', defaulted && 'is-default'].filter(Boolean).join(' ');
}

async function copyOutput(event) {
  await navigator.clipboard?.writeText(output.value);
  const btn = event.currentTarget;
  const original = btn.textContent;
  btn.textContent = 'copied';
  window.setTimeout(() => {
    btn.textContent = original;
  }, 900);
}

function preview(label, card) {
  return el('article', { className: 'modal-lab-preview' }, el('div', { className: 'modal-lab-preview-label', text: label }), card);
}

function poolBuilderModal() {
  return modalCard(
    'clear current build?',
    el('p', {
      text: 'This removes 23 cards from your sealed deck. The pool stays intact so you can rebuild from scratch.',
    }),
    [button('cancel', 'secondary'), button('clear deck', 'danger')],
  );
}

function biblioplexModal() {
  return modalCard(
    'edit printing',
    htmlFragment(
      fieldRowHtml({ label: 'card name', controlHtml: '<input type="text" value="Lightning Bolt" />' }) +
        fieldRowHtml({ label: 'location', controlHtml: '<select><option>trade binder</option><option>deckbox</option></select>' }) +
        fieldRowHtml({ label: 'notes', controlHtml: '<textarea rows="3">signed copy</textarea>' }),
      'modal-lab-form',
    ),
    [button('save'), button('cancel', 'secondary')],
  );
}

function longModal() {
  return modalCard(
    'compare expert build',
    el(
      'div',
      { className: 'modal-lab-scroll-body' },
      el('p', { text: 'The reference build is Temur splash-white, prioritizing Lessons and fixing over raw curve density.' }),
      el('p', { text: 'Main differences: it keeps both Pest Mascots, cuts the second Noxious Newt, and treats Prismari Charm as a splash card rather than a lane signal.' }),
      el('p', { text: 'This body intentionally runs long enough to test scrolling, padding, and the visual relationship between the header and action row.' }),
      el('p', { text: 'The lab should make cramped, heavy, overly theatrical, or awkwardly resizable treatments obvious before they land in app code.' }),
    ),
    [button('close', 'secondary'), button('view list')],
  );
}

function dangerModal() {
  return modalCard(
    'delete ghost build?',
    el('p', { text: 'This removes the local comparison record for this pool. Submitted community results are unchanged.' }),
    [button('keep', 'secondary'), button('delete', 'danger')],
  );
}

function liveModal() {
  return el(
    'div',
    { id: 'modalLabLive', className: 'ui-modal modal-lab-live', hidden: true, ariaHidden: 'true' },
    modalCard(
      'live modal',
      el('p', { text: 'This uses the real Vellum modal helper, so escape, close, drag, and resize behavior are part of the playground.' }),
      [el('button', { className: 'btn btn-secondary', type: 'button', text: 'close', dataset: { modalClose: '' } }), button('commit direction')],
    ),
  );
}

function modalCard(title, body, actions) {
  return el(
    'section',
    { className: 'ui-modal-card' },
    el(
      'header',
      { className: 'ui-modal-head' },
      el('h2', { className: 'ui-modal-title', text: title }),
      el('button', { className: 'rune-close', type: 'button', ariaLabel: 'close', dataset: { modalClose: '' }, text: 'x' }),
    ),
    el('div', { className: 'ui-modal-body' }, body),
    el('footer', { className: 'ui-modal-actions' }, actions),
  );
}

function button(label, variant = 'primary') {
  const template = document.createElement('template');
  template.innerHTML = buttonHtml({ label, variant });
  return template.content.firstElementChild;
}

function htmlFragment(html, className) {
  const wrap = el('div', { className });
  const template = document.createElement('template');
  template.innerHTML = html;
  wrap.append(template.content);
  return wrap;
}

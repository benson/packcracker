import { outsideClick } from './outsideClick.js';

export function combobox(input, options = {}) {
  const {
    getItems,
    onSelect,
    toLabel = (item) => String(item?.label ?? item ?? ''),
    toHint = (item) => String(item?.hint ?? ''),
    toDataset = null,
    maxItems = 8,
    minLength = 0,
    openOnFocus = true,
  } = options;
  if (!input || typeof getItems !== 'function') return null;

  const doc = input.ownerDocument;
  const wrap = input.closest('.combobox') || wrapInput();
  const list = doc.createElement('div');
  list.className = 'combobox-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.append(list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  let items = [];
  let activeIndex = -1;
  let requestId = 0;
  let releaseOutside = null;

  function wrapInput() {
    const wrapEl = doc.createElement('div');
    wrapEl.className = 'combobox';
    input.parentNode.insertBefore(wrapEl, input);
    wrapEl.append(input);
    return wrapEl;
  }

  async function refresh() {
    const query = input.value.trim();
    if (query.length < minLength) return close();
    const id = ++requestId;
    const result = await getItems(query);
    if (id !== requestId) return;
    items = (Array.isArray(result) ? result : []).slice(0, maxItems);
    activeIndex = -1;
    if (!items.length) return close();
    render();
    open();
  }

  function render() {
    list.textContent = '';
    items.forEach((item, index) => {
      const option = doc.createElement('button');
      option.type = 'button';
      option.className = 'combobox-option';
      option.setAttribute('role', 'option');
      option.dataset.index = String(index);
      const dataset = toDataset?.(item);
      if (dataset) {
        for (const [key, value] of Object.entries(dataset)) {
          if (value != null) option.dataset[key] = String(value);
        }
      }
      const label = doc.createElement('span');
      label.className = 'combobox-option-label';
      label.textContent = toLabel(item);
      option.append(label);
      const hint = toHint(item);
      if (hint) {
        const hintNode = doc.createElement('span');
        hintNode.className = 'combobox-option-hint';
        hintNode.textContent = hint;
        option.append(hintNode);
      }
      // Keep focus in the input so keyboard state survives a mouse pick.
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => select(index));
      list.append(option);
    });
    paintActive();
  }

  function paintActive() {
    for (const option of list.children) {
      const isActive = Number(option.dataset.index) === activeIndex;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-selected', String(isActive));
    }
    list.children[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }

  function open() {
    if (!list.hidden) return;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    releaseOutside = outsideClick(wrap, close);
  }

  function close() {
    if (list.hidden) return;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
    releaseOutside?.();
    releaseOutside = null;
  }

  function select(index) {
    const item = items[index];
    if (item == null) return;
    input.value = toLabel(item);
    close();
    onSelect?.(item);
  }

  function onKeydown(event) {
    if (list.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      refresh();
      return;
    }
    if (list.hidden) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + items.length) % items.length;
      paintActive();
    } else if (event.key === 'Enter') {
      if (activeIndex >= 0) {
        event.preventDefault();
        select(activeIndex);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', onKeydown);
  if (openOnFocus) input.addEventListener('focus', refresh);

  return {
    close,
    refresh,
    destroy() {
      close();
      input.removeEventListener('input', refresh);
      input.removeEventListener('keydown', onKeydown);
      if (openOnFocus) input.removeEventListener('focus', refresh);
      list.remove();
    },
  };
}

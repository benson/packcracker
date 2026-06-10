/*
 * Dark-theme helpers. Vellum's dark vellum is a [data-theme="dark"] token
 * layer; the attribute must live on <html> — the unprefixed compatibility
 * aliases resolve against :root's --vui-* values, so a body-level attribute
 * would not flip them for legacy consumers.
 *
 * applyTheme: set/clear the attribute. initTheme: apply the stored preference
 * (optionally falling back to prefers-color-scheme). themeToggle: bind a
 * control — a .switch checkbox reflects + sets the theme; any other element
 * toggles it on click.
 */

export const DEFAULT_THEME_STORAGE_KEY = 'vui_theme_v1';

export function applyTheme(mode, documentObj = globalThis.document) {
  const root = documentObj?.documentElement;
  if (!root) return;
  if (mode === 'dark') root.setAttribute?.('data-theme', 'dark');
  else root.removeAttribute?.('data-theme');
}

export function currentTheme(documentObj = globalThis.document) {
  return documentObj?.documentElement?.getAttribute?.('data-theme') === 'dark' ? 'dark' : 'light';
}

export function readStoredTheme(
  storageKey = DEFAULT_THEME_STORAGE_KEY,
  storageObj = globalThis.localStorage,
) {
  try {
    const value = storageObj?.getItem?.(storageKey);
    return value === 'dark' || value === 'light' ? value : '';
  } catch (_e) {
    return '';
  }
}

export function setTheme(
  mode,
  {
    storageKey = DEFAULT_THEME_STORAGE_KEY,
    documentObj = globalThis.document,
    storageObj = globalThis.localStorage,
  } = {},
) {
  applyTheme(mode, documentObj);
  try {
    storageObj?.setItem?.(storageKey, mode);
  } catch (_e) {
    /* ignore */
  }
}

export function initTheme({
  storageKey = DEFAULT_THEME_STORAGE_KEY,
  documentObj = globalThis.document,
  storageObj = globalThis.localStorage,
  fallbackToSystem = true,
} = {}) {
  let mode = readStoredTheme(storageKey, storageObj);
  if (!mode && fallbackToSystem) {
    const win = documentObj?.defaultView || globalThis;
    mode = win.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }
  mode = mode || 'light';
  applyTheme(mode, documentObj);
  return mode;
}

export function themeToggle(
  control,
  {
    storageKey = DEFAULT_THEME_STORAGE_KEY,
    documentObj = globalThis.document,
    storageObj = globalThis.localStorage,
    onChange = null,
  } = {},
) {
  if (!control) return () => {};
  const apply = (mode) => {
    setTheme(mode, { storageKey, documentObj, storageObj });
    onChange?.(mode);
  };
  const isCheckbox = String(control.type || '').toLowerCase() === 'checkbox';
  if (isCheckbox) {
    control.checked = currentTheme(documentObj) === 'dark';
    const handler = () => apply(control.checked ? 'dark' : 'light');
    control.addEventListener('change', handler);
    return () => control.removeEventListener('change', handler);
  }
  const handler = () => apply(currentTheme(documentObj) === 'dark' ? 'light' : 'dark');
  control.addEventListener('click', handler);
  return () => control.removeEventListener('click', handler);
}

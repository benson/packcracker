const MEMORY_STORAGE = new Map();

export function resolveWidgetStorage({ documentObj = globalThis.document, storage = null } = {}) {
  if (storage) return storage;
  try {
    return documentObj?.defaultView?.localStorage || globalThis.localStorage;
  } catch (_error) {
    return {
      getItem: (key) => MEMORY_STORAGE.get(key) || null,
      setItem: (key, value) => MEMORY_STORAGE.set(key, value),
      removeItem: (key) => MEMORY_STORAGE.delete(key),
    };
  }
}

export function readStoredPosition(key, options = {}) {
  const storage = resolveWidgetStorage(options);
  return readJson(storage, `${key}:position`, isPoint);
}

export function writeStoredPosition(key, position, options = {}) {
  const storage = resolveWidgetStorage(options);
  writeJson(storage, `${key}:position`, normalizePoint(position));
}

export function readStoredSize(key, options = {}) {
  const storage = resolveWidgetStorage(options);
  return readJson(storage, `${key}:size`, isSize);
}

export function writeStoredSize(key, size, options = {}) {
  const storage = resolveWidgetStorage(options);
  writeJson(storage, `${key}:size`, normalizeSize(size));
}

function readJson(storage, key, predicate) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    return predicate(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function writeJson(storage, key, value) {
  if (!value) storage.removeItem?.(key);
  else storage.setItem(key, JSON.stringify(value));
}

function normalizePoint(value) {
  if (!isPoint(value)) return null;
  return { left: Math.round(value.left), top: Math.round(value.top) };
}

function normalizeSize(value) {
  if (!isSize(value)) return null;
  return { width: Math.round(value.width), height: Math.round(value.height) };
}

function isPoint(value) {
  return value && Number.isFinite(value.left) && Number.isFinite(value.top);
}

function isSize(value) {
  return value && Number.isFinite(value.width) && Number.isFinite(value.height);
}

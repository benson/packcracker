const ESCAPE_REPLACEMENTS = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_REPLACEMENTS.get(char));
}

export function attrs(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value != null && value !== false)
    .map(([key, value]) => (value === true ? ` ${esc(key)}` : ` ${esc(key)}="${esc(value)}"`))
    .join('');
}

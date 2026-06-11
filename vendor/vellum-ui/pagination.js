// Page-number list for the .pager component (BEN-557). Returns an array of
// page numbers with 'gap' markers, e.g. [1, 'gap', 4, 5, 6, 'gap', 20].
// First and last pages are always present; `siblings` controls how many
// neighbors flank the current page.
export function paginationRange({ page = 1, pageCount = 1, siblings = 1 } = {}) {
  const total = Math.max(1, Math.floor(pageCount) || 1);
  const current = Math.min(Math.max(1, Math.floor(page) || 1), total);
  const span = Math.max(0, Math.floor(siblings) || 0);

  // Small enough to show everything (a gap marker replaces >= 2 pages, so a
  // window plus both ends only earns gaps beyond this size).
  if (total <= span * 2 + 5) {
    return rangeOf(1, total);
  }

  const windowStart = Math.max(2, Math.min(current - span, total - span * 2 - 2));
  const windowEnd = Math.min(total - 1, Math.max(current + span, span * 2 + 3));
  const pages = [1];

  if (windowStart > 3) pages.push('gap');
  else pages.push(...rangeOf(2, windowStart - 1));
  pages.push(...rangeOf(windowStart, windowEnd));
  if (windowEnd < total - 2) pages.push('gap');
  else pages.push(...rangeOf(windowEnd + 1, total - 1));
  pages.push(total);

  return pages;
}

function rangeOf(start, end) {
  const out = [];
  for (let value = start; value <= end; value += 1) out.push(value);
  return out;
}

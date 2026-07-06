// Safe-triangle hover-intent geometry for fly-out submenus.
//
// When a submenu opens to the side of its trigger, a user moving the cursor
// diagonally toward it briefly leaves the trigger's hover box (through the
// corner gap). A naive :hover rule closes the submenu mid-travel. The classic
// fix (the "Amazon menu" heuristic) is to treat the triangle formed by the
// cursor and the submenu's leading edge as a grace zone: while the pointer
// stays inside that triangle it's considered "heading toward" the submenu, so
// the submenu stays open even though the pointer isn't over it yet.
//
// These are pure functions (no DOM) so the geometry is unit-testable; the DOM
// wiring lives in floatingMenu.js.

// Standard point-in-triangle test via barycentric sign checks. Points are
// {x, y}. Returns true when p is inside or on the edge of triangle abc.
export function pointInTriangle(p, a, b, c) {
  if (!p || !a || !b || !c) return false;
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  // Inside when all cross-products share a sign (zeros count as on-edge → in).
  return !(hasNeg && hasPos);
}

function sign(p, a, b) {
  return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

// The submenu's leading (near) edge as two corner points, given the side the
// submenu opens toward relative to the cursor. For a right-opening submenu the
// leading edge is its left edge; for a left-opening one, its right edge.
export function submenuLeadingEdge(rect, side = 'right') {
  if (!rect) return null;
  const x = side === 'left' ? rect.right : rect.left;
  return {
    top: { x, y: rect.top },
    bottom: { x, y: rect.bottom },
  };
}

// Which side of the cursor the submenu sits on. Used to pick the leading edge.
export function submenuSide(cursor, rect) {
  if (!cursor || !rect) return 'right';
  const rectCenterX = (rect.left + rect.right) / 2;
  return rectCenterX >= cursor.x ? 'right' : 'left';
}

// Decide whether the pointer is still "heading toward" the submenu. `cursor` is
// the anchor point (where the pointer was when it left the trigger); `point` is
// the current pointer position; `rect` is the submenu's bounding rect. An
// optional `buffer` (px) inflates the leading edge vertically so a slightly
// over/undershooting path still counts. Returns true → keep the submenu open.
export function isMovingTowardSubmenu(cursor, point, rect, { buffer = 0 } = {}) {
  if (!cursor || !point || !rect) return false;
  // If the pointer is already over the submenu, it's trivially "toward" it.
  if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
    return true;
  }
  const side = submenuSide(cursor, rect);
  const edge = submenuLeadingEdge(rect, side);
  if (!edge) return false;
  const top = { x: edge.top.x, y: edge.top.y - buffer };
  const bottom = { x: edge.bottom.x, y: edge.bottom.y + buffer };
  return pointInTriangle(point, cursor, top, bottom);
}

import { esc } from './escape.js';

// Format a numeric amount for the .card-sleeve-price label. The label is a
// narrow fixed-size sticker, so once a price clears $100 we drop the cents and
// show whole dollars ("$ 150" instead of "$ 149.99"); at $100 and under we keep
// the cents ("$ 4.20"). The leading "$ " space is the price-gun gap. Returns ''
// for non-numeric input so callers can skip rendering.
export function formatStickerPrice(amount) {
  // null / undefined / '' mean "no price" — render nothing (Number(null) is 0,
  // so guard before coercing).
  if (amount == null || amount === '') return '';
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const body = n > 100 ? String(Math.round(n)) : n.toFixed(2);
  return `$ ${body}`;
}

function priceLabel({ amount, text }) {
  return text != null ? String(text) : formatStickerPrice(amount);
}

// Per-instance placement jitter so a wall of stickers (e.g. a 3x3 binder)
// doesn't look rubber-stamped. Seeded → stable for a given card across renders;
// pass jitter:true for fresh randomness, or { seed, x, y, rot } to tune ranges
// (defaults ±5px / ±5px / ±3deg). Returns the --price-jitter-* values.
const DEFAULT_JITTER = { x: 5, y: 5, rot: 3 };

function hashSeed(value) {
  const s = String(value);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function jitterVars(jitter) {
  if (!jitter) return null;
  const cfg =
    jitter === true || typeof jitter === 'string' || typeof jitter === 'number'
      ? { seed: jitter === true ? null : jitter }
      : jitter || {};
  const range = {
    x: cfg.x ?? DEFAULT_JITTER.x,
    y: cfg.y ?? DEFAULT_JITTER.y,
    rot: cfg.rot ?? DEFAULT_JITTER.rot,
  };
  const rand = cfg.seed != null ? makeRng(hashSeed(cfg.seed)) : Math.random;
  const round = (n) => Math.round(n * 100) / 100;
  const span = (max) => round((rand() * 2 - 1) * max);
  return {
    '--price-jitter-x': `${span(range.x)}px`,
    '--price-jitter-y': `${span(range.y)}px`,
    '--price-jitter-rot': `${span(range.rot)}deg`,
  };
}

// Build the price sticker as a DOM node. The ink rides a nested <span> (it's a
// separate layer from the paper) — this helper hides that detail. Pass `jitter`
// (a card id makes a card's placement stable) to nudge it off the base spot.
// priceStickerNode({ amount: 4.2, jitter: card.id })
export function priceStickerNode(documentRef, options) {
  if (documentRef && !documentRef.createElement) {
    options = documentRef;
    documentRef = globalThis.document;
  }
  if (!documentRef?.createElement) return null;
  const opts = options || {};
  const label = priceLabel(opts);
  if (!label) return null;
  const wrap = documentRef.createElement('span');
  wrap.className = 'card-sleeve-price';
  const vars = jitterVars(opts.jitter);
  if (vars) for (const [key, value] of Object.entries(vars)) wrap.style.setProperty(key, value);
  const ink = documentRef.createElement('span');
  ink.textContent = label;
  wrap.append(ink);
  return wrap;
}

export function priceStickerHtml({ amount, text, jitter } = {}) {
  const label = priceLabel({ amount, text });
  if (!label) return '';
  const vars = jitterVars(jitter);
  const styleAttr = vars
    ? ` style="${Object.entries(vars)
        .map(([key, value]) => `${key}:${value}`)
        .join(';')}"`
    : '';
  return `<span class="card-sleeve-price"${styleAttr}><span>${esc(label)}</span></span>`;
}

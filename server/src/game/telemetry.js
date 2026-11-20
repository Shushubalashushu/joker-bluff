'use strict';

/**
 * Sanitizes the giver's touch telemetry sent with `offer_card`.
 *
 * Each sample (all values normalized so they replay on any screen size):
 *   c    - opaque id of the card under the finger (preferred: robust to shuffles)
 *   s    - legacy/fallback hand slot index
 *   u,v  - position inside that card (0..1)
 *   x,y  - raw screen position / screen size (0..1)
 *   t    - ms since the OFFER phase started
 *
 * Output samples carry `s` = the card's slot in the giver's hand AT OFFER TIME,
 * so the receiver's heatmap lines up with the final order even if the giver
 * shuffled mid-decision.
 *
 * Telemetry is untrusted, never affects game logic, and is only revealed to the
 * receiving player when they spend a Lie Deye token.
 */
const MAX_INPUT_SAMPLES = 600;
const MAX_KEPT_SAMPLES = 200;

const round3 = (n) => Math.round(n * 1000) / 1000;

function num(v, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, v));
}

function downsample(arr, max) {
  if (arr.length <= max) return arr;
  const out = [];
  const step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/**
 * @param {unknown} raw
 * @param {{handSize: number, maxT: number, slotOf?: Map<string, number>}} opts
 */
function sanitizeTouches(raw, { handSize, maxT, slotOf = new Map() }) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw.slice(0, MAX_INPUT_SAMPLES)) {
    if (!p || typeof p !== 'object') continue;
    const x = num(p.x, 0, 1);
    const y = num(p.y, 0, 1);
    if (x === null || y === null) continue;
    let s = null;
    if (typeof p.c === 'string' && slotOf.has(p.c)) s = slotOf.get(p.c);
    else if (Number.isInteger(p.s) && p.s >= 0 && p.s < handSize) s = p.s;
    out.push({
      s,
      u: s === null ? null : round3(num(p.u, 0, 1) ?? 0.5),
      v: s === null ? null : round3(num(p.v, 0, 1) ?? 0.5),
      x: round3(x),
      y: round3(y),
      t: Math.round(num(p.t, 0, maxT) ?? 0),
    });
  }
  out.sort((a, b) => a.t - b.t);
  return downsample(out, MAX_KEPT_SAMPLES);
}

module.exports = { sanitizeTouches, MAX_KEPT_SAMPLES };

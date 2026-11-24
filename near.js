// Pure helpers for ranking and filtering, shared with test.js.
function metres(a, b) { // haversine
  const rad = d => d * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Places still to visit first, each group nearest first. || 0: Infinity - Infinity is NaN.
const rankNear = (list, isDone, dist) =>
  [...list].sort((a, b) => isDone(a) - isDone(b) || (dist(a) - dist(b)) || 0);

// ponytail: straight line x 1.3 at 80 m/min approximates London streets; a routing API would be exact but costs per call.
function walkParts(m) {
  if (m >= 100000) return [Math.round(m / 1000).toLocaleString('en'), 'ק״מ'];
  if (m > 2500) return [(m / 1000).toFixed(1), 'ק״מ'];
  return [Math.max(1, Math.round(m * 1.3 / 80)), 'דק׳'];
}

function fmtWalk(m) {
  const [value, unit] = walkParts(m);
  if (unit === 'ק״מ') return `${value} ק״מ`;
  return value === 1 ? 'כדקה הליכה' : `כ־${value} דק׳ הליכה`;
}

// A filter is worth showing only if it can narrow the list. A blank counts as a value: "must" on some rows is a choice.
const hasChoice = (list, key) => new Set(list.map(p => p[key])).size > 1;

// A route travels between phones inside a link: base64url of its JSON (UTF-8, so Hebrew names survive).
const encodeRoute = r =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ name: r.name, stops: r.stops }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeRoute(s) { // the link comes from anyone: anything unexpected is null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const r = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    const ok = typeof r?.name === 'string' && r.name.trim() && Array.isArray(r.stops) && r.stops.every(x => typeof x === 'string');
    return ok ? { name: r.name.trim().slice(0, 60), stops: [...new Set(r.stops)] } : null;
  } catch { return null; }
}

// Swap stop i with its neighbour d (-1 up, +1 down); out of range leaves the order as is.
function moveStop(stops, i, d) {
  const j = i + d, next = [...stops];
  if (i < 0 || j < 0 || i >= next.length || j >= next.length) return next;
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

if (typeof module !== 'undefined') module.exports = { metres, rankNear, walkParts, fmtWalk, hasChoice, encodeRoute, decodeRoute, moveStop }; // for test.js

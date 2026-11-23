// "Where next?": pure helpers, shared with test.js.
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
function fmtWalk(m) {
  if (m >= 100000) return `${Math.round(m / 1000).toLocaleString('en')} ק״מ`;
  if (m > 2500) return `${(m / 1000).toFixed(1)} ק״מ`;
  const min = Math.max(1, Math.round(m * 1.3 / 80));
  return min === 1 ? 'כדקה הליכה' : `כ־${min} דק׳ הליכה`;
}

if (typeof module !== 'undefined') module.exports = { metres, rankNear, fmtWalk }; // for test.js

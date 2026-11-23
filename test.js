// Run: node test.js
const assert = require('assert');
const parseCSV = require('./csv.js');

assert.deepStrictEqual(parseCSV('a,b\r\n"x, ""y""\nz",2\r\n'), [['a', 'b'], ['x, "y"\nz', '2']]);
assert.deepStrictEqual(parseCSV('a,,c'), [['a', '', 'c']]);
assert.deepStrictEqual(parseCSV(''), []);

const rows = parseCSV(require('fs').readFileSync(__dirname + '/places.csv', 'utf8'));
assert.ok(rows.length > 1 && rows.every(r => r.length === rows[0].length), 'places.csv rows are ragged');

const { metres, rankNear, fmtWalk } = require('./near.js');
assert.ok(Math.abs(metres({ lat: 51.5, lng: 0 }, { lat: 51.51, lng: 0 }) - 1112) < 2);
const far = { n: 'far', d: 900 }, close = { n: 'close', d: 100 }, visited = { n: 'visited', d: 10 }, noPin = { n: 'noPin', d: Infinity }, noPin2 = { n: 'noPin2', d: Infinity };
assert.deepStrictEqual(
  rankNear([visited, noPin, far, noPin2, close], p => p === visited, p => p.d).map(p => p.n),
  ['close', 'far', 'noPin', 'noPin2', 'visited'], // to visit first, nearest first, stable when distance is unknown
);
assert.strictEqual(fmtWalk(10), 'כדקה הליכה');
assert.strictEqual(fmtWalk(615), 'כ־10 דק׳ הליכה');
assert.strictEqual(fmtWalk(3200), '3.2 ק״מ');
assert.strictEqual(fmtWalk(3556800), '3,557 ק״מ');

console.log('ok', rows.length - 1, 'places');

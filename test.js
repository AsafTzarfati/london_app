// Run: node test.js
const assert = require('assert');
const parseCSV = require('./csv.js');

assert.deepStrictEqual(parseCSV('a,b\r\n"x, ""y""\nz",2\r\n'), [['a', 'b'], ['x, "y"\nz', '2']]);
assert.deepStrictEqual(parseCSV('a,,c'), [['a', '', 'c']]);
assert.deepStrictEqual(parseCSV(''), []);

const rows = parseCSV(require('fs').readFileSync(__dirname + '/places.csv', 'utf8'));
assert.ok(rows.length > 1 && rows.every(r => r.length === rows[0].length), 'places.csv rows are ragged');
const idCol = rows[0].indexOf('place_id');
assert.ok(idCol > 0 && rows.slice(1).every(r => /^(ChIJ[\w-]+)?$/.test(r[idCol])), 'bad place_id in places.csv');

const { metres, rankNear, walkParts, fmtWalk, hasChoice } = require('./near.js');
assert.strictEqual(hasChoice([{ k: '' }, { k: '' }], 'k'), false); // empty column
assert.strictEqual(hasChoice([{ k: 'a' }, { k: 'a' }], 'k'), false); // filtering changes nothing
assert.strictEqual(hasChoice([{ k: 'a' }, { k: '' }], 'k'), true); // one value on some rows
assert.strictEqual(hasChoice([{ k: 'a' }, { k: 'b' }], 'k'), true);
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
assert.deepStrictEqual(walkParts(615), [10, 'דק׳']);
assert.deepStrictEqual(walkParts(3200), ['3.2', 'ק״מ']);

const { encodeRoute, decodeRoute, moveStop, matches } = require('./near.js');
const bakery = { name: 'Fortitude Bakehouse', cat: 'מאפים וקינוחים', area: 'בלומסברי', notes: 'בראוני' };
assert.ok(matches(bakery, '  ') && matches(bakery, ' fortitude ') && matches(bakery, 'בראוני') && matches(bakery, 'בלומסברי'));
assert.ok(!matches(bakery, 'soho'));
const trip = { name: 'סוהו בבוקר', stops: ['Fortitude Bakehouse', 'heytea (SOHO)', 'Heard. Burger Soho'] };
assert.match(encodeRoute(trip), /^[\w-]+$/); // safe in a URL hash as is
assert.deepStrictEqual(decodeRoute(encodeRoute(trip)), trip);
assert.strictEqual(decodeRoute('not-a-route'), null);
assert.strictEqual(decodeRoute(encodeRoute({ name: ' ', stops: [] })), null);
assert.strictEqual(decodeRoute(Buffer.from('{"name":"x","stops":[1]}').toString('base64')), null);
assert.deepStrictEqual(moveStop(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
assert.deepStrictEqual(moveStop(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
assert.deepStrictEqual(moveStop(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
assert.deepStrictEqual(moveStop(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c']);

console.log('ok', rows.length - 1, 'places');

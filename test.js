// Run: node test.js
const assert = require('assert');
const parseCSV = require('./csv.js');

assert.deepStrictEqual(parseCSV('a,b\r\n"x, ""y""\nz",2\r\n'), [['a', 'b'], ['x, "y"\nz', '2']]);
assert.deepStrictEqual(parseCSV('a,,c'), [['a', '', 'c']]);
assert.deepStrictEqual(parseCSV(''), []);

const rows = parseCSV(require('fs').readFileSync(__dirname + '/places.csv', 'utf8'));
assert.ok(rows.length > 1 && rows.every(r => r.length === rows[0].length), 'places.csv rows are ragged');
console.log('ok', rows.length - 1, 'places');

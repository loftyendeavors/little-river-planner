'use strict';
// Which snapshots are kept and which go (js/snapshots.js), without a browser: the plans kept before another device's changes
// were taken in are thinned by a rule of their own, apart from the 20 automatic snapshots.
// usage: node snaps_test.cjs <app-dir>
const path = require('path');
const results = [], fail = [];
let finished = false;
process.on('exit', () => { if (!finished) { results.push('FAIL (the test stopped before its end)'); fail.push('(the test stopped before its end)'); } console.log(results.join('\n')); console.log(JSON.stringify({ passed: results.length - fail.length, of: results.length, failed: fail })); });
const check = (name, ok, detail) => { results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 600)}`); if (!ok) fail.push(name); };
const S = require(path.join(process.argv[2], 'js/snapshots.js'));
const NOW = Date.UTC(2027, 4, 5, 18, 0, 0), at = minutesAgo => new Date(NOW - minutesAgo * 60000).toISOString();
const newestFirst = list => list.slice().sort((a, b) => (a.at < b.at ? 1 : -1));
// a day of two devices: 40 take-ins, one every 7 minutes, the last a minute ago; 25 automatic snapshots over the weeks before; 3 named
const joins = Array.from({ length: 40 }, (_, i) => ({ id: 'j' + i, auto: true, join: true, at: at(1 + 7 * (39 - i)) }));
const autos = Array.from({ length: 25 }, (_, i) => ({ id: 'a' + i, auto: true, at: at(600 + 1440 * i) }));
const named = Array.from({ length: 3 }, (_, i) => ({ id: 'n' + i, auto: false, at: at(50000 + i) }));
const all = newestFirst([...joins, ...autos, ...named]), gone = new Set(S.outgrown(all, NOW).map(s => s.id)), left = all.filter(s => !gone.has(s.id));
check('the plans kept before a taking-in are kept apart from the 20 automatic snapshots: 40 of them push none of the 20 out, and a named one never goes',
  left.filter(s => s.auto && !s.join).length === S.KEEP_AUTO && autos.slice(0, 20).every(s => !gone.has(s.id)) && named.every(s => !gone.has(s.id)), [left.filter(s => s.auto && !s.join).length]);
const keptJoins = left.filter(s => s.join).map(s => s.id), hours = new Set(joins.map(s => s.at.slice(0, 13)));
check('of the plans kept before a taking-in, the newest 5 stay, and the first of each hour of the last day', joins.slice(-S.KEEP_JOIN).every(s => keptJoins.includes(s.id)) && [...hours].every(h => keptJoins.includes(joins.find(s => s.at.slice(0, 13) === h).id)) && keptJoins.length <= S.KEEP_JOIN + hours.size, [keptJoins, hours.size]);
check('after 40 take-ins the plan before the first is still listed', keptJoins.includes('j0'), keptJoins);
const old = newestFirst([...joins.map(s => ({ ...s, at: new Date(Date.parse(s.at) - 3 * 86400000).toISOString() }))]), stay = old.filter(s => !new Set(S.outgrown(old, NOW).map(x => x.id)).has(s.id));
check('three days on, only the newest 5 of them are left', stay.length === S.KEEP_JOIN && stay.every((s, i) => s.id === old[i].id), stay.map(s => s.id));
finished = true;

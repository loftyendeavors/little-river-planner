// The hooks: how a check finds a thing on the page so that a change of look leaves the check alone (tests/README.md, "Hooks").
//   node tests/hooks_test.cjs <the repository>
// A hook is a data-hook attribute that names what a thing is ("changes-build": one build in the list "What changed"). The
// planner writes it on the thing (dataset: { hook: '…' } in a script, data-hook="…" in index.html); a check reads it
// ([data-hook="…"], or hook('…') and hooks('…') in a check that defines those). A look build moves the thing and its hook with it.
// This check holds the three ends together, without a browser:
//   - every hook a check reads is written somewhere by the planner: a look build that drops one fails here, by name, before
//     any browser is started;
//   - no style sheet rule reads a hook, and no script of the planner finds a thing by one: hooks are for the checks, so that
//     neither the look nor the code can come to lean on them, and they can stay put when both change;
//   - the check finds hooks at all: a reading that finds none would pass on anything.
const fs = require('fs'), path = require('path');
const [REPO] = process.argv.slice(2).map(p => path.resolve(p));
const results = [], failed = [];
let done = false, report = {};
process.on('exit', () => { console.log(JSON.stringify({ passed: results.length - failed.length, of: results.length, failed, finished: done, ...report })); });
const check = (name, ok, detail) => { results.push(name); if (!ok) failed.push(detail === undefined ? name : { name, detail }); };
const files = (dir, re) => fs.existsSync(path.join(REPO, dir)) ? fs.readdirSync(path.join(REPO, dir)).filter(f => re.test(f)).map(f => `${dir}/${f}`) : [];
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const NAME = '[a-z][a-z0-9-]*';

// written by the planner
const written = new Map();
const wrote = (name, where) => { if (!written.has(name)) written.set(name, new Set()); written.get(name).add(where); };
const scripts = files('js', /\.js$/), page = ['index.html'];
for (const f of scripts) {
  const text = read(f);
  for (const m of text.matchAll(new RegExp(`\\bhook:\\s*(['"\`])(${NAME})\\1`, 'g'))) wrote(m[2], f);
  for (const m of text.matchAll(new RegExp(`dataset\\.hook\\s*=\\s*(['"\`])(${NAME})\\1`, 'g'))) wrote(m[2], f);
  for (const m of text.matchAll(new RegExp(`data-hook=\\\\?["'](${NAME})\\\\?["']`, 'g'))) wrote(m[1], f);
}
for (const f of page) for (const m of read(f).matchAll(new RegExp(`data-hook="(${NAME})"`, 'g'))) wrote(m[1], f);

// read by the checks
const read_ = new Map();
const used = (name, where) => { if (!read_.has(name)) read_.set(name, new Set()); read_.get(name).add(where); };
const checks = [...files('tests', /\.(py|cjs|mjs|js)$/), ...files('tools', /_(check|test)\.(py|cjs|mjs)$/)].filter(f => f !== 'tests/hooks_test.cjs');
for (const f of checks) {
  const text = read(f);
  for (const m of text.matchAll(new RegExp(`data-hook=\\\\*["'](${NAME})\\\\*["']`, 'g'))) used(m[1], f);
  for (const m of text.matchAll(new RegExp(`\\bhooks?\\((['"])(${NAME})\\1`, 'g'))) used(m[2], f);
}

const missing = [...read_].filter(([name]) => !written.has(name)).map(([name, where]) => `${name} (read by ${[...where].join(', ')})`);
check('every hook a check reads is written by the planner', missing.length === 0, missing);
const styled = files('css', /\.css$/).filter(f => /data-hook/.test(read(f)));
check('no style sheet rule reads a hook', styled.length === 0, styled);
const leaning = scripts.filter(f => /\[data-hook|dataset\.hook\s*[!=]==|getAttribute\(\s*['"]data-hook/.test(read(f)));
check('no script of the planner finds a thing by its hook', leaning.length === 0, leaning);
check('the reading finds hooks: some written by the planner, and some read by a check', written.size >= 5 && read_.size >= 5, { written: written.size, read: read_.size });
report = { written: [...written.keys()].sort(), read: read_.size };
done = true;

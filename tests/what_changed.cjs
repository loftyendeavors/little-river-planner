// What a build changed in the page's scripts, against the build before: proven, not argued.
//   node tests/what_changed.cjs <js dir of this build> <js dir of the build before> <dir holding node_modules/acorn>
//
// A build says what it changes in tests/this-build.json:
//   { "words": ["panels.js"], "code": ["map.js"], "added": [], "removed": [] }
// and this check holds it to that:
//   - a script named nowhere is the build before's file, byte for byte;
//   - a script under "words" is the same program once the text inside its strings is set aside (both are parsed and compared);
//   - a script under "code" may differ in any way: the build's own checks answer for it;
//   - a script is added or gone only if it is named under "added" or "removed".
// So a build that moves no figure names no script that works one out, and anyone can see that from one short file.
const path = require('path'), fs = require('fs');
const [NOW, OLD, MODS] = process.argv.slice(2);
const results = [], failed = [];
let done = false, report = {};
process.on('exit', () => { console.log(JSON.stringify({ passed: results.length - failed.length, of: results.length, failed, finished: done, ...report })); });
const check = (name, ok, detail) => { results.push(name); if (!ok) failed.push(detail === undefined ? name : { name, detail }); };
let said = {};
try { said = JSON.parse(fs.readFileSync(path.join(__dirname, 'this-build.json'), 'utf8')); } catch (error) { check('tests/this-build.json can be read', false, String(error.message)); }
const named = key => Array.isArray(said[key]) ? said[key] : [];
const list = dir => fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const a = list(NOW), b = list(OLD);
const added = a.filter(f => !b.includes(f)), gone = b.filter(f => !a.includes(f));
check('no script is added that the build does not name', added.every(f => named('added').includes(f)), added.filter(f => !named('added').includes(f)));
check('no script is gone that the build does not name', gone.every(f => named('removed').includes(f)), gone.filter(f => !named('removed').includes(f)));
const differ = a.filter(f => b.includes(f) && read(NOW, f) !== read(OLD, f));
const unnamed = differ.filter(f => !named('words').includes(f) && !named('code').includes(f));
check('every script the build does not name is the file of the build before, byte for byte', unnamed.length === 0, unnamed);
const wordsOnly = differ.filter(f => named('words').includes(f));
if (wordsOnly.length) {
  let acorn = null;
  try { acorn = require(path.join(MODS, 'node_modules/acorn')); } catch (error) { check('the parser is there (npm i acorn in the scratch folder)', false, String(error.message)); }
  const shape = text => JSON.stringify(acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script' }), (key, value) => {
    if (key === 'start' || key === 'end' || key === 'raw') return undefined;
    if (value && value.type === 'Literal' && typeof value.value === 'string') return { type: 'Literal', value: '' };
    if (value && value.type === 'TemplateElement') return { type: 'TemplateElement', tail: value.tail };
    return value;
  });
  for (const f of wordsOnly) {
    let same = false, why = null;
    try { same = !!acorn && shape(read(NOW, f)) === shape(read(OLD, f)); } catch (error) { why = String(error.message); }
    check(`${f}: only the text inside its strings differs from the build before`, same, why);
  }
}
report = { scripts: a.length, same: a.length - differ.length - added.length, words: wordsOnly, code: differ.filter(f => named('code').includes(f)), added, gone };
done = true;

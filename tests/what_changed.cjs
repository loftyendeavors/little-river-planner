// What a build changed in what a browser is served, against the build before: proven, not argued.
//   node tests/what_changed.cjs <the repository> <the build before, as setup.sh unpacked it ($LRF_WORK/old)> <dir holding node_modules/acorn>
//
// A build says what it changes in tests/this-build.json:
//   { "base": "7c0e98d", "words": ["panels.js"], "code": ["map.js"], "added": [], "removed": [], "page": ["index.html", "sw.js"] }
// and this check holds it to that:
//   - "base" is the commit the build was cut from (the first letters will do). It must be the build this run compares with, so
//     a file left over from another build cannot speak for this one;
//   - a script named nowhere is the build before's file, byte for byte;
//   - a script under "words" is the same program once the text inside its strings is set aside (both are parsed and compared);
//   - a script under "code" may differ in any way: the build's own checks answer for it;
//   - a script is added or gone only if it is named under "added" or "removed";
//   - every other file a browser is served (index.html, sw.js, the manifest, css/, fonts/, icons/) is the build before's file
//     unless it is named under "page".
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
let base = '';
try { base = fs.readFileSync(path.join(OLD, 'BASE'), 'utf8').trim(); } catch (_) { base = 'none'; }
check('the build before was found in the repository’s history', /^[0-9a-f]{40}$/.test(base), base);
check('tests/this-build.json was written for this build: its “base” is the build before', typeof said.base === 'string' && said.base.length >= 7 && base.startsWith(said.base), { says: said.base || null, comparedWith: base.slice(0, 12) });

const list = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort() : [];
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const JS = path.join(NOW, 'js'), JS0 = path.join(OLD, 'js');
const a = list(JS), b = list(JS0);
const added = a.filter(f => !b.includes(f)), gone = b.filter(f => !a.includes(f));
check('no script is added that the build does not name', added.every(f => named('added').includes(f)), added.filter(f => !named('added').includes(f)));
check('no script is gone that the build does not name', gone.every(f => named('removed').includes(f)), gone.filter(f => !named('removed').includes(f)));
const differ = a.filter(f => b.includes(f) && read(JS, f) !== read(JS0, f));
const unnamed = differ.filter(f => !named('words').includes(f) && !named('code').includes(f));
check('every script the build does not name is the file of the build before, byte for byte', b.length > 0 && unnamed.length === 0, unnamed);
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
    try { same = !!acorn && shape(read(JS, f)) === shape(read(JS0, f)); } catch (error) { why = String(error.message); }
    check(`${f}: only the text inside its strings differs from the build before`, same, why);
  }
}
// the rest of what a browser is served
const walk = (root, rel) => { const at = path.join(root, rel); if (!fs.existsSync(at)) return []; return fs.statSync(at).isDirectory() ? fs.readdirSync(at).sort().flatMap(f => walk(root, path.join(rel, f))) : [rel]; };
const PAGE = ['index.html', 'sw.js', 'manifest.webmanifest', 'css', 'fonts', 'icons'];
const now = PAGE.flatMap(x => walk(NOW, x)), was = PAGE.flatMap(x => walk(OLD, x));
const bytes = (root, f) => fs.readFileSync(path.join(root, f));
const pageDiffer = [...new Set([...now, ...was])].filter(f => !now.includes(f) || !was.includes(f) || !bytes(NOW, f).equals(bytes(OLD, f))).map(f => f.split(path.sep).join('/'));
check('every other file a browser is served is the build before’s, unless the build names it', was.length > 0 && pageDiffer.every(f => named('page').includes(f)), pageDiffer.filter(f => !named('page').includes(f)));
report = { base: base.slice(0, 7), scripts: a.length, same: a.length - differ.length - added.length, words: wordsOnly, code: differ.filter(f => named('code').includes(f)), added, gone, page: pageDiffer };
done = true;

// What a build changed in what a browser is served, against the build before: proven, not argued.
//   node tests/what_changed.cjs <the repository> <the build before, as setup.sh unpacked it ($LRF_WORK/old)> <dir holding node_modules/acorn>
//
// A build says what it changes in a file of its own under tests/builds/, which it adds and no later build touches:
//   tests/builds/the-bed-panel.json
//   { "build": "…", "words": ["panels.js"], "code": ["map.js"], "added": [], "removed": [], "page": ["index.html", "sw.js"], "screens": ["map"] }
// Which file is this build's is written nowhere: it is the one the build before does not have. So two builds made side by side
// never write the same file, and a file another build left cannot speak for this one. This check holds the build to what it says:
//   - the build has one such file, or none if it changes nothing a browser is served, and the files earlier builds left are as
//     they left them;
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
let base = '';
try { base = fs.readFileSync(path.join(OLD, 'BASE'), 'utf8').trim(); } catch (_) { base = 'none'; }
check('the build before was found in the repository’s history', /^[0-9a-f]{40}$/.test(base), base);
// what the build says of itself: the file under tests/builds that the build before does not have
const BUILDS = path.join(NOW, 'tests', 'builds'), BUILDS0 = path.join(OLD, 'tests', 'builds');
const records = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
const earlier = records(BUILDS0), mine = records(BUILDS).filter(f => !earlier.includes(f));
const said = {}, unread = [];
for (const f of mine) {
  try {
    const one = JSON.parse(fs.readFileSync(path.join(BUILDS, f), 'utf8'));
    if (!one || typeof one !== 'object' || Array.isArray(one)) throw new Error('not a record');
    for (const key of ['words', 'code', 'added', 'removed', 'page']) said[key] = [...(said[key] || []), ...(Array.isArray(one[key]) ? one[key] : [])];
  } catch (error) { unread.push(`${f}: ${error.message}`); }
}
const named = key => said[key] || [];
check('what the build says of itself can be read: its file under tests/builds', unread.length === 0, unread);
check('the build has one file of its own under tests/builds, or none if it changes nothing a browser is served', mine.length <= 1, mine);
const touched = earlier.filter(f => !fs.existsSync(path.join(BUILDS, f)) || !fs.readFileSync(path.join(BUILDS, f)).equals(fs.readFileSync(path.join(BUILDS0, f))));
check('the files earlier builds left under tests/builds are as they left them', touched.length === 0, touched);

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
// under js/, whatever is not one of the scripts compared above: a folder, a file of another kind
const beside = root => walk(root, 'js').filter(f => !(path.dirname(f) === 'js' && f.endsWith('.js')));
// and at the root of the site, anything that is not known to stand there: the site serves every file it holds
const ROOT = [...PAGE, 'js', 'tests', 'tools', 'worker', 'README.md', 'node_modules'];
const strange = fs.readdirSync(NOW).filter(f => !f.startsWith('.') && !ROOT.includes(f)).flatMap(f => walk(NOW, f));
const now = [...PAGE.flatMap(x => walk(NOW, x)), ...beside(NOW), ...strange], was = [...PAGE.flatMap(x => walk(OLD, x)), ...beside(OLD)];
const bytes = (root, f) => fs.readFileSync(path.join(root, f));
const pageDiffer = [...new Set([...now, ...was])].filter(f => !now.includes(f) || !was.includes(f) || !bytes(NOW, f).equals(bytes(OLD, f))).map(f => f.split(path.sep).join('/'));
check('every other file a browser is served is the build before’s, unless the build names it', was.length > 0 && pageDiffer.every(f => named('page').includes(f)), pageDiffer.filter(f => !named('page').includes(f)));
report = { base: base.slice(0, 7), says: mine, scripts: a.length, same: a.length - differ.length - added.length, words: wordsOnly, code: differ.filter(f => named('code').includes(f)), added, gone, page: pageDiffer };
done = true;

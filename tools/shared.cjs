#!/usr/bin/env node
'use strict';
/* The files that every build would otherwise rewrite by hand, written from the code by one tool, so that two builds made side by
 * side never settle them by hand. tools/take_main.sh runs it after taking main into a branch; a build runs it after any change,
 * where it used to run tools/build_site.cjs; the checks' part "build" runs it and fails if that changes a file.
 *
 *   node tools/shared.cjs <this repository> <fontsource dir (node_modules/@fontsource-variable)> [the build before: a commit]
 *
 * It writes:
 *   js/built.js   The label, and every build's entry for "What changed". The build before's list, read from that commit, and at
 *                 its head this build's own entry with the next label, when this build changes what a browser is served. The
 *                 entry is written by the build in its own file under tests/builds, as "changes": { "did": "…", "steps": […] },
 *                 with no label and no day: the label is the next after the build before's, and the day is the one on which
 *                 the label was given (a later run on another day keeps it while the label stands).
 *   the site      index.html, sw.js, js/pwa.js, css/, fonts/ and the manifest, by tools/build_site.cjs from the app folder that
 *                 tools/app_folder.cjs makes of this repository. sw.js names every file by its contents, so it is written last.
 *
 * The build before is the commit given; with none, where this branch left origin/main; on main itself, the commit before.
 * LRF_TODAY=yyyy-mm-dd pretends another day (for the checks).
 * It stops, and writes nothing more, when this build serves something new and has no entry, when it has an entry and serves
 * nothing new, or when it has more than one file of its own under tests/builds.
 */
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { execFileSync } = require('child_process');
const [REPO, FONTS, given] = process.argv.slice(2);
if (!REPO || !FONTS) { console.error('usage: node tools/shared.cjs <repository> <fontsource dir> [commit of the build before]'); process.exit(2); }
const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const tryGit = (...args) => { try { return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; } };
const stop = why => { console.error(`shared.cjs: ${why}`); process.exit(1); };

// tools/build_site.cjs empties css/ and fonts/ before it writes them again: a file there that git does not hold would be lost.
// (A new script under js/ and this build's new file under tests/builds are taken as they are: a build runs this before its first commit.)
const loose = tryGit('status', '--porcelain', '--untracked-files=all', '--', 'css', 'fonts');
if (loose && loose.split('\n').some(l => l.startsWith('??'))) stop(`files git does not hold stand in css/ or fonts/, which the build empties: ${loose.split('\n').filter(l => l.startsWith('??')).map(l => l.slice(3)).slice(0, 5).join(', ')}. Add them to git, or move them away, first`);

// the build before
let base = given;
if (!base || base === 'none') {
  // as tests/setup.sh finds it: on a branch where it left main; on main's own commit with served files changed and not yet
  // committed, that commit; on main itself, the commit before
  const head = git('rev-parse', 'HEAD'), main = tryGit('merge-base', 'HEAD', 'origin/main');
  const changed = tryGit('status', '--porcelain', '--', 'js', 'css', 'index.html', 'manifest.webmanifest', 'fonts', 'icons', 'tests/builds');
  base = main && main !== head ? main : changed ? 'HEAD' : 'HEAD~1';
}
const BASE = tryGit('rev-parse', '--verify', '-q', `${base}^{commit}`);
if (!BASE) stop(`the build before (${base}) is not in this repository's history: fetch more of it`);

// what the build before said: its label and its list of builds
const BUILT = 'js/built.js';
const readBuilt = text => { const root = {}; vm.runInNewContext(text, { window: root, globalThis: root }); if (!root.LRFBuilt) throw new Error('js/built.js sets no LRFBuilt'); return root.LRFBuilt; };
function before() {
  const text = tryGit('show', `${BASE}:${BUILT}`);
  if (text !== null) return readBuilt(text);
  // a build before this tool: the label stood in js/main.js and the list in js/changes.js
  const main = git('show', `${BASE}:js/main.js`), changes = git('show', `${BASE}:js/changes.js`);
  const label = (main.match(/`Preview ([0-9][0-9.]*) · `/) || [])[1], list = changes.match(/const BUILDS = (\[[\s\S]*?\n {2}\]);/);
  if (!label || !list) stop(`the build before (${BASE.slice(0, 7)}) has neither js/built.js nor a label in js/main.js and a list in js/changes.js`);
  return { label, builds: vm.runInNewContext(`(${list[1]})`) };
}
const was = before();

// this build's own file under tests/builds: the one the build before does not have
const DIR = path.join(REPO, 'tests', 'builds');
const earlier = new Set((tryGit('ls-tree', '--name-only', BASE, 'tests/builds/') || '').split('\n').filter(Boolean).map(f => path.basename(f)));
const mine = (fs.existsSync(DIR) ? fs.readdirSync(DIR) : []).filter(f => f.endsWith('.json') && !earlier.has(f)).sort();
if (mine.length > 1) stop(`this build has ${mine.length} files of its own under tests/builds (${mine.join(', ')}): one at most`);
let own = null;
if (mine.length) { try { own = JSON.parse(fs.readFileSync(path.join(DIR, mine[0]), 'utf8')); } catch (error) { stop(`tests/builds/${mine[0]} cannot be read: ${error.message}`); } }
const entry = own && own.changes;
if (entry !== undefined && entry !== null) {
  const ok = entry && typeof entry === 'object' && typeof entry.did === 'string' && entry.did.trim().length >= 10 && Array.isArray(entry.steps)
    && entry.steps.length >= 1 && entry.steps.length <= 3 && entry.steps.every(s => typeof s === 'string' && s.trim().length > 0)
    && Object.keys(entry).every(k => k === 'did' || k === 'steps');
  if (!ok) stop(`tests/builds/${mine[0]}: "changes" is { "did": one line, "steps": one to three lines }, and nothing else`);
}

// the site, built once to see what this build serves that the build before did not
const build = label => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'lrf-shared-'));
  try {
    execFileSync('node', [path.join(REPO, 'tools/app_folder.cjs'), REPO, app], { stdio: 'pipe' });
    execFileSync('node', [path.join(REPO, 'tools/build_site.cjs'), app, FONTS, REPO, label], { stdio: 'pipe' });
  } catch (error) { stop(`the site could not be built: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' ')}`); }
  finally { fs.rmSync(app, { recursive: true, force: true }); }
};
build(was.label);
// what a browser is served, but for the two files this tool writes from the rest
const SERVED = ['index.html', 'manifest.webmanifest', 'js', 'css', 'fonts', 'icons'], WRITTEN = new Set([BUILT, 'sw.js']);
const walk = rel => { const at = path.join(REPO, rel); if (!fs.existsSync(at)) return []; return fs.statSync(at).isDirectory() ? fs.readdirSync(at).sort().flatMap(f => walk(`${rel}/${f}`)) : [rel]; };
const then = new Map((tryGit('ls-tree', '-r', BASE, '--', ...SERVED) || '').split('\n').filter(Boolean).map(line => { const [meta, file] = line.split('\t'); return [file, meta.split(' ')[2]]; }));
const now = SERVED.flatMap(walk).filter(f => !WRITTEN.has(f));
const blob = f => git('hash-object', '--', f);
const differ = [...new Set([...now, ...[...then.keys()].filter(f => !WRITTEN.has(f))])].filter(f => !now.includes(f) || !then.has(f) || then.get(f) !== blob(f)).sort();

// the label and the list
const next = label => { const parts = String(label).split('.'), last = parts.pop(); return [...parts, String(parseInt(last, 10) + 1).padStart(last.length, '0')].join('.'); };
let label = was.label, builds = was.builds;
if (differ.length) {
  if (!entry) stop(`this build changes what a browser is served (${differ.slice(0, 6).join(', ')}${differ.length > 6 ? ', …' : ''}), so it is a build with a label and an entry in "What changed": write that entry in ${mine.length ? `tests/builds/${mine[0]}` : 'its own file under tests/builds'} as "changes": { "did": …, "steps": […] }`);
  label = next(was.label);
  let kept = null;
  try { kept = readBuilt(fs.readFileSync(path.join(REPO, BUILT), 'utf8')).builds[0]; } catch (_) { kept = null; }
  const today = /^\d{4}-\d\d-\d\d$/.test(process.env.LRF_TODAY || '') ? process.env.LRF_TODAY : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const on = kept && kept.label === label && kept.did === entry.did && /^\d{4}-\d\d-\d\d$/.test(kept.on) ? kept.on : today;
  builds = [{ label, on, did: entry.did, steps: entry.steps }, ...was.builds];
} else if (entry) {
  stop(`tests/builds/${mine[0]} has an entry for "What changed", and this build serves nothing the build before did not: take the entry out, or the file`);
}
const text = `/* Little River Farm Planner — the build that is running, and what each build changed. WRITTEN BY tools/shared.cjs: not by hand.
 * The label is the build before's, or the next after it for a build that changes what a browser is served. Each build writes its
 * own entry in its file under tests/builds ("changes"); the tool puts it at the head of this list with the label and the day the
 * label was given. js/changes.js draws the list; js/main.js says the label. Nothing of any grower's plan goes in here: it is public.
 */
(function (root) {
  'use strict';
  root.LRFBuilt = {
    label: ${JSON.stringify(label)},
    builds: [
${builds.map(b => `      ${JSON.stringify({ label: b.label, on: b.on, did: b.did, steps: b.steps })}`).join(',\n')}
    ]
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;
const at = path.join(REPO, BUILT);
if (!fs.existsSync(at) || fs.readFileSync(at, 'utf8') !== text) fs.writeFileSync(at, text);
build(label);   // again, now that the list is written: sw.js names js/built.js by its contents
console.log(JSON.stringify({ base: BASE.slice(0, 7), before: was.label, label, entry: !!(differ.length && entry), own: mine[0] || null, serves: differ }));

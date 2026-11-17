// The files the merge writes (tools/shared.cjs) and the taking of main into a branch (tools/take_main.cjs), on a copy of this
// repository in a scratch folder with a main of its own: two builds made side by side, one merged, the other taking main in.
//   node tests/shared_test.cjs <the repository> <fontsource dir (node_modules/@fontsource-variable)>
// Nothing here touches the repository it is given: the copy is its own git repository, with a bare one beside it as "origin".
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
const [REPO, FONTS] = process.argv.slice(2).map(p => path.resolve(p));
const results = [], failed = [];
let done = false;
process.on('exit', () => { console.log(JSON.stringify({ passed: results.length - failed.length, of: results.length, failed, finished: done })); });
const check = (name, ok, detail) => { results.push(name); if (!ok) failed.push(detail === undefined ? name : { name, detail }); };

const top = fs.mkdtempSync(path.join(os.tmpdir(), 'lrf-shared-test-')), W = path.join(top, 'work'), O = path.join(top, 'origin.git');
const env = { ...process.env, GIT_AUTHOR_NAME: 'check', GIT_AUTHOR_EMAIL: 'check@example.invalid', GIT_COMMITTER_NAME: 'check', GIT_COMMITTER_EMAIL: 'check@example.invalid' };
const git = (...a) => execFileSync('git', ['-C', W, ...a], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (tool, ...a) => { const r = spawnSync('node', [path.join(W, 'tools', tool), W, FONTS, ...a], { encoding: 'utf8', env }); let said = null; try { said = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (_) { said = null; } return { code: r.status, said, err: String(r.stderr || '') }; };
const read = f => fs.readFileSync(path.join(W, f), 'utf8');
const write = (f, text) => { fs.mkdirSync(path.dirname(path.join(W, f)), { recursive: true }); fs.writeFileSync(path.join(W, f), text); };
const append = (f, text) => write(f, read(f) + text);
// js/built.js as the page reads it; one that cannot be read (a merge left in conflict) is an empty list, so that a line fails by name
const built = () => { try { const root = {}; require('vm').runInNewContext(read('js/built.js'), { window: root, globalThis: root }); return root.LRFBuilt || { label: null, builds: [] }; } catch (_) { return { label: null, builds: [] }; } };
const counts_ = () => { try { return JSON.parse(read('tests/counts.json')); } catch (_) { return {}; } };
const clean = () => git('status', '--porcelain');
const counts = () => counts_();
const entry = (did) => ({ build: 'a build made by this check', changes: { did, steps: ['Look at it.'] }, words: [], code: [], added: [], removed: [], page: [], screens: [] });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

try {
  // the copy: every file git holds here, as it stands in the working tree, committed as main and pushed to an origin of its own
  fs.mkdirSync(W);
  const files = execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(f => f && fs.existsSync(path.join(REPO, f)));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(W, f)), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(W, f)); }
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', O]);
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'main'); git('remote', 'add', 'origin', O); git('push', '-q', 'origin', 'main');
  git('fetch', '-q', 'origin');
  const start = built();
  fs.copyFileSync(path.join(W, 'tools', 'take_main.cjs'), path.join(top, 'take_main.cjs.kept'));   // the tool as main has it, kept outside

  // 1. on main, nothing new: nothing is written
  let r = run('shared.cjs', 'HEAD');
  check('on main with nothing new, the tool writes nothing and keeps the label', r.code === 0 && clean() === '' && r.said && r.said.label === start.label, { r, status: clean() });

  // 2. build A: a rule more in the style sheet, its own file with its entry, a check's count changed
  git('checkout', '-q', '-b', 'a');
  append('css/app.css', '\n/* a rule more, from build A */\n');
  write('tests/builds/zz-check-a.json', JSON.stringify(entry('Build A: a rule more in the style sheet.'), null, 1));
  const c0 = counts(), [p0] = Object.keys(c0), keys = Object.keys(c0[p0]);
  const cA = counts(); cA[p0][keys[0]] += 2; cA[p0][keys[2]] += 1; write('tests/counts.json', JSON.stringify(cA, null, 1));
  r = run('shared.cjs');
  const a = built(), next = l => { const p = l.split('.'), last = p.pop(); return [...p, String(+last + 1).padStart(last.length, '0')].join('.'); };
  check('a build that serves something new takes the next label after main’s, with its own entry at the head of the list and today’s day',
    r.code === 0 && a.label === next(start.label) && a.builds.length > 0 && a.builds[0].label === a.label && a.builds[0].did === 'Build A: a rule more in the style sheet.' && a.builds[0].on === today && a.builds.length === start.builds.length + 1 && JSON.stringify(a.builds.slice(1)) === JSON.stringify(start.builds), { r, head: a.builds[0], label: a.label });
  check('the page’s offline copy is written again, and names the new style sheet by its contents', /sw\.js/.test(clean()) && read('sw.js').includes(`(${a.label})`), clean());
  git('add', '-A'); git('commit', '-qm', 'build A');
  process.env.LRF_TODAY = '2031-02-03'; env.LRF_TODAY = '2031-02-03';   // a later day
  r = run('shared.cjs');
  delete env.LRF_TODAY; delete process.env.LRF_TODAY;
  check('run again on a later day, it writes nothing: the day the label was given is kept', r.code === 0 && clean() === '', { r, status: clean() });

  // 3. what stops it
  write('tests/builds/zz-check-a.json', JSON.stringify({ ...entry(''), changes: undefined }, null, 1));
  r = run('shared.cjs');
  check('a build that serves something new and has no entry is stopped, with what to write', r.code === 1 && /"changes"/.test(r.err), r.err);
  git('checkout', '-q', '--', '.');
  write('tests/builds/zz-check-a2.json', JSON.stringify(entry('A second file.'), null, 1));
  r = run('shared.cjs');
  check('a build with two files of its own under tests/builds is stopped', r.code === 1 && /one at most/.test(r.err), r.err);
  fs.rmSync(path.join(W, 'tests/builds/zz-check-a2.json'));
  git('checkout', '-q', 'main');
  write('tests/builds/zz-check-none.json', JSON.stringify(entry('Serves nothing.'), null, 1));
  r = run('shared.cjs', 'HEAD');
  check('a build with an entry that serves nothing new is stopped', r.code === 1 && /serves nothing/.test(r.err), r.err);
  fs.rmSync(path.join(W, 'tests/builds/zz-check-none.json'));
  git('checkout', '-q', '--', '.');

  // 4. build B, made beside A from the same main: another script, its own entry, the same check's count and another
  git('checkout', '-q', '-b', 'b', 'main');
  append('js/seeds.js', '\n// a line more, from build B\n');
  write('tests/builds/zz-check-b.json', JSON.stringify(entry('Build B: a line more in the seeds.'), null, 1));
  const cB = counts(); cB[p0][keys[0]] += 3; cB[p0][keys[1]] += 1; write('tests/counts.json', JSON.stringify(cB, null, 1));
  r = run('shared.cjs');
  check('built side by side, B takes the same label as A', r.code === 0 && built().label === a.label, r);
  git('add', '-A'); git('commit', '-qm', 'build B');

  // 5. A is merged onto main as one commit, as GitHub merges it
  git('checkout', '-q', 'main'); git('merge', '-q', '--squash', 'a'); git('commit', '-qm', 'A merged'); git('push', '-q', 'origin', 'main');
  r = run('shared.cjs');
  check('on main after A merged, the build before being the commit before, the tool writes nothing', r.code === 0 && clean() === '', { r, status: clean() });

  // 6. B takes main in, with no hand on it
  git('checkout', '-q', 'b');
  r = run('take_main.cjs', '--commit');
  const b = built(), c = counts();
  check('B takes main in by itself: no conflict is left and the merge is committed', r.code === 0 && r.said && r.said.conflicts.length === 0 && r.said.committed && clean() === '', { r, status: clean() });
  check('B has the next label after A’s, its entry first and A’s second, and every build before as it was',
    b.label === next(a.label) && b.builds.length > 1 && b.builds[0].label === b.label && /Build B/.test(b.builds[0].did) && b.builds[1].label === a.label && /Build A/.test(b.builds[1].did) && JSON.stringify(b.builds.slice(2)) === JSON.stringify(start.builds), b.builds.slice(0, 3));
  check('B holds A’s work and its own', read('css/app.css').includes('from build A') && read('js/seeds.js').includes('from build B'));
  check('the counts are joined check by check: each side’s line kept, and a check both changed carries what each added', !!c[p0] && c[p0][keys[0]] === c0[p0][keys[0]] + 5 && c[p0][keys[1]] === c0[p0][keys[1]] + 1 && c[p0][keys[2]] === c0[p0][keys[2]] + 1 && !!r.said && r.said.counts.length === 1, { joined: [keys[0], keys[1], keys[2]].map(k => (c[p0] || {})[k]), before: [keys[0], keys[1], keys[2]].map(k => c0[p0][k]), both: r.said.counts });
  check('the counts are laid out as tests/counts.py lays them, one check a line', /\n\n {2}"[^"]+": \d+,\n\n/.test(read('tests/counts.json')) && !/<<<<<<<|>>>>>>>/.test(read('tests/counts.json')));
  // a branch that already holds main, whose written files were left stale: --commit writes and commits them
  const keep = read('js/built.js');
  write('js/built.js', keep.replace(/\n {4}\]\n/, ',\n      {"label":"0.01","on":"2000-01-01","did":"A stale line.","steps":["None."]}\n    ]\n'));
  git('commit', '-qam', 'a stale list');
  r = run('take_main.cjs', '--commit');
  check('on a branch that already holds main, with --commit the written files are written again and committed', r.code === 0 && !!r.said && r.said.committed === true && clean() === '' && read('js/built.js') === keep, { r, status: clean() });
  r = run('shared.cjs');
  check('after the taking in, the shared files are what the tool writes from main', r.code === 0 && clean() === '' && !!r.said && r.said.label === b.label, { r, status: clean() });

  // 7. B merged; C, made beside B, changes the same line of the same script: a real conflict, left for a hand, or taken back
  git('checkout', '-q', '-b', 'c', 'main');
  append('js/seeds.js', '\n// a line more, from build C\n');
  write('tests/builds/zz-check-c.json', JSON.stringify(entry('Build C: another line in the seeds.'), null, 1));
  run('shared.cjs'); git('add', '-A'); git('commit', '-qm', 'build C');
  git('checkout', '-q', 'main'); git('merge', '-q', '--squash', 'b'); git('commit', '-qm', 'B merged'); git('push', '-q', 'origin', 'main');
  git('checkout', '-q', 'c');
  const before = git('rev-parse', 'HEAD');
  r = run('take_main.cjs', '--abort');
  check('a real conflict is named, the written files are not among the conflicts, and with --abort the branch is as it was',
    r.code === 3 && r.said && JSON.stringify(r.said.conflicts) === '["js/seeds.js"]' && !fs.existsSync(path.join(W, '.git', 'MERGE_HEAD')) && git('rev-parse', 'HEAD') === before && clean() === '', { r, status: clean() });
  // a branch made before the tool, run with the tool from main kept outside the repository, as the job runs it
  git('checkout', '-q', '-b', 'old', 'c'); git('rm', '-q', 'tools/take_main.cjs'); git('commit', '-qm', 'no tool here yet');
  fs.copyFileSync(path.join(W, '..', 'take_main.cjs.kept'), path.join(top, 'take_main.cjs'));
  let o = spawnSync('node', [path.join(top, 'take_main.cjs'), W, FONTS, '--abort'], { encoding: 'utf8', env });
  let said = null; try { said = JSON.parse(o.stdout.trim().split('\n').pop()); } catch (_) { said = null; }
  check('a branch with no copy of the tool is taken in by the tool kept from main: here, as C, only the real conflict is named', o.status === 3 && !!said && JSON.stringify(said.conflicts) === '["js/seeds.js"]' && clean() === '', { code: o.status, said, err: String(o.stderr).slice(0, 300) });
  git('checkout', '-q', 'c');
  r = run('take_main.cjs');
  check('without --abort the merge is left open with only that file to settle', r.code === 3 && !!r.said && JSON.stringify(r.said.conflicts) === '["js/seeds.js"]' && fs.existsSync(path.join(W, '.git', 'MERGE_HEAD')), r);
  done = true;
} catch (error) {
  check('the check ran to its end', false, String(error.stack || error).slice(0, 1500));
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}

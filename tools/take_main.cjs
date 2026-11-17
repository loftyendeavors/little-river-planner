#!/usr/bin/env node
'use strict';
/* Takes main into the branch that is checked out, and settles by itself the files every build writes, so that the second of two
 * builds made side by side does not settle them by hand.
 *
 *   node tools/take_main.cjs <this repository> <fontsource dir (node_modules/@fontsource-variable)> [--commit] [--abort] [--from <ref>]
 *
 * In order: fetch main; merge it in, without committing; settle js/built.js and sw.js (written again from the code below),
 * and tests/counts.json, joined check by check (tests/counts.py join); then tools/shared.cjs, which gives this build the next
 * label after main's and writes the site. Every other file is git's ordinary merge.
 *
 * A file that conflicts and is not one of those is a real conflict, in the code or in a note: the merge is left as it stands
 * with those files listed, and nothing is written. Settle them, then run tools/shared.cjs and commit (tests/README.md, "Two
 * builds side by side"). With --abort the merge is taken back instead (the job .github/workflows/take-main.yml does that).
 * With --commit the merge is committed when it is whole. --from takes another ref in (this branch as another place holds it,
 * after the job took main into it there); the label is still read from main.
 *
 * The job runs a copy of this file kept from main, so that a branch whose own copy is older, changed or missing is taken in the
 * same way: everything else it runs (tools/shared.cjs, tests/counts.py) is read from the branch once main is merged into it.
 *
 * It prints one line: {"took": …, "label": …, "conflicts": […], "counts": […]} and ends 0 when the branch holds main and its
 * shared files are written, 3 when real conflicts are left, 1 on any other failure.
 */
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
const args = process.argv.slice(2), flag = f => args.includes(f);
const fromAt = args.indexOf('--from'), FROM = fromAt >= 0 ? args[fromAt + 1] : 'origin/main';
const [REPO, FONTS] = args.filter((a, i) => !a.startsWith('--') && !(fromAt >= 0 && i === fromAt + 1));
if (!REPO || !FONTS) { console.error('usage: node tools/take_main.cjs <repository> <fontsource dir> [--commit] [--abort] [--from <ref>]'); process.exit(2); }
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...a) => { try { return git(...a); } catch (_) { return null; } };
const say = (obj, code) => { console.log(JSON.stringify(obj)); process.exit(code); };
// whether a merge stands open, asked of git: in a linked worktree .git is a file, and the merge is kept in the worktree's own folder
const merging = () => { const at = tryGit('rev-parse', '--git-path', 'MERGE_HEAD'); return !!at && fs.existsSync(path.resolve(REPO, at)); };
// a failure while a merge stands open takes it back when asked to, so that the branch is left as it was
// (only a merge this run began: one that was open before it, with what a hand has settled in it, is never taken back)
let began = false;
const fail = why => { if (flag('--abort') && began && merging()) tryGit('merge', '--abort'); say({ took: null, failed: why }, 1); };

if (tryGit('status', '--porcelain', '--untracked-files=no')) fail('the working tree has changes that are not committed: commit them first');
if (merging()) fail('a merge is already in progress here');
// main, as it stands now
const shallow = tryGit('rev-parse', '--is-shallow-repository') === 'true';
try { git('fetch', '--no-tags', ...(shallow ? ['--depth=200'] : []), 'origin', '+refs/heads/main:refs/remotes/origin/main'); } catch (error) { fail(`main could not be fetched: ${String(error.stderr || error.message).trim()}`); }
if (FROM !== 'origin/main' && FROM.startsWith('origin/')) tryGit('fetch', '--no-tags', ...(shallow ? ['--depth=200'] : []), 'origin', `+refs/heads/${FROM.slice(7)}:refs/remotes/${FROM}`);
const take = tryGit('rev-parse', '--verify', '-q', `${FROM}^{commit}`);
if (!take) fail(`${FROM} is not here`);
const head = git('rev-parse', 'HEAD');
if (tryGit('merge-base', '--is-ancestor', take, head) !== null) {
  // nothing to take in; the shared files are still written, so that a run of this alone leaves them right
  const out = spawnSync('node', [path.join(REPO, 'tools/shared.cjs'), REPO, FONTS, git('merge-base', 'HEAD', 'origin/main')], { encoding: 'utf8' });
  if (out.status !== 0) fail(String(out.stderr).trim());
  const dirty = tryGit('status', '--porcelain', '--untracked-files=no'), label = JSON.parse(out.stdout.trim().split('\n').pop()).label;
  if (dirty && flag('--commit')) {
    git('add', '-A', '--', 'js', 'css', 'fonts', 'icons', 'index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll');
    git('commit', '--no-verify', '-m', `The files the merge writes, written again (the label is ${label})\n\nBy tools/take_main.cjs: the branch already held ${FROM}, and js/built.js or the site were not what tools/shared.cjs writes.`);
  }
  say({ took: null, already: FROM, label, written: dirty ? dirty.split('\n').map(l => l.slice(3)) : [], committed: !!dirty && flag('--commit') }, 0);
}
const was = git('merge-base', 'HEAD', take);   // where the two last agreed: the counts are joined from it

// the merge, left open
const merged = spawnSync('git', ['-C', REPO, 'merge', '--no-ff', '--no-commit', take], { encoding: 'utf8' });
began = true;
const stillMerging = merging();
if (merged.status !== 0 && !stillMerging) fail(`git merge stopped: ${String(merged.stderr || merged.stdout).trim().split('\n').slice(-2).join(' ')}`);
const WRITTEN = ['js/built.js', 'sw.js'];
const conflicted = () => (tryGit('diff', '--name-only', '--diff-filter=U') || '').split('\n').filter(Boolean);
for (const f of conflicted().filter(f => WRITTEN.includes(f))) { git('checkout', '--theirs', '--', f); git('add', '--', f); }

// a conflict anywhere but in the files written here is a real one: said before anything is run from the merged tree, which may
// be the very file in conflict (tests/counts.py)
const real = conflicted().filter(f => f !== 'tests/counts.json');
if (real.length) {
  if (flag('--abort')) { tryGit('merge', '--abort'); say({ took: take.slice(0, 7), conflicts: real, aborted: true, counts: [] }, 3); }
  for (const f of conflicted().filter(f => f === 'tests/counts.json')) real.push(f);
  say({ took: take.slice(0, 7), conflicts: real, counts: [], next: `settle ${real.join(', ')}; then node tools/shared.cjs . <fonts> origin/main, git add -A, git commit` }, 3);
}

// the counts, check by check, from the three
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrf-counts-'));
const side = (ref, name) => { const text = tryGit('show', `${ref}:tests/counts.json`); const f = path.join(tmp, name); fs.writeFileSync(f, text === null ? '{}' : text); return f; };
const joined = spawnSync('python3', ['-I', path.join(REPO, 'tests/counts.py'), 'join', side(was, 'was.json'), side(head, 'here.json'), side(take, 'there.json')], { encoding: 'utf8' });
fs.rmSync(tmp, { recursive: true, force: true });
if (joined.status !== 0) fail(`tests/counts.py join: ${String(joined.stderr).trim().split('\n').pop()}`);
git('add', '--', 'tests/counts.json');
const counts = JSON.parse(joined.stdout.trim().split('\n').pop()).both;

// the label and the site: from main's list, as this branch will be merged onto it
const base = [git('merge-base', head, 'origin/main'), git('merge-base', take, 'origin/main')].reduce((a, b) => (tryGit('merge-base', '--is-ancestor', a, b) !== null ? b : a));
const out = spawnSync('node', [path.join(REPO, 'tools/shared.cjs'), REPO, FONTS, base], { encoding: 'utf8' });
if (out.status !== 0) {
  if (flag('--abort')) tryGit('merge', '--abort');
  fail(`tools/shared.cjs: ${String(out.stderr).trim()}`);
}
const wrote = JSON.parse(out.stdout.trim().split('\n').pop());
git('add', '-A', '--', 'js', 'css', 'fonts', 'icons', 'index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll');
if (flag('--commit')) {
  git('commit', '--no-verify', '-m', `Take main in (${take.slice(0, 7)}): the label is ${wrote.label}, and the files the merge writes are written again\n\nBy tools/take_main.cjs: js/built.js, sw.js and the site written by tools/shared.cjs, tests/counts.json joined check by check.${counts.length ? ` Changed on both sides, to be confirmed by the run: ${counts.join(', ')}.` : ''}`);
}
say({ took: take.slice(0, 7), label: wrote.label, conflicts: [], counts, committed: flag('--commit') }, 0);

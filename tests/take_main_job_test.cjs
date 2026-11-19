// The job that takes main into every open pull request (.github/workflows/take-main.yml), read as text, without running it:
// no code of a branch runs where there is a key that can write.
//   node tests/take_main_job_test.cjs <the repository>
// The merge runs a branch's own helpers, so the job that merges ("take") must have no key: no token in its environment, none
// left by the checkout, the least it can be given to read. The job that pushes and comments ("send") must run nothing from any
// branch, and must take which pull request, which branch and which commit from the list read with a key ("list"), not from
// what "take" handed on, and push only onto the commit the branch was read at. It then starts the checks for the branch.
// And the checks it starts (.github/workflows/checks.yml), read the same way: GitHub does not count the checks of a run started
// by dispatch for the protection of main, so such a run says "All checks" as a commit status on the commit it checked, with the
// outcome of "All checks", from a job that may write only statuses and runs nothing of any branch; no job that runs a branch's
// code is given a key that writes.
const fs = require('fs'), path = require('path');
const [REPO] = process.argv.slice(2).map(p => path.resolve(p));
const results = [], failed = [];
let done = false;
process.on('exit', () => { console.log(JSON.stringify({ passed: results.length - failed.length, of: results.length, failed, finished: done })); });
const check = (name, ok, detail) => { results.push(name); if (!ok) failed.push(detail === undefined ? name : { name, detail }); };

// a workflow read as text: its head (everything above "jobs:") and each job's lines, by the job's key
const read = file => {
  const lines = fs.readFileSync(path.join(REPO, file), 'utf8').split('\n');
  const at = lines.findIndex(l => l === 'jobs:');
  const jobs = {};
  let name = null;
  for (const line of lines.slice(at + 1)) {
    const m = line.match(/^ {2}([\w-]+):\s*$/);
    if (m) { name = m[1]; jobs[name] = []; continue; }
    if (name) jobs[name].push(line);
  }
  return { jobs, head: lines.slice(0, at).join('\n') };
};
const { jobs, head } = read('.github/workflows/take-main.yml');
const job = n => (jobs[n] || []).join('\n');
// the permissions a job is given: the lines under its "permissions:", until the next key at the same depth
const permsOf = js => n => { const j = js[n] || [], i = j.findIndex(l => /^ {4}permissions:/.test(l)); if (i < 0) return null; if (/permissions:\s*\{\}\s*$/.test(j[i])) return {}; const out = {}; for (const l of j.slice(i + 1)) { const m = l.match(/^ {6}([\w-]+):\s*(\w+)/); if (!m) break; out[m[1]] = m[2]; } return out; };
const perms = permsOf(jobs);
const KEY = /GH_TOKEN|github\.token|secrets\.|GITHUB_TOKEN/;
// what a job runs: its lines without comments and without the words it writes (inside single quotes)
const commandsOf = t => t.split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/'[^']*'/g, "''").replace(/\s#\s.*$/, '')).join('\n');
const RUNS = /\bnode\b|python3?\b|\bsh tests|\bbash tests|tools\/|tests\/\w+\.(cjs|py|sh)|npm |npx /g;

check('the three jobs are there, and nothing is given to the workflow as a whole', !!jobs.list && !!jobs.take && !!jobs.send && Object.keys(jobs).length === 3 && /^permissions:\s*\{\}\s*$/m.test(head), { jobs: Object.keys(jobs) });
check('"list" may only read the pull requests, and checks nothing out', JSON.stringify(perms('list')) === '{"pull-requests":"read"}' && !/actions\/checkout/.test(job('list')), perms('list'));
check('"take" may only read the repository, has no key in it, and its checkout leaves none behind',
  JSON.stringify(perms('take')) === '{"contents":"read"}' && !KEY.test(job('take')) && /persist-credentials:\s*false/.test(job('take')), { perms: perms('take'), key: (job('take').match(KEY) || [])[0] || null });
check('"take" is one job a pull request, from the list, each handing on an artifact named for its own pull request',
  /matrix:\n\s+pr: \$\{\{ fromJSON\(needs\.list\.outputs\.prs\) \}\}/.test(job('take')) && /name: taken-\$\{\{ matrix\.pr\.number \}\}/.test(job('take')) && /AT: \$\{\{ matrix\.pr\.at \}\}/.test(job('take')));
check('"send" reads each pull request’s outcome and commit only from that pull request’s own artifact', /IN="\$RUNNER_TEMP\/in\/taken-\$number"/.test(job('send')) && !/outcomes\.jsonl/.test(job('send')));
check('"take" runs the tool kept from main, not the branch’s own copy', /cp tools\/take_main\.cjs "\$TOOL"/.test(job('take')) && /node "\$TOOL"/.test(job('take')) && !/node tools\//.test(job('take')));
// what "send" runs
const runs = commandsOf(job('send')).match(RUNS) || [];
check('"send" runs nothing of any branch or of the repository', runs.length === 0 && /sparse-checkout:/.test(job('send')) && !/\bref:/.test(job('send')), runs);
check('"send" takes the pull request, its branch and its commit from "list", and pushes only onto that commit',
  /PRS: \$\{\{ needs\.list\.outputs\.prs \}\}/.test(job('send')) && /branch=\$\(printf '%s' "\$pr" \| jq -r \.branch\)/.test(job('send')) && /--force-with-lease="refs\/heads\/\$branch:\$at"/.test(job('send')) && !/branch=[^\n]*\$IN/.test(job('send')));
check('"send" goes on to tell each pull request when nothing at all was handed on', /download-artifact@v4\n\s+continue-on-error: true/.test(job('send')) && /if: always\(\)/.test(job('send')));
check('"send" pushes with no hook of the repository run', /core\.hooksPath=\/dev\/null push --no-verify/.test(job('send')));
// after the push it starts the checks on the branch it pushed (a push with this key starts none by itself)
check('"send" starts the checks on the branch it pushed', /\n\s+gh workflow run checks\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$branch"/.test(job('send')));

// The checks it starts
const C = read('.github/workflows/checks.yml'), cjob = n => (C.jobs[n] || []).join('\n'), cperms = permsOf(C.jobs);
const said = Object.keys(C.jobs).filter(n => /\/statuses\//.test(cjob(n)) || cperms(n) && 'statuses' in cperms(n));
const counted = said.length === 1 ? said[0] : null, cj = counted ? cjob(counted) : '';
check('the checks name their verdict "All checks", the name the protection of main waits for', /^ {4}name: All checks\s*$/m.test(cjob('all')) && /^ {4}needs: \[part, lint\]\s*$/m.test(cjob('all')), { all: (cjob('all').match(/^ {4}name: .*$/m) || [])[0] || null });
check('a run of the checks started by dispatch says "All checks" as a commit status, on the commit it checked, from one job',
  !!counted && /^ {4}if: \$\{\{ [^\n]*github\.event_name == 'workflow_dispatch'[^\n]*\}\}\s*$/m.test(cj) && /gh api -X POST "repos\/\$GITHUB_REPOSITORY\/statuses\/\$GITHUB_SHA"/.test(cj) && /-f context="All checks" /.test(cj),
  { jobs: said });
check('the status follows the outcome of "All checks": success only when it passed, and said whatever it concluded',
  !!counted && /^ {4}needs: all\s*$/m.test(cj) && /OUTCOME: \$\{\{ needs\.all\.result \}\}/.test(cj) && /if \[ "\$OUTCOME" = success \]; then state=success; [^\n]*else state=failure;/.test(cj)
    && (cj.match(/state=success/g) || []).length === 1 && /^ {4}if: \$\{\{ !cancelled\(\) && /m.test(cj));
check('the job that says the status may only write statuses, checks nothing out, uses no action and runs nothing of the repository',
  !!counted && JSON.stringify(cperms(counted)) === '{"statuses":"write"}' && !/^\s*(- )?uses:/m.test(cj) && !(commandsOf(cj).match(RUNS) || []).length,
  { perms: counted && cperms(counted), runs: commandsOf(cj).match(RUNS) });
check('no other job of the checks, all of which run the branch\'s code, is given a key that writes',
  /^permissions:\n {2}contents: read\s*$/m.test(C.head) && Object.keys(C.jobs).filter(n => n !== counted).every(n => Object.values(cperms(n) || {}).every(v => v === 'read' || v === 'none')),
  { jobs: Object.keys(C.jobs).map(n => [n, cperms(n)]) });
done = true;

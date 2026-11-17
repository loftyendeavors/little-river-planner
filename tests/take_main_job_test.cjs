// The job that takes main into every open pull request (.github/workflows/take-main.yml), read as text, without running it:
// no code of a branch runs where there is a key that can write.
//   node tests/take_main_job_test.cjs <the repository>
// The merge runs a branch's own helpers, so the job that merges ("take") must have no key: no token in its environment, none
// left by the checkout, the least it can be given to read. The job that pushes and comments ("send") must run nothing from any
// branch, and must take which pull request, which branch and which commit from the list read with a key ("list"), not from
// what "take" handed on, and push only onto the commit the branch was read at.
const fs = require('fs'), path = require('path');
const [REPO] = process.argv.slice(2).map(p => path.resolve(p));
const results = [], failed = [];
let done = false;
process.on('exit', () => { console.log(JSON.stringify({ passed: results.length - failed.length, of: results.length, failed, finished: done })); });
const check = (name, ok, detail) => { results.push(name); if (!ok) failed.push(detail === undefined ? name : { name, detail }); };

const text = fs.readFileSync(path.join(REPO, '.github/workflows/take-main.yml'), 'utf8');
const lines = text.split('\n');
const at = lines.findIndex(l => l === 'jobs:');
const jobs = {};
let name = null;
for (const line of lines.slice(at + 1)) {
  const m = line.match(/^ {2}([\w-]+):\s*$/);
  if (m) { name = m[1]; jobs[name] = []; continue; }
  if (name) jobs[name].push(line);
}
const job = n => (jobs[n] || []).join('\n');
const head = lines.slice(0, at).join('\n');
// the permissions a job is given: the lines under its "permissions:", until the next key at the same depth
const perms = n => { const j = jobs[n] || [], i = j.findIndex(l => /^ {4}permissions:/.test(l)); if (i < 0) return null; if (/permissions:\s*\{\}\s*$/.test(j[i])) return {}; const out = {}; for (const l of j.slice(i + 1)) { const m = l.match(/^ {6}([\w-]+):\s*(\w+)/); if (!m) break; out[m[1]] = m[2]; } return out; };
const KEY = /GH_TOKEN|github\.token|secrets\.|GITHUB_TOKEN/;

check('the three jobs are there, and nothing is given to the workflow as a whole', !!jobs.list && !!jobs.take && !!jobs.send && Object.keys(jobs).length === 3 && /^permissions:\s*\{\}\s*$/m.test(head), { jobs: Object.keys(jobs) });
check('"list" may only read the pull requests, and checks nothing out', JSON.stringify(perms('list')) === '{"pull-requests":"read"}' && !/actions\/checkout/.test(job('list')), perms('list'));
check('"take" may only read the repository, has no key in it, and its checkout leaves none behind',
  JSON.stringify(perms('take')) === '{"contents":"read"}' && !KEY.test(job('take')) && /persist-credentials:\s*false/.test(job('take')), { perms: perms('take'), key: (job('take').match(KEY) || [])[0] || null });
check('"take" runs the tool kept from main, not the branch’s own copy', /cp tools\/take_main\.cjs "\$TOOL"/.test(job('take')) && /node "\$TOOL"/.test(job('take')) && !/node tools\//.test(job('take')));
// what "send" runs: its lines without comments and without the words it writes (inside single quotes)
const commands = job('send').split('\n').filter(l => !/^\s*#/.test(l)).map(l => l.replace(/'[^']*'/g, "''").replace(/\s#\s.*$/, '')).join('\n');
const runs = commands.match(/\bnode\b|python3?\b|\bsh tests|\bbash tests|tools\/|tests\/\w+\.(cjs|py|sh)|npm |npx /g) || [];
check('"send" runs nothing of any branch or of the repository', runs.length === 0 && /sparse-checkout:/.test(job('send')) && !/\bref:/.test(job('send')), runs);
check('"send" takes the pull request, its branch and its commit from "list", and pushes only onto that commit',
  /PRS: \$\{\{ needs\.list\.outputs\.prs \}\}/.test(job('send')) && /branch=\$\(printf '%s' "\$pr" \| jq -r \.branch\)/.test(job('send')) && /--force-with-lease="refs\/heads\/\$branch:\$at"/.test(job('send')) && !/jq -r \.branch\)[^\n]*\$IN/.test(job('send')));
check('"send" pushes with no hook of the repository run', /core\.hooksPath=\/dev\/null push --no-verify/.test(job('send')));
done = true;

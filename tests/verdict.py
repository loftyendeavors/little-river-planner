"""Reads what tests/run.sh printed and says whether every check passed.

    sh tests/run.sh node | tee /tmp/part.log; python3 -I tests/verdict.py /tmp/part.log node       (exit 0: all passed; 1: not)
    python3 -I tests/verdict.py /tmp/part.log node /tmp/ran/ran-node.json     also writes what each check of the part ran, for tests/counts.py

Keep the log out of the repository's folder: the site serves every file at its root, and what_changed.cjs fails on one it does not know.

A line counts when it holds a result: JSON with "passed" and "of", or "<name> N of M […]" as b.sh prints them, or
"N of M passed" as the service tests print them. A check that printed no result at all ("NO RESULT", "unknown") fails too:
a check that stops before its end must not read as a pass.

A fault of the planner that a check has found, and that is not yet mended, is written down in tests/known-faults.json with the
line that fails for it. Such a line does not fail the run, and is listed under "known". The day it passes, the run fails
until it is taken off the list: the list cannot outlive the faults on it.
"""
import ast, json, os, re, sys

text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
# The number of lines each check runs is written down in tests/counts.json, part by part and check by check. A check that runs
# another number fails, and so does one that did not run or that nothing wrote down: a check that stopped early, a block that was
# skipped for want of a subject, a check run twice or a line added without saying so all show, by name. The counts are kept by
# check so that two builds made side by side write different lines of that file unless they change the same check.
part = sys.argv[2] if len(sys.argv) > 2 else None
try:
    COUNTS = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'counts.json'), encoding='utf-8'))
except FileNotFoundError:
    COUNTS = {}
checks = passed = 0
bad = []
ran, slot = [], None   # [name, lines] for each result in the order it came; slot is the last result b.sh has not yet signed
def count(name, lines, own=False):
    global slot
    ran.append([name or '(a result with no name)', lines]); slot = None if own else len(ran) - 1   # a result that says its own name ("named", in env.sh) keeps it
try:
    KNOWN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'known-faults.json'), encoding='utf-8'))
except FileNotFoundError:
    KNOWN = []
known = []
def forgiven(label, names):
    """True when every failed line of this check is a known fault, by its exact name. A known fault that did not fail is reported."""
    mine = [k['line'] for k in KNOWN if label == k['check'] or label.startswith(k['check'] + '-')]
    for line in mine:
        if line not in names:
            bad.append('%s: “%s” passes now. Take it off tests/known-faults.json.' % (label, line))
    left = [n for n in names if n not in mine]
    known.extend('%s: %s' % (label, n) for n in names if n in mine)
    return bool(names) and not left
def names_of(text):
    try:
        return [x if isinstance(x, str) else str(x.get('name', x)) for x in ast.literal_eval(text)]
    except Exception:
        return None
for line in text.splitlines():
    s = line.strip()
    m = re.match(r'^\((\S+): \d+ s; WIDTH=(\S+) DARK=(\S+)\)$', s)
    if m:   # b.sh signs each check it ran: the name it was asked for, the window's width, a computer set to dark
        if slot is not None:
            ran[slot][0] = m.group(1) + ('' if m.group(2) == '1280' else ' @' + m.group(2)) + (' dark' if m.group(3) == '1' else '')
        slot = None
        continue
    if 'NO RESULT' in s or s.startswith('unknown ') or 'Traceback (most recent call last)' in s or re.match(r'^Node\.js v\d', s) or re.match(r'^\w*Error: ', s) or re.search(r'Segmentation fault|^Killed\b|: (command )?not found\b|No such file or directory', s):
        bad.append(s[:300])   # a check that stopped: whatever it printed before that is not a result
        continue
    i = s.find('{"passed"')
    if i >= 0:
        try:
            d = json.loads(s[i:]) if s.endswith('}') else None
        except Exception:
            d = None
        if d is None:   # a long line cut short: read the two counts
            m = re.search(r'"passed":\s*(\d+),\s*"of":\s*(\d+)', s)
            d = {'check': (re.search(r'"check":\s*"([^"]*)"', s) or [None, None])[1], 'passed': int(m.group(1)), 'of': int(m.group(2)), 'finished': False if re.search(r'"finished":\s*false', s) else None, 'failed': not re.search(r'"failed":\s*\[\s*\]', s) and '"failed"' in s} if m else None
        if d and isinstance(d.get('of'), int):
            checks += d['of']; passed += d.get('passed') or 0
            count(d.get('check') or d.get('name') or s[:i].strip(), d['of'], own=bool(d.get('check')))
            if d.get('passed') != d['of'] or d['of'] == 0 or d.get('finished') is False or d.get('failed'):
                bad.append(s[:400])
            continue
        bad.append('a result that cannot be read: ' + s[:300])
        continue
    m = re.match(r'^(.*?)(\d+) of (\d+)( passed| \[.*)?$', s)
    if m and not s.startswith('('):
        a, b = int(m.group(2)), int(m.group(3))
        checks += b; passed += a
        count(m.group(1).strip(), b)
        label, names = m.group(1).strip(), names_of(m.group(4).strip()) if m.group(4) and m.group(4).startswith(' [') else None
        if b == 0:
            bad.append(s[:400])   # a check that ran no line has shown nothing
        elif names is None:
            if a != b:
                bad.append(s[:400])
        elif a + len(names) != b or (names and not forgiven(label, names)):   # every line short of the count is named, and every name is a known fault
            bad.append(s[:400])
        elif not names:
            forgiven(label, names)   # says so when a known fault of this check no longer fails
        continue
did = {}
for name, lines in ran:   # a check that ran twice under one name is told apart, so that neither can stand in for the other
    key, n = name, 1
    while key in did: n += 1; key = '%s #%d' % (name, n)
    did[key] = lines
want = COUNTS.get(part) if part else None
if not part:
    bad.append('no part was named, so the number of lines was compared with nothing: python3 -I tests/verdict.py <log> <part>')
elif not isinstance(want, dict):
    bad.append('tests/counts.json has no counts for the part “%s”' % part)
else:
    for key in list(did) + [k for k in want if k not in did]:
        if key not in want: bad.append('“%s” ran %d lines and is not in tests/counts.json under “%s”' % (key, did[key], part))
        elif key not in did: bad.append('“%s” is in tests/counts.json under “%s” with %d lines and did not run' % (key, part, want[key]))
        elif want[key] != did[key]: bad.append('“%s” ran %d lines and tests/counts.json says %d: if lines were added or taken out on purpose, write the new count there (tests/counts.py)' % (key, did[key], want[key]))
if checks == 0:
    bad.append('no result at all')
if len(sys.argv) > 3:   # what this part ran, for tests/counts.py to put together
    os.makedirs(os.path.dirname(os.path.abspath(sys.argv[3])), exist_ok=True)
    json.dump({part: did}, open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({'checks': checks, 'passed': passed, 'known': known, 'notPassed': bad}, ensure_ascii=False, indent=1))
sys.exit(0 if not bad else 1)

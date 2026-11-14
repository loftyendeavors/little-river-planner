"""Reads what tests/run.sh printed and says whether every check passed.

    sh tests/run.sh node | tee log; python3 -I tests/verdict.py log        (exit 0: all passed; 1: not)

A line counts when it holds a result: JSON with "passed" and "of", or "<name> N of M […]" as b.sh prints them, or
"N of M passed" as the service tests print them. A check that printed no result at all ("NO RESULT", "unknown") fails too:
a check that stops before its end must not read as a pass.
A fault of the planner that a check has found, and that is not yet mended, is written down in tests/known-faults.json with the
line that fails for it. Such a line does not fail the run, and is listed under "known". The day it passes, the run fails
until it is taken off the list: the list cannot outlive the faults on it.
"""
import ast, json, os, re, sys

text = open(sys.argv[1], encoding='utf-8', errors='replace').read()
need = int(sys.argv[2]) if len(sys.argv) > 2 else 1
checks = passed = 0
bad = []
try:
    KNOWN = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'known-faults.json'), encoding='utf-8'))
except FileNotFoundError:
    KNOWN = []
known = []
def forgiven(label, names):
    """True when every failed line of this check is a known fault. A known fault that did not fail here is reported."""
    mine = [k for k in KNOWN if label == k['check'] or label.startswith(k['check'] + '-')]
    for k in mine:
        if not any(k['line'] in n for n in names):
            bad.append('%s: “%s” passes now. Take it off tests/known-faults.json.' % (label, k['line']))
    left = [n for n in names if not any(k['line'] in n for k in mine)]
    known.extend('%s: %s' % (label, n) for n in names if n not in left)
    return bool(names) and not left
def names_of(text):
    try:
        return [x if isinstance(x, str) else str(x.get('name', x)) for x in ast.literal_eval(text)]
    except Exception:
        return None
for line in text.splitlines():
    s = line.strip()
    if 'NO RESULT' in s or s.startswith('unknown ') or 'Traceback (most recent call last)' in s:
        bad.append(s[:300])
        continue
    i = s.find('{"passed"')
    if i >= 0:
        try:
            d = json.loads(s[i:]) if s.endswith('}') else None
        except Exception:
            d = None
        if d is None:   # a long line cut short: read the two counts
            m = re.search(r'"passed":\s*(\d+),\s*"of":\s*(\d+)', s)
            d = {'passed': int(m.group(1)), 'of': int(m.group(2))} if m else None
        if d and isinstance(d.get('of'), int):
            checks += d['of']; passed += d.get('passed') or 0
            if d.get('passed') != d['of'] or d.get('finished') is False:
                bad.append(s[:400])
            continue
    m = re.match(r'^(.*?)(\d+) of (\d+)( passed| \[.*)?$', s)
    if m and not s.startswith('('):
        a, b = int(m.group(2)), int(m.group(3))
        checks += b; passed += a
        label, names = m.group(1).strip(), names_of(m.group(4).strip()) if m.group(4) and m.group(4).startswith(' [') else None
        if names is None:
            if a != b:
                bad.append(s[:400])
        elif not forgiven(label, names) and a != b:
            bad.append(s[:400])
        continue
    m = re.search(r'ok: (\d+)/(\d+)', s)   # site_check and the tour
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        checks += b; passed += a
        if a != b:
            bad.append(s[:400])
print(json.dumps({'checks': checks, 'passed': passed, 'known': known, 'notPassed': bad}, ensure_ascii=False, indent=1))
sys.exit(0 if not bad and checks >= need else 1)

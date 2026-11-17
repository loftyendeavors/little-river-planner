"""Puts together what every part ran, as tests/counts.json holds it: part by part, check by check, the number of lines.

    python3 -I tests/counts.py <folder of ran-<part>.json files>            prints it
    python3 -I tests/counts.py <folder of ran-<part>.json files> write      writes tests/counts.json, for the parts found there
    python3 -I tests/counts.py join <before> <here> <there>                  writes tests/counts.json joined check by check

tests/verdict.py writes a ran-<part>.json when it is given a third argument. On GitHub every part keeps its own, and the last
job ("All checks") prints them put together and keeps the result as "counts": a build that added or took out lines copies its
checks' new numbers from there. A part that was not run keeps the counts it had.

The file is laid out for two builds made side by side: one check a line, in the order of their names, with a line left empty
between two. Two builds that change two different checks then change two different places of the file, and git puts the two
together by itself. Two builds that change the same check both write its line, and so do two that each add a check whose name
falls in the same gap: whichever merges second writes that line again from its own run.

"join" is what tools/take_main.cjs runs when main is taken into a branch: the file as it stood where the branch left main, on the
branch, and on main. A check's line is kept from the side that changed it; a check added or taken out on one side is added or
taken out. Where both sides changed the same check, each by its own lines, both are taken (the build before's number, with what
each side added or took away): the run on the two together is what says whether that is right, and the line is printed.
"""
import glob, json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
ORDER = ['node', 'build', 'app1', 'app2', 'app3', 'app4', 'new', 'off', 'site1', 'site2', 'site3', 'site4', 'site5', 'site6', 'site7', 'site8', 'site9', 'site10', 'screens']
def lay(counts):
    if not isinstance(counts, dict): return json.dumps(counts)
    return '{\n\n' + ',\n\n'.join('  %s: %d' % (json.dumps(k, ensure_ascii=False), counts[k]) for k in sorted(counts)) + '\n\n }'
def text_of(out):
    text = '{\n' + ',\n'.join(' %s: %s' % (json.dumps(p), lay(c)) for p, c in out.items()) + '\n}\n'
    json.loads(text)
    return text
def ordered(parts):
    return {part: parts[part] for part in ORDER + sorted(p for p in parts if p not in ORDER) if part in parts}
if len(sys.argv) > 1 and sys.argv[1] == 'join':
    def load(f):
        try: return json.load(open(f, encoding='utf-8'))
        except FileNotFoundError: return {}
    was, mine, theirs = (load(f) for f in sys.argv[2:5])
    out, both = {}, []
    for part in set(was) | set(mine) | set(theirs):
        w, m, t = (x.get(part) if isinstance(x.get(part), dict) else ({} if part in x else None) for x in (was, mine, theirs))
        if m is None and t is None: continue
        if m is None and w is not None and t == w: continue    # taken out here, unchanged there
        if t is None and w is not None and m == w: continue    # taken out there, unchanged here
        w, m, t = w or {}, m if m is not None else dict(w or {}), t if t is not None else dict(w or {})
        joined = {}
        for check in set(w) | set(m) | set(t):
            a, b, c = w.get(check), m.get(check), t.get(check)
            if b == c: v = b
            elif b == a: v = c
            elif c == a: v = b
            elif b is None or c is None: v = b if c is None else c; both.append('%s / %s' % (part, check))
            else: v = (a or 0) + (b - (a or 0)) + (c - (a or 0)); both.append('%s / %s' % (part, check))
            if v is not None: joined[check] = v
        out[part] = joined
    open(os.path.join(here, 'counts.json'), 'w', encoding='utf-8').write(text_of(ordered(out)))
    print(json.dumps({'joined': sum(len(c) for c in out.values()), 'both': sorted(both)}, ensure_ascii=False))
    sys.exit(0)
try:
    have = json.load(open(os.path.join(here, 'counts.json'), encoding='utf-8'))
except FileNotFoundError:
    have = {}
ran = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'ran-*.json'))):
    ran.update(json.load(open(f, encoding='utf-8')))
if not ran:
    sys.exit('no ran-<part>.json in %s' % sys.argv[1])
out = ordered({part: ran.get(part, have.get(part)) for part in {**have, **ran}})
text = text_of(out)
if len(sys.argv) > 2 and sys.argv[2] == 'write':
    open(os.path.join(here, 'counts.json'), 'w', encoding='utf-8').write(text)
    print('tests/counts.json written: %s' % ', '.join('%s %d' % (p, sum(c.values())) for p, c in out.items() if isinstance(c, dict)))
else:
    sys.stdout.write(text)

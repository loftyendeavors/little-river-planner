"""Puts together what every part ran, as tests/counts.json holds it: part by part, check by check, the number of lines.

    python3 -I tests/counts.py <folder of ran-<part>.json files>            prints it
    python3 -I tests/counts.py <folder of ran-<part>.json files> write      writes tests/counts.json, for the parts found there

tests/verdict.py writes a ran-<part>.json when it is given a third argument. On GitHub every part keeps its own, and the last
job ("All checks") prints them put together and keeps the result as "counts": a build that added or took out lines copies its
checks' new numbers from there. A part that was not run keeps the counts it had.
"""
import glob, json, os, sys
here = os.path.dirname(os.path.abspath(__file__))
ORDER = ['node', 'build', 'app1', 'app2', 'app3', 'app4', 'new', 'off', 'site1', 'site2', 'site3', 'site4', 'site5', 'site6', 'site7', 'site8', 'site9', 'site10', 'screens']
try:
    have = json.load(open(os.path.join(here, 'counts.json'), encoding='utf-8'))
except FileNotFoundError:
    have = {}
ran = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'ran-*.json'))):
    ran.update(json.load(open(f, encoding='utf-8')))
if not ran:
    sys.exit('no ran-<part>.json in %s' % sys.argv[1])
out = {part: ran.get(part, have.get(part)) for part in ORDER + sorted(p for p in {**have, **ran} if p not in ORDER) if part in ran or part in have}
text = json.dumps(out, ensure_ascii=False, indent=1) + '\n'
if len(sys.argv) > 2 and sys.argv[2] == 'write':
    open(os.path.join(here, 'counts.json'), 'w', encoding='utf-8').write(text)
    print('tests/counts.json written: %s' % ', '.join('%s %d' % (p, sum(c.values())) for p, c in out.items() if isinstance(c, dict)))
else:
    sys.stdout.write(text)

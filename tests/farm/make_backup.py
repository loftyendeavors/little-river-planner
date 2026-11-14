"""The made-up farm as a backup the planner loads: a folder (plan.json, manifest.json, files/<sha256>) and the same as a zip.

    python3 -I tests/farm/make_backup.py <tests/farm/data> <out folder> <out.zip>

The plan is backup-plan.json as make_farm.cjs wrote it. The farm's drawn picture and a small picture for every variety go in
beside it, each under the name a backup gives a file: its sha256. The zip is written with fixed times, so two runs give the
same file.
"""
import base64, hashlib, json, sys, zipfile
from pathlib import Path

farm, backup, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
plan = json.loads((farm / 'backup-plan.json').read_text(encoding='utf-8'))
thumbs = json.loads((farm / 'thumbs.json').read_text(encoding='utf-8'))
photo = (farm / 'farm-map.jpg').read_bytes()
msha = hashlib.sha256(photo).hexdigest()
assert plan['map']['imageFile']['sha256'] == msha, 'the farm picture is not the one the plan names: run make_farm.cjs again'
files = {msha: photo}
for v in plan['varieties']:
    uri = thumbs.get(v['id'])
    if not uri:
        continue
    head, b64 = uri.split(',', 1)
    data = base64.b64decode(b64)
    sha = hashlib.sha256(data).hexdigest()
    v['photo'] = {**(v.get('photo') if isinstance(v.get('photo'), dict) else {}), 'sha256': sha, 'mime': head[5:].split(';')[0], 'name': v['id'] + '.jpg', 'size': len(data)}
    files[sha] = data
text = json.dumps(plan)
backup.mkdir(parents=True, exist_ok=True)
(backup / 'files').mkdir(exist_ok=True)
(backup / 'plan.json').write_text(text, encoding='utf-8')
(backup / 'manifest.json').write_text('{}', encoding='utf-8')
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    def put(name, data):
        z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 14, 12, 0, 0)), data, zipfile.ZIP_DEFLATED)
    put('plan.json', text)
    put('manifest.json', json.dumps({'note': 'the made-up farm the checks run on'}))
    for sha, data in sorted(files.items()):
        put('files/' + sha, data)
        (backup / 'files' / sha).write_bytes(data)
print(json.dumps({'zip': str(out), 'bytes': out.stat().st_size, 'photos': len(files) - 1}))

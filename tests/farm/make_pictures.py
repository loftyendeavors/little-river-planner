"""The made-up farm's pictures: a drawn view from above (farm-map.jpg) and a small picture for every variety (thumbs.json).

    python3 -I tests/farm/make_pictures.py <dir holding layout.json, written by make_farm.cjs>

Drawn, not photographed: grass, a lane, a pond, trees, and soil or a roof under each block of beds, where layout.json says the
blocks lie. Needs Pillow. The results are kept in the repository, so nothing that runs the checks needs Pillow.
"""
import base64, io, json, math, random, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

out = Path(sys.argv[1])
layout = json.loads((out / 'layout.json').read_text(encoding='utf-8'))
W, H, ft = layout['map']['imgW'], layout['map']['imgH'], layout['map']['ftPerPx']
rng = random.Random(20270114)

img = Image.new('RGB', (W, H), (92, 128, 72))
d = ImageDraw.Draw(img)
# mown grass in patches
for _ in range(900):
    x, y, r = rng.randrange(W), rng.randrange(H), rng.randrange(20, 90)
    g = rng.randrange(-10, 11)
    d.ellipse((x - r, y - r, x + r, y + r), fill=(92 + g, 128 + g, 72 + g // 2))
img = img.filter(ImageFilter.GaussianBlur(6))
d = ImageDraw.Draw(img)
# a lane along the bottom and up the middle, and a pond
d.polygon([(0, H - 70), (W, H - 110), (W, H - 70), (0, H - 30)], fill=(176, 168, 150))
d.polygon([(W * 0.655, 0), (W * 0.68, 0), (W * 0.685, H - 100), (W * 0.66, H - 100)], fill=(176, 168, 150))
d.ellipse((W - 330, 40, W - 90, 190), fill=(74, 110, 128))


def corners(x, y, w, l, turn):
    c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    return [(x + dx * w / 2 * c - dy * l / 2 * s, y + dx * w / 2 * s + dy * l / 2 * c) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


ROOF = {'greenhouse': (214, 220, 216), 'tunnel': (226, 228, 220)}
for b in layout['blocks']:
    x, y, w, l = b['x'] / ft, b['y'] / ft, max(b['w'], 14) / ft, max(b['l'], 14) / ft
    fill = ROOF.get(b['type'], (120, 98, 74))
    d.polygon(corners(x, y, w, l, b['turn']), fill=fill, outline=(70, 70, 64))
    if b['type'] in ROOF:   # the ribs of a roof
        a, q, r, c = corners(x, y, w, l, b['turn'])
        for k in range(1, 8):
            t = k / 8
            d.line([(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t), (q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t)], fill=(180, 186, 182), width=2)
# the beds themselves, a shade darker than the block they lie in
for b in layout['beds']:
    scale = layout['scale'].get(b['garden'], 1)
    w, l = b['w'] * scale / ft, b['l'] * scale / ft
    if b['type'] == 'CT' or w <= 0 or l <= 0:
        continue
    if 'Site' in b['type']:
        d.ellipse((b['x'] - w / 2, b['y'] - w / 2, b['x'] + w / 2, b['y'] + w / 2), fill=(238, 240, 236), outline=(120, 124, 120))
    else:
        d.polygon(corners(b['x'], b['y'], w, l, b['rot']), fill=(96, 76, 58))
# trees, kept off the blocks
taken = [(b['x'] / ft, b['y'] / ft, max(b['w'], b['l']) / ft / 2 + 30) for b in layout['blocks']]
placed = 0
while placed < 60:
    x, y, r = rng.randrange(W), rng.randrange(H - 140), rng.randrange(16, 44)
    if any(math.hypot(x - bx, y - by) < br + r for bx, by, br in taken):
        continue
    d.ellipse((x - r + 5, y - r + 7, x + r + 5, y + r + 7), fill=(58, 84, 52))
    d.ellipse((x - r, y - r, x + r, y + r), fill=(54 + rng.randrange(14), 96 + rng.randrange(18), 52))
    placed += 1
img = img.filter(ImageFilter.GaussianBlur(0.8))
img.save(out / 'farm-map.jpg', 'JPEG', quality=82, optimize=True)

# a small picture for each variety: its crop's colour, with a simple shape that differs from one to the next
thumbs = {}
for v in layout['varieties']:
    c = v['color'].lstrip('#')
    r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    n = v['n']
    t = Image.new('RGB', (96, 96), (min(255, r + 60), min(255, g + 60), min(255, b + 60)))
    td = ImageDraw.Draw(t)
    for k in range(3 + n % 4):
        a = (n * 37 + k * 360 / (3 + n % 4)) % 360
        cx, cy = 48 + 22 * math.cos(math.radians(a)), 48 + 22 * math.sin(math.radians(a))
        rr = 12 + (n * 7 + k * 3) % 10
        td.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(max(0, r - 12 * k), max(0, g - 8 * k), max(0, b - 10 * k)))
    td.ellipse((38, 38, 58, 58), fill=(max(0, r - 60), max(0, g - 60), max(0, b - 60)))
    buf = io.BytesIO()
    t.save(buf, 'JPEG', quality=70, optimize=True)
    thumbs[v['id']] = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')
(out / 'thumbs.json').write_text(json.dumps(thumbs), encoding='utf-8')
print(json.dumps({'photo': (out / 'farm-map.jpg').stat().st_size, 'thumbs': len(thumbs), 'thumbsBytes': (out / 'thumbs.json').stat().st_size}))

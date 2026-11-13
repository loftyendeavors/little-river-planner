/* The geometry of the farm map, with no browser and no farm: made-up shapes only, so this runs anywhere.
 * usage: node mapgeo_test.cjs <dir holding mapgeo.js>
 */
'use strict';
const path = require('path');
const G = require(path.resolve(process.argv[2] || path.join(__dirname, '..', 'js'), 'mapgeo.js'));
const results = []; let finished = false;
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) }); };
process.on('exit', () => {
  const failed = results.filter(r => !r.ok);
  if (!finished) failed.push({ name: 'the test ran to its end', ok: false });
  console.log(JSON.stringify({ passed: results.length - failed.filter(f => f.name !== 'the test ran to its end').length, of: results.length, failed: failed.map(f => ({ name: f.name, detail: f.detail })) }));
});
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const bed = (id, x, y, rot = 0, W = 4, L = 40) => ({ id, x, y, rot, W, L });

// ── 1. frames ──
{
  const [u, v] = G.into(30, 10, 5), [x, y] = G.outOf(30, u, v);
  check('a point taken into a turned frame comes back where it was', near(x, 10) && near(y, 5), { x, y });
  check('a quarter turn still lies on the same lines; 45 degrees is as far off as a bed can be', near(G.offAxis(84, 174), 0) && near(G.offAxis(0, 45), 45) && near(G.offAxis(354, 0), 6));
  check('a frame is set upright: within 45 degrees of the photo, whatever the bed says', G.upright(84) === -6 && G.upright(354) === -6 && G.upright(172) === -8 && G.upright(90) === 0 && G.upright(0) === 0, [84, 354, 172, 90].map(G.upright));
  const b = G.box(bed('a', 100, 200, 0, 4, 40), 0);
  check('a square-on bed fills its own box', near(b.u0, 98) && near(b.u1, 102) && near(b.v0, 180) && near(b.v1, 220));
  const q = G.box(bed('a', 100, 200, 90, 4, 40), 0);
  check('a bed turned a quarter turn is as wide as it was long', near(q.u1 - q.u0, 40) && near(q.v1 - q.v0, 4));
  const c = G.corners(bed('a', 0, 0, 90, 4, 40));
  check('corners turn with the bed', c.every(([cx, cy]) => near(Math.abs(cx), 20) && near(Math.abs(cy), 2)), c);
  check('a tower is as wide along as across, whatever its turn', (() => { const [hu, hv] = G.half({ x: 0, y: 0, rot: 37, W: 6, L: 6, round: true }, 0); return near(hu, 3) && near(hv, 3); })());
  check('a group’s frame is the turn most of it shares', G.frameOf([bed('a', 0, 0, 84), bed('b', 0, 0, 84), bed('c', 0, 0, 10)]) === -6);
}

// ── 2. the guard rail: one bed may not lie on another ──
{
  const a = bed('a', 0, 0), b = bed('b', 4, 0), far = bed('c', 6, 0), cross = bed('d', 0, 0, 90);
  check('beds that share an edge do not overlap', !G.overlaps(a, b));
  check('beds a path apart do not overlap', !G.overlaps(a, far));
  check('a bed laid across another does', G.overlaps(a, cross));
  check('a bed moved half a width onto its neighbour does', G.overlaps(a, bed('b', 2, 0)));
  check('a turned bed is judged by its real corners, not its box', !G.overlaps(bed('a', 0, 0, 45, 4, 40), bed('b', 4.3, 4.3, 45, 4, 40)) && G.overlaps(bed('a', 0, 0, 45, 4, 40), bed('b', 2, 2, 45, 4, 40)));
  check('two beds are apart when a side of either one separates them, not only a side of the first', !G.overlaps(bed('a', 0, 0, 0, 4, 40), bed('b', 12.73, 12.73, 45, 4, 40)) && !G.overlaps(bed('b', 12.73, 12.73, 45, 4, 40), bed('a', 0, 0, 0, 4, 40)) && G.overlaps(bed('a', 0, 0, 0, 4, 40), bed('b', 11, 11, 45, 4, 40)));
  check('slack lets a hair of overlap pass, and no more', !G.overlaps(a, bed('b', 3.9, 0), 0.1) && G.overlaps(a, bed('b', 3, 0), 0.1));
  const t = (id, x) => ({ id, x, y: 0, rot: 0, W: 2, L: 2, round: true });
  check('towers are judged as circles', !G.overlaps(t('a', 0), t('b', 2)) && G.overlaps(t('a', 0), t('b', 1.5)) && !G.overlaps({ ...t('a', 0) }, { ...t('b', 1.5), y: 1.5 }));
  const was = bed('m', 2, 0), now = bed('m', 2.5, 0);
  check('an overlap that came with the plan is left alone', G.newOverlaps(now, was, [a]).length === 0);
  check('a new one is named', G.newOverlaps(bed('m', 2, 0), bed('m', 10, 0), [a, far]).map(s => s.id).join() === 'a');
  check('nothing has no size, so it overlaps nothing', !G.overlaps({ id: 'z', x: 0, y: 0, rot: 0, W: 0, L: 0 }, a));
}

// ── 3. snapping ──
{
  const row = [bed('1', 0, 0), bed('2', 6, 0), bed('3', 12, 0)], boxes = row.map(s => G.box(s, 0));
  check('the path a row keeps is read from the row', G.pathsOf(boxes, 'u').join() === '2', G.pathsOf(boxes, 'u'));
  check('beds end to end give their gap along the row', G.pathsOf([G.box(bed('a', 0, 0), 0), G.box(bed('b', 0, 43), 0)], 'v').join() === '3');
  check('beds that share no length keep no path between them', G.pathsOf([G.box(bed('a', 0, 0), 0), G.box(bed('b', 6, 100), 0)], 'u').length === 0);
  // a fourth bed dropped roughly where the row would continue
  const mv = G.box(bed('4', 18.3, 0.4), 0), s = G.snap(mv, boxes, 0.6, { u: [2.6] });
  check('a bed dropped near the end of a row takes the row’s own path, whatever paths are kept elsewhere, and lines its ends up', near(s.du, -0.3) && near(s.dv, -0.4), s);
  check('and says what it matched: a path and an edge', s.lines.some(l => l.kind === 'path' && l.axis === 'u' && l.gap === 2) && s.lines.some(l => l.kind === 'edge' && l.axis === 'v'), s.lines);
  const none = G.snap(G.box(bed('4', 30, 9), 0), boxes, 0.6, { u: [2] });
  check('out of reach, nothing pulls', none.du === 0 && none.dv === 0 && !none.lines.length, none);
  const left = G.snap(G.box(bed('0', -6.2, 0), 0), boxes, 0.6, {});
  check('the path is kept on the near side too', near(left.du, 0.2), left);
  const mid = G.snap(G.box(bed('s', 6.3, 60, 0, 4, 10), 0), boxes, 0.6, {});
  check('a short bed lines its middle up with the bed above it', near(mid.du, -0.3), mid);
  const half = G.snap({ u0: 2.2, u1: 6.2, u: 4.2, v0: 50, v1: 90, v: 70 }, [{ u0: 0, u1: 4, u: 2, v0: -20, v1: 20, v: 0 }], 0.6, {});
  check('a middle lines up with a middle only: a bed’s middle over a neighbour’s edge is not a line', half.du === 0, half);
  const end = G.snap(G.box(bed('4', 18, -0.6, 0, 4, 42), 0), boxes, 0.6, {}, { v: ['v1'] });
  check('stretching one end, only that end snaps', near(end.dv, -0.4) && end.du === 0, end);
  check('a path is preferred to an edge the same distance away', (() => { const r = G.snap({ u0: 4.5, u1: 8.5, u: 6.5, v0: -20, v1: 20, v: 0 }, [{ u0: -2, u1: 2, u: 0, v0: -20, v1: 20, v: 0 }, { u0: 5, u1: 9, u: 7, v0: 100, v1: 140, v: 120 }], 1, { u: [2] }); return r.lines.find(l => l.axis === 'u').kind === 'path'; })());
  // a row with a wider strip somewhere near: the bed between two others must not take that strip from the bed beyond its neighbour
  const odd = [bed('1', 0, 0), bed('2', 6, 0), bed('x', 6, 60), bed('y', 17.5, 60)].map(sh => G.box(sh, 0));
  const third = G.snap(G.box(bed('3', 12.7, 0), 0), odd, 0.9, { u: [7.5, 2.75] });
  check('a path is kept with the next space along, not with one two beds away', near(third.du, -0.7) && third.lines.some(l => l.kind === 'path' && l.gap === 2), third);
  const between = G.snap(G.box(bed('m', 6.4, 0), 0), [bed('1', 0, 0), bed('3', 12, 0)].map(sh => G.box(sh, 0)), 0.6, { u: [2] });
  const alone = G.snap(G.box(bed('n', 6.3, 0), 0), [G.box(bed('1', 0, 0), 0)], 0.6, { u: [2] });
  check('beside a bed that stands alone, the path comes from what is kept round about', near(alone.du, -0.3) && alone.lines.some(l => l.kind === 'path'), alone);
  check('between two beds, the path is kept on both sides at once where it fits', near(between.du, -0.4) && between.lines.filter(l => l.kind === 'path').length === 2, between);
  const t = G.snapTurn(83.2, [84, 0]);
  check('a turn settles on a neighbour’s line', t.snapped && near(t.angle, 84), t);
  check('or on a square one', G.snapTurn(91.5, []).angle === 90 && G.snapTurn(358.4, []).angle === 0);
  check('or, well clear of both, on a whole degree', (() => { const r = G.snapTurn(63.4, [84]); return !r.snapped && r.angle === 63; })());
  check('a neighbour at a quarter turn counts as the same line', near(G.snapTurn(173.1, [84]).angle, 174));
}

// ── 4. lining up, spacing, rows ──
{
  const group = [bed('a', 0, 3), bed('b', 7, -2, 0, 4, 30), bed('c', 15, 1)];
  const top = G.align(group, 'v0', 0), tops = group.map(s => top.get(s.id).y - s.L / 2);
  check('lining up one end leaves every bed starting on the same line', tops.every(t => near(t, tops[0])) && near(tops[0], Math.min(3 - 20, -2 - 15, 1 - 20)), tops);
  check('and moves nothing across', group.every(s => near(top.get(s.id).x, s.x)));
  const mids = G.align(group, 'v', 0);
  check('lining up middles puts them on the group’s middle', group.every(s => near(mids.get(s.id).y, mids.get('a').y)));
  const even = G.spread(group, 'u', null, 0);
  check('spacing evenly keeps the two ends and equals the paths between', near(even.moves.get('a').x, 0) && near(even.moves.get('c').x, 15) && near(even.moves.get('b').x, 7.5) && near(even.path, 3.5), [...even.moves]);
  const packed = G.spread(group, 'u', 2, 0);
  check('spacing to a path sets each bed that far from the last', near(packed.moves.get('b').x, 6) && near(packed.moves.get('c').x, 12));
  // the same, in a frame the beds are turned to
  const tilted = [bed('a', 0, 0, 30), bed('b', 9, 2, 30), bed('c', 14, 9, 30)], sp = G.spread(tilted, 'u', 2, 30);
  const us = tilted.map(s => G.into(30, sp.moves.get(s.id).x, sp.moves.get(s.id).y)[0]).sort((p, q) => p - q);
  check('turned beds are spaced across their own width, not across the photo', near(us[1] - us[0], 6) && near(us[2] - us[1], 6), us);
  check('and keep their place along their own length', tilted.every(s => near(G.into(30, sp.moves.get(s.id).x, sp.moves.get(s.id).y)[1], G.into(30, s.x, s.y)[1])));
  const eight = Array.from({ length: 8 }, (_, i) => bed(String(i + 1), i * 9, i % 3, 0, 4, 20));
  const rows = G.arrange(eight, { columns: 4, path: 2, endGap: 5 }, 0);
  check('arranged in rows: four across, a path between, the next row past the end gap', near(rows.get('2').x - rows.get('1').x, 6) && near(rows.get('5').y - rows.get('1').y, 25) && near(rows.get('5').x, rows.get('1').x) && near(rows.get('8').x, rows.get('4').x), [...rows]);
  check('the first corner stays where the group’s was', near(rows.get('1').x - 2, G.boxAll(eight, 0).u0) && near(rows.get('1').y - 10, G.boxAll(eight, 0).v0));
  const flipped = G.arrange([bed('a', 0, 0, 180), bed('b', 20, 0, 0)], { columns: 2, path: 2, endGap: 2 }, 0);
  check('a bed already on the lines keeps its own turn: its starting end does not swap', flipped.get('a').rot === 180 && flipped.get('b').rot === 0);
  const turned = G.turnAbout([bed('a', 10, 0), bed('b', 0, 10, 15)], 0, 0, 90);
  check('a group turned a quarter turn: each bed goes round the middle and turns with it', near(turned.get('a').x, 0) && near(turned.get('a').y, 10) && turned.get('a').rot === 90 && turned.get('b').rot === 105);
  const scaled = G.scaleAbout([bed('a', 10, 0), bed('b', 0, -4)], 0, 0, 1.5);
  check('a garden scaled to the photo: every centre moves out from the middle by the same share', near(scaled.get('a').x, 15) && near(scaled.get('b').y, -6));
  const longer = G.stretch(bed('a', 0, 0, 0, 4, 40), 'v1', 10);
  check('stretching an end lengthens the bed and leaves the other end where it was', near(longer.L, 50) && near(longer.y - longer.L / 2, -20) && near(longer.W, 4));
  const wider = G.stretch(bed('a', 0, 0, 90, 4, 40), 'u0', 2);
  check('stretching a side of a turned bed moves it the way the bed is turned', near(wider.W, 6) && near(wider.x, 0) && near(wider.y, -1), wider);
  check('a bed cannot be stretched to nothing', G.stretch(bed('a', 0, 0), 'v0', -100).L > 0);
  const order = G.reading([bed('x', 12, 0), bed('y', 0, 0), bed('z', 6, 0), bed('w', 0, 50)], 0).map(s => s.id).join('');
  check('beds are numbered as they read: across, then the next row', order === 'yzxw', order);
}

// ── 5. new ground ──
{
  const beds = G.fillBlock({ x: 100, y: 100, rot: 0, W: 100, L: 400 }, { bedFt: 4, pathFt: 2, pxPerFt: 4 });
  // 25 ft across: 4 beds take 4*4 + 3*2 = 22; a fifth would need 28
  check('a block is filled with as many beds as fit across it', beds.length === 4 && beds.every(b => b.w === 4 && b.l === 100 && b.rot === 0), beds);
  check('the beds are centred in the block, a path apart', near(beds[0].x + beds[3].x, 200) && near(beds[1].x - beds[0].x, 24) && beds.every(b => near(b.y, 100)));
  const wide = G.fillBlock({ x: 0, y: 0, rot: 0, W: 400, L: 100 }, { bedFt: 4, pathFt: 2, pxPerFt: 4 });
  check('a wide block runs its beds the long way: turned a quarter turn and stacked', wide.length === 4 && wide.every(b => b.rot === 90 && near(b.x, 0)) && near(wide[1].y - wide[0].y, 24), wide);
  const short = G.fillBlock({ x: 0, y: 0, rot: 0, W: 100, L: 400 }, { bedFt: 4, pathFt: 2, pxPerFt: 4, runs: 'short' });
  check('or the short way when asked: more beds, each the block’s width', short.length === 17 && short.every(b => b.l === 25 && b.rot === 90), short.length);
  const odd = G.fillBlock({ x: 0, y: 0, rot: 0, W: 100, L: 403 }, { bedFt: 3.5, pathFt: 1.5, pxPerFt: 4 });
  check('lengths come out in whole half feet, never longer than the block', odd.every(b => b.l === 100.5) && odd.length === 5, odd);
  check('a block too narrow for one bed holds none', G.fillBlock({ x: 0, y: 0, rot: 0, W: 10, L: 400 }, { bedFt: 4, pathFt: 2, pxPerFt: 4 }).length === 0);
  const tilt = G.fillBlock({ x: 0, y: 0, rot: 30, W: 100, L: 400 }, { bedFt: 4, pathFt: 2, pxPerFt: 4 });
  check('a turned block gives turned beds, spaced across their own width', tilt.every(b => b.rot === 30) && near(Math.hypot(tilt[1].x - tilt[0].x, tilt[1].y - tilt[0].y), 24));
  const filled = beds.map((b, i) => ({ id: String(i), x: b.x, y: b.y, rot: b.rot, W: b.w * 4, L: b.l * 4 }));
  check('beds made for a block never overlap one another', filled.every((p, i) => filled.every((q, j) => i >= j || !G.overlaps(p, q))));
  const next = G.nextInRow([bed('1', 0, 0), bed('2', 6, 0)], 8);
  check('the next bed of a row goes one step past the last', near(next.x, 12) && near(next.y, 0));
  const lone = G.nextInRow([bed('1', 0, 0, 90)], 2);
  check('a lone bed is followed across its width, a path away', near(lone.x, 0) && near(lone.y, 6) && lone.rot === 90, lone);
  check('new beds take the numbers after the highest in use', G.nextNames(['1', '2', '7'], 2).join() === '8,9');
  check('named spaces get the name with a number', G.nextNames(['East row'], 2, 'East row').join() === 'East row 2,East row 3');
  check('a garden with no beds starts at 1', G.nextNames([], 3).join() === '1,2,3');
  check('a name already in use is passed over', G.nextNames(['East row', 'East row 2'], 1, 'East row').join() === 'East row 3');
}

// ── 6. pots and crates: a crop keeps its place ──
{
  const items = [{ id: 'a', from: 10, to: 60, n: 4 }, { id: 'b', from: 20, to: 40, n: 3 }, { id: 'c', from: 45, to: 90, n: 3 }, { id: 'd', from: 50, to: 70, n: 5 }];
  const S = G.seats(items, 12);
  check('the first crop in takes the first containers', S.get('a').join() === '0,1,2,3');
  check('the next stands beside it', S.get('b').join() === '4,5,6');
  check('a later crop takes the place a finished one left', S.get('c').join() === '4,5,6');
  check('and one that needs more room goes where it fits whole', S.get('d').join() === '7,8,9,10,11');
  check('first in is by the day a crop goes in, not by its name', (() => { const r = G.seats([{ id: 'a', from: 5, to: 9, n: 2 }, { id: 'z', from: 1, to: 9, n: 2 }], 4); return r.get('z').join() === '0,1' && r.get('a').join() === '2,3'; })());
  const clash = (p, q) => p.from <= q.to && q.from <= p.to && S.get(p.id).some(i => S.get(q.id).includes(i));
  check('no container holds two crops at once', items.every((p, i) => items.every((q, j) => i >= j || !clash(p, q))));
  check('a crop’s place is the same whichever day is asked: it is worked out once for the season', JSON.stringify([...G.seats(items, 12)]) === JSON.stringify([...S]));
  const pinned = G.seats([{ id: 'a', from: 10, to: 60, n: 4, pin: 8 }, { id: 'b', from: 20, to: 40, n: 3 }], 12);
  check('a place chosen by hand is kept', pinned.get('a').join() === '8,9,10,11' && pinned.get('b').join() === '0,1,2');
  const taken = G.seats([{ id: 'a', from: 10, to: 60, n: 4 }, { id: 'b', from: 20, to: 40, n: 3, pin: 2 }], 12);
  check('unless something already stands there: then the crop goes where there is room', taken.get('b').join() === '4,5,6');
  const split = G.seats([{ id: 'a', from: 1, to: 9, n: 2, pin: 2 }, { id: 'b', from: 2, to: 9, n: 3 }], 5);
  check('with no run long enough, a crop takes the free containers there are', split.get('b').join() === '0,1,4');
  const over = G.seats([{ id: 'a', from: 1, to: 9, n: 4 }, { id: 'b', from: 2, to: 9, n: 4 }], 6);
  check('a group that is over-full seats what it can and no more', over.get('a').length === 4 && over.get('b').join() === '4,5');
  check('a pin past the end of the group is not kept', G.seats([{ id: 'a', from: 1, to: 2, n: 3, pin: 10 }], 12).get('a').join() === '0,1,2' && G.seats([{ id: 'a', from: 1, to: 2, n: 3, pin: 9 }], 12).get('a').join() === '9,10,11');
  check('adding a later crop does not move an earlier one', (() => { const more = G.seats([...items, { id: 'e', from: 55, to: 80, n: 2 }], 14); return items.every(i => more.get(i.id).join() === G.seats(items, 14).get(i.id).join()); })());
}

// ── 7. the photo's scale ──
check('the scale comes from two points and the real distance between them', near(G.scaleFrom([0, 0], [300, 400], 125), 0.25) && G.scaleFrom([1, 1], [1, 1], 10) === null && G.scaleFrom([0, 0], [10, 0], 0) === null);

finished = true;

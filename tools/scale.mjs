#!/usr/bin/env node
// One scale under every screen: the steps of type, corners and motion, named once in css/app.css (:root) and used everywhere.
// DESIGN.md says what each step is for. This file is the one place the steps are written as numbers for a program.
//
//   node tools/scale.mjs check     every size, corner and speed in css/app.css is a step, or is listed below as left alone;
//                                  the last line is {"passed": N, "of": M, "failed": [...]}, as every check prints it
//   node tools/scale.mjs move      moves every value in css/app.css to its step and prints what moved (safe to run again)
//   node tools/scale.mjs table     what "move" would do, changing nothing
//   A path to another folder may follow (the repository, an app folder, a copy with a fault put in).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCALE = {
  type: [11, 13, 15, 18, 24, 32],
  corner: [4, 8, 12, 20],                 // and the pill
  pill: '999px',
  speed: { press: 120, move: 240 },      // ms: a press or a tick; something that arrives or moves
  ease: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
};
// where a size that is not a step goes
export const typeStep = px => (px < 12 ? 11 : px < 14 ? 13 : px < 16.5 ? 15 : px <= 20 ? 18 : px <= 27 ? 24 : 32);
export const cornerStep = px => (px <= 5 ? 4 : px <= 9 ? 8 : px <= 15 ? 12 : px < 99 ? 20 : 'pill');
export const speedStep = ms => (ms < 180 ? 'press' : 'move');

// ---- left alone, each for a reason. An entry that no longer matches anything fails the check: the list cannot go stale. ----
// Corners of marks on a chart: drawn to the chart's own measure, a day or a foot of bed, not to a control's.
const MARKS = [
  '.tl-bar', '.tl-bar .ph-turn', '.tl-bar .ph-nursery', '.tl-bar .ph-grow', '.tl-cell', '.tl-ghost', '.tl-open', '.tl-cursor::before',
  '.season-cursor', '.ah-cells i', '.sr-strip .ah-cells i', '.yc-meter', '.yc-meter i',
  // the swatch of a key is the mark it explains
  '.tl-key i', '.map-key i', '.legend-chip i', '.bn-legend i, .bn-tip-row i', '.bn-tip-row i', '.as-key i', '.yc-key i', '.hv-crop i', '.drag-ghost i',
  '.brand-mark',                          // the planner's own mark: a drawing
];
// Type sized to the thing it is drawn on: a label on the map grows with the map, a letter that stands for a photograph with its tile.
const SIZED = ['.garden-label', '.bed-label', '.bed-tag', '.thumb.none span', '.thumb.fill.none span'];
// Animations that are not an arrival or a press: a wait, a flash that draws the eye, the flourish of a tick. Left as they were.
const WAITS = ['insp-said 8s', 'wait-flash 0.9s', 'tk-pop 0.5s', 'tk-rise 0.5s'];
// Sizes in points are the printed sheets' and are left: paper is not a screen.

// ---- reading the style sheet ----
// Every rule that holds declarations, with where its body lies. Comments are blanked, so nothing inside one is read or changed.
export function rules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  const out = [], stack = [];
  let last = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { stack.push({ sel: src.slice(last, i).replace(/\s+/g, ' ').trim(), at: i }); last = i + 1; }
    else if (c === '}') {
      const top = stack.pop(), body = src.slice(top.at + 1, i);
      if (!body.includes('{')) out.push({ sel: top.sel, within: stack.map(s => s.sel), from: top.at + 1, body });
      last = i + 1;
    } else if (c === ';' && !stack.length) last = i + 1;
  }
  return out;
}
// the declarations of a body: property, value, and where the value lies in the body
function declarations(body) {
  const out = [];
  let depth = 0, start = 0;
  const take = end => {
    const text = body.slice(start, end), m = text.match(/^(\s*)([\w-]+)(\s*:\s*)([\s\S]*?)\s*$/);
    if (m) out.push({ prop: m[2].toLowerCase(), value: m[4], at: start + m[1].length + m[2].length + m[3].length });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++; else if (c === ')') depth--; else if (c === ';' && !depth) { take(i); start = i + 1; }
  }
  take(body.length);
  return out;
}
// split on spaces or commas that are not inside brackets
function split(value, by) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of value) {
    if (c === '(') depth++; else if (c === ')') depth--;
    if (!depth && (by === ' ' ? /\s/.test(c) : c === by)) { if (cur.trim() || by !== ' ') out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim() || by !== ' ') out.push(cur);
  return out.map(s => s.trim());
}
const bare = v => v.replace(/\s*!important\s*$/, '');
const tail = v => (/!important\s*$/.test(v) ? ' !important' : '');
const ms = t => { const m = t.match(/^(\d*\.?\d+)(ms|s)$/); return m ? (m[2] === 's' ? +m[1] * 1000 : +m[1]) : null; };
const EASINGS = /^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\)|var\(--(tk-)?ease\))$/;

// One declaration read against the scale: what it should be written as (to), and what is wrong with it as it stands (off).
function read(rule, d) {
  const v = bare(d.value), imp = tail(d.value), still = { to: d.value, off: null, moved: [] };
  const reduced = rule.within.some(w => /prefers-reduced-motion/.test(w));
  if (d.prop === 'font-size' || d.prop === 'font') {
    if (SIZED.includes(rule.sel)) return { ...still, left: 'sized' };
    if (/^(inherit|0)$/.test(v)) return still;
    const parts = d.prop === 'font' ? split(v, ' ') : [v];
    const at = parts.findIndex(p => /^(\d*\.?\d+(px|pt)|var\(--type-\d+\))(\/.+)?$/.test(p));
    if (at < 0) return { ...still, off: 'a size that is not a step' };
    const [size, ...lh] = parts[at].split('/');
    if (/pt$/.test(size)) return { ...still, left: 'print' };
    const step = /^var/.test(size) ? +size.match(/\d+/)[0] : typeStep(parseFloat(size));
    if (!SCALE.type.includes(step)) return { ...still, off: `${size} is not a step` };
    const token = `var(--type-${step})`;
    if (size === token) return still;
    parts[at] = [token, ...lh].join('/');
    return { to: parts.join(' ') + imp, off: `${size} is not written as a step (${token})`, moved: [['type', size, step + 'px']] };
  }
  if (d.prop === 'border-radius') {
    if (MARKS.includes(rule.sel)) return { ...still, left: 'mark' };
    const moved = [];
    const parts = split(v, ' ').map(p => {
      if (/^(0|inherit|\/|var\(--corner-(4|8|12|20|pill)\))$/.test(p)) return p;
      const step = p === 'var(--radius)' ? 8 : p === '50%' ? 'pill' : /^\d*\.?\d+px$/.test(p) ? cornerStep(parseFloat(p)) : null;
      if (step === null) { moved.push(null); return p; }
      moved.push(['corner', p, step === 'pill' ? 'pill' : step + 'px']);
      return `var(--corner-${step})`;
    });
    if (moved.includes(null)) return { ...still, off: 'a corner that is not a step' };
    return moved.length ? { to: parts.join(' ') + imp, off: `${moved.map(m => m[1]).join(' ')} is not written as a step`, moved } : still;
  }
  if (d.prop === 'transition' || d.prop === 'animation') {
    if (/^none$/.test(v) || reduced) return still;
    const moved = [];
    let left = null;
    const parts = split(v, ',').map(part => {
      const words = split(part, ' ');
      if (d.prop === 'animation' && WAITS.some(w => part.startsWith(w))) { left = 'wait'; return part; }
      const times = words.map((w, i) => (ms(w) !== null || /^var\(--speed-(press|move)\)$/.test(w) ? i : -1)).filter(i => i >= 0);
      if (!times.length) { moved.push(null); return part; }
      const was = words[times[0]], step = /^var/.test(was) ? was.match(/press|move/)[0] : speedStep(ms(was));
      const token = `var(--speed-${step})`, eases = words.filter(w => EASINGS.test(w));
      const rest = words.filter((w, i) => i !== times[0] && !EASINGS.test(w));           // the name, a delay, "both", a count
      const first = d.prop === 'transition' ? rest.shift() : null;                       // a transition names its property first
      const out = [first, d.prop === 'animation' ? rest.shift() : null, token, ...rest.filter(w => ms(w) !== null), 'var(--ease)', ...rest.filter(w => ms(w) === null)].filter(Boolean).join(' ');
      if (was !== token) moved.push(['speed', was, SCALE.speed[step] + ' ms']);
      else if (eases.length !== 1 || eases[0] !== 'var(--ease)' || out !== words.join(' ')) moved.push(['easing', eases.join(' ') || '(none)', 'the one easing']);
      return out;
    });
    if (moved.includes(null)) return { ...still, off: 'no speed is given' };
    return moved.length ? { to: parts.join(', ') + imp, off: `${moved.map(m => m[1]).join(', ')} is not one of the two speeds on the one easing`, moved, left } : { ...still, left };
  }
  if ((d.prop === 'transition-duration' || d.prop === 'animation-duration') && !reduced) {
    return /^var\(--speed-(press|move)\)$/.test(v) ? still : { ...still, off: `${v} is not one of the two speeds` };
  }
  return null;
}

// Every declaration the scale is about, read once.
function survey(css) {
  const seen = [];
  for (const rule of rules(css)) for (const d of declarations(rule.body)) {
    const r = read(rule, d);
    if (r) seen.push({ rule, d, ...r, at: rule.from + d.at });
  }
  return seen;
}
export function move(css) {
  const seen = survey(css).filter(s => s.to !== s.d.value).sort((a, b) => b.at - a.at);
  let out = css;
  for (const s of seen) out = out.slice(0, s.at) + s.to + out.slice(s.at + s.d.value.length);
  const table = {};
  for (const s of seen) for (const [kind, from, to] of s.moved) { const k = `${kind}\t${from}\t${to}`; table[k] = (table[k] || 0) + 1; }
  return { css: out, table, changed: seen.length };
}
// the steps as :root names them
function named(css) {
  const root = rules(css).find(r => r.sel === ':root');
  const got = Object.fromEntries(declarations(root ? root.body : '').map(d => [d.prop, d.value]));
  const want = { '--corner-pill': SCALE.pill, '--speed-press': SCALE.speed.press + 'ms', '--speed-move': SCALE.speed.move + 'ms', '--ease': SCALE.ease };
  for (const n of SCALE.type) want[`--type-${n}`] = n + 'px';
  for (const n of SCALE.corner) want[`--corner-${n}`] = n + 'px';
  const wrong = Object.keys(want).filter(k => got[k] !== want[k]).map(k => `${k} is ${got[k] === undefined ? 'not named' : got[k]}, not ${want[k]}`);
  const twice = Object.keys(want).filter(k => (css.match(new RegExp(`(^|[\\s;{])${k}\\s*:`, 'g')) || []).length > 1).map(k => `${k} is named more than once`);
  return [...wrong, ...twice];
}

export function check(folder) {
  const css = fs.readFileSync(path.join(folder, 'css/app.css'), 'utf8');
  const seen = survey(css), lines = [];
  const line = (name, bad) => lines.push({ name, bad });
  const where = s => `${s.rule.sel.slice(0, 70)} { ${s.d.prop}: ${s.d.value} }: ${s.off}`;
  const of = (props, kind) => seen.filter(s => props.includes(s.d.prop) && s.off && (!kind || kind(s))).map(where);
  line('every type size in css/app.css is a step of the scale (11 13 15 18 24 32), written by its name', of(['font-size', 'font']));
  line('every corner is a step of the scale (4 8 12 20, the pill), written by its name, or belongs to a mark on a chart that is listed', of(['border-radius']));
  line('every transition and every animation runs at one of the two speeds (120 ms, 240 ms) on the one easing, or is a wait that is listed', of(['transition', 'animation', 'transition-duration', 'animation-duration']));
  line('the steps are named once, in :root, with the values DESIGN.md gives', named(css));
  // a list of what is left alone that names something no longer there would hide a new fault behind an old excuse
  const sels = new Set(rules(css).map(r => r.sel)), waits = seen.filter(s => s.d.prop === 'animation').map(s => s.d.value).join(' , ');
  const used = (list, prop) => list.filter(sel => !seen.some(s => s.rule.sel === sel && prop.includes(s.d.prop)));
  line('everything listed as left alone is still in the style sheet: each mark, each label sized to its drawing, each wait',
    [...used(MARKS, ['border-radius']).map(s => `the mark ${s} has no corner`), ...used(SIZED, ['font', 'font-size']).map(s => `${s} has no size`), ...WAITS.filter(w => !waits.includes(w)).map(w => `no animation "${w}"`), ...MARKS.concat(SIZED).filter(s => !sels.has(s)).map(s => `${s} is not a rule`)]);
  // sizes belong to the style sheet: a size set by a script is one this check cannot see
  const js = path.join(folder, 'js'), scripted = [];
  for (const f of fs.existsSync(js) ? fs.readdirSync(js).filter(f => f.endsWith('.js')).sort() : []) {
    fs.readFileSync(path.join(js, f), 'utf8').split('\n').forEach((text, i) => {
      if (/font-size\s*:|border-radius\s*:|\bfont\s*:\s*\d|transition\s*:|\.style\.(fontSize|font|borderRadius|transition|animation)\s*=|animation\s*:/.test(text.replace(/\/\/.*$/, ''))) scripted.push(`js/${f} line ${i + 1} sets a size, a corner or a speed`);
    });
  }
  line('no script sets a size, a corner or a speed: they are the style sheet\'s to give', scripted);
  // the page that says what each step is for names the same steps
  const design = path.join(folder, 'DESIGN.md');
  const text = fs.existsSync(design) ? fs.readFileSync(design, 'utf8') : null;
  const want = [SCALE.type.join(', '), SCALE.corner.join(', '), `${SCALE.speed.press} ms`, `${SCALE.speed.move} ms`];
  line('DESIGN.md names the same steps as this check', text === null ? ['there is no DESIGN.md beside css/ and js/'] : want.filter(w => !text.includes(w)).map(w => `DESIGN.md does not say "${w}"`));
  const failed = lines.filter(l => l.bad.length);
  for (const l of lines) console.log(`${l.bad.length ? 'FAIL' : 'ok  '} ${l.name}${l.bad.length ? '\n     ' + l.bad.slice(0, 12).join('\n     ') + (l.bad.length > 12 ? `\n     … and ${l.bad.length - 12} more` : '') : ''}`);
  const left = k => seen.filter(s => s.left === k).length;
  console.log(`left alone: ${left('mark')} corners of marks, ${left('sized')} labels sized to their drawing, ${left('print')} sizes in points, ${left('wait')} waits`);
  console.log(JSON.stringify({ passed: lines.length - failed.length, of: lines.length, failed: failed.map(l => l.name) }));
  return !failed.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [what, where] = process.argv.slice(2);
  const folder = path.resolve(where || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (what === 'check') process.exit(check(folder) ? 0 : 1);
  else if (what === 'move' || what === 'table') {
    const file = path.join(folder, 'css/app.css'), css = fs.readFileSync(file, 'utf8'), r = move(css);
    if (what === 'move') fs.writeFileSync(file, r.css);
    const rows = Object.entries(r.table).map(([k, n]) => [...k.split('\t'), n]).sort((a, b) => a[0].localeCompare(b[0]) || parseFloat(a[1]) - parseFloat(b[1]));
    for (const [kind, from, to, n] of rows) console.log(`${kind.padEnd(7)} ${String(from).padEnd(34)} → ${String(to).padEnd(14)} ${n}`);
    console.log(`${r.changed} declarations ${what === 'move' ? 'moved' : 'would move'}`);
  } else { console.log('usage: node tools/scale.mjs check | move | table  [folder]'); process.exit(2); }
}

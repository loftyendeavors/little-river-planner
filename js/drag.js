/* Little River Farm Planner — dragging crops and plantings onto growing spaces.
 *
 * Built on pointer events so one code path serves mouse and pen. Touch uses
 * tap-to-arm instead (tap a crop, then tap beds), because a finger drag on a
 * map has to stay free for panning.
 *
 * A crop from the library is planted on the planning date. A planting picked
 * up on the map keeps its own date and only changes ground; on the timeline it
 * takes the date it is dropped on. Hold Alt to leave the original and place a copy.
 * A planting that has no bed yet (one of a series, waiting to be placed) keeps its
 * own date wherever it is dropped: the series set its dates, the drop chooses its ground.
 *
 * While something is in the air every space on the map shows what a drop
 * there would do: take it, take part of it, trade places, or nothing.
 */
(function (root) {
  'use strict';
  const App = root.LRFApp, UI = root.LRFUI, E = root.LRFEngine;
  const { h } = UI;
  let pending = null, drag = null;

  function watch(e, spec) {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    pending = { spec, x: e.clientX, y: e.clientY, alt: e.altKey };
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', cancel);
  }
  const payloadNow = () => drag.base.plantingId ? { ...drag.base, copy: drag.copy || undefined } : drag.base;
  /** A moved planting keeps its date on the map; a library crop goes in on the planning date. */
  function dateFor(target) {
    if (drag.base.waitingId) { const w = App.waitingOne(drag.base.waitingId); return w ? E.s2d(w.date) : App.state.date; }
    if (target.date) return target.date;
    const p = drag.base.plantingId ? App.state.engine.planting(drag.base.plantingId) : null;
    return p ? E.s2d(p.date) : App.state.date;
  }
  function surveyMap() {
    // One pass over the farm: what would a drop do in each space?
    drag.states = new Map();
    const payload = payloadNow();
    for (const bed of App.state.plan.beds) if (bed.active !== false) drag.states.set(bed.id, App.preview(payload, { bedId: bed.id, date: dateFor({}), survey: true }).state);
  }
  function begin(spec, alt) {
    const ghost = h('div.drag-ghost', h('i', { style: { background: spec.color } }), h('b', spec.label), h('span.drag-hint', ''));
    document.body.append(ghost);
    document.body.classList.add('dragging');
    drag = { base: spec.payload, label: spec.label, grabDays: spec.grabDays || 0, copy: !!alt && !!spec.payload.plantingId, ghost, target: null, states: null };
    if (App.state.view === 'map') { surveyMap(); root.LRFMap.showDrop(drag.states, null); }
  }
  function onMove(e) {
    if (pending && !drag && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 5) begin(pending.spec, pending.alt);
    if (!drag) return;
    e.preventDefault();
    const onMap = App.state.view === 'map', copy = !!e.altKey && !!drag.base.plantingId;
    if (copy !== drag.copy) { drag.copy = copy; if (onMap) surveyMap(); }
    drag.ghost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
    drag.ghost.classList.toggle('copying', drag.copy);
    const spot = onMap ? root.LRFMap.targetAt(e.clientX, e.clientY) : root.LRFTimeline.targetAt(e.clientX, e.clientY, drag.grabDays);
    const hint = drag.ghost.querySelector('.drag-hint');
    if (!spot) {
      drag.target = null; drag.ghost.dataset.state = '';
      hint.textContent = drag.base.waitingId ? `Drop on a ${onMap ? 'bed' : 'row'} · it keeps its date, ${UI.day(dateFor({}))}` : onMap ? (drag.base.plantingId ? 'Drop on a bed · Alt copies' : 'Drop on a bed') : 'Drop on a row at a date';
    } else {
      const target = { ...spot, date: dateFor(spot) }, preview = App.preview(payloadNow(), target), bed = App.state.engine.bedOf(target.bedId);
      drag.target = { ...target, preview };
      drag.ghost.dataset.state = preview.state;
      hint.textContent = `${App.bedLabel(bed)} · ${preview.text}`;
    }
    if (onMap) root.LRFMap.showDrop(drag.states, drag.target); else root.LRFTimeline.showDrop(drag.target);
  }
  function finish() {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', cancel);
    pending = null;
    if (!drag) return null;
    const done = drag; drag = null;
    done.ghost.remove();
    document.body.classList.remove('dragging');
    root.LRFMap.showDrop(null); root.LRFTimeline.showDrop(null);
    return done;
  }
  function onUp() {
    const done = finish(), t = done && done.target;
    if (t) App.place(done.base.plantingId ? { ...done.base, copy: done.copy || undefined } : done.base, t.bedId, t.date, { along: t.along, across: t.across });
  }
  function cancel() { finish(); }

  root.addEventListener('keydown', e => { if (e.key === 'Escape' && drag) { e.stopPropagation(); cancel(); } }, true);
  root.LRFDrag = { watch, cancel, active: () => !!drag, pending: () => !!pending };
})(window);

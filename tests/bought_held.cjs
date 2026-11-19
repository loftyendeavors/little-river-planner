'use strict';
/* N2: a planting bought in as plants or plugs (js/engine.js startedFrom) has no sowing day, cells, trays, seed or mix, and Seeds counts
 * its plants with the plan's spare. A build before N2 sows it. The checks that hold this build to the one before it ("with nothing
 * set, nothing moves") therefore compare the two on the plan without the plantings this build counts as bought in: every other
 * planting, the benches, the trays, Seeds and Tasks must be as they were. What N2 does to the plantings bought in, and that their
 * harvest does not move, is tests/bought_test.cjs's.
 *
 *   held(E, Lib, plan, old)   the plan to give both builds: `plan` itself when nothing is bought in or when the build before (`old`,
 *                             an engine of it) knows the rule too; otherwise a copy without the plantings bought in
 *   bought(eng, plan)         the ids of the plantings an engine of this build counts as bought in
 */
const bought = (eng, plan) => (plan.plantings || []).filter(p => { const r = eng.calc(p); return !!(r && r.boughtIn); }).map(p => p.id);
/** Does an engine know the rule? A build that does says what each planting is started from. */
const knows = eng => !!eng && typeof eng.startedFrom === 'function';
function held(E, Lib, plan, old) {
  if (knows(old)) return plan;
  const ids = new Set(bought(E.create(plan, Lib), plan));
  if (!ids.size) return plan;
  return { ...plan, plantings: plan.plantings.filter(p => !ids.has(p.id)) };
}
module.exports = { held, bought, knows };

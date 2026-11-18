'use strict';
/* E2c: in open ground the first fall frost ends a frost-tender crop's harvest, and its yield follows the days that are left.
 * A build before E2c knows nothing of it. The checks that hold this build to the one before it ("with nothing set, nothing
 * moves") therefore compare the build before with this build on the plan with every planting the frost cuts held at the last
 * day it was to be picked, by a last day of its own: the one way the rule leaves a planting alone (his word of Nov 18). Every
 * other planting is compared as it is. What the rule does to the plantings it cuts is tests/frost_test.cjs's.
 *
 *   held(E, Lib, plan, old)   the plan to give this build: `plan` itself when nothing is cut or when the build before (`old`, an
 *                             engine of it) knows the rule too; otherwise a copy with the cut plantings held
 *   cut(eng, plan)            the ids of the plantings the frost cuts, by an engine of this build
 */
const cut = (eng, plan) => (plan.plantings || []).filter(p => { const r = eng.calc(p); return !!(r && r.frostCut); }).map(p => p.id);
/** Does an engine know the frost rule? A build that does has the season's end of a place to say (E2c). */
const knows = eng => !!eng && typeof eng.seasonEndOf === 'function';
function held(E, Lib, plan, old) {
  if (knows(old)) return plan;
  const eng = E.create(plan, Lib), ids = new Set(cut(eng, plan));
  if (!ids.size) return plan;
  return { ...plan, plantings: plan.plantings.map(p => ids.has(p.id) ? { ...p, harvestEnd: E.d2s(eng.calc(p).frostCut.planned) } : p) };
}
module.exports = { held, cut, knows };

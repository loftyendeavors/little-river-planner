import library from '../../../js/library.js';
import planIO from '../../../js/planio.js';

export function starter(name, kind) {
  if (!['sample', 'empty'].includes(kind)) throw new Error('Choose a starting farm.');
  const plan = planIO.sample(library);
  plan.settings.farm = name.trim();
  delete plan.lrfNext.sample;
  if (kind === 'empty') {
    plan.gardens = [];
    plan.beds = [];
    plan.plantings = [];
    plan.customers = [];
  }
  return plan;
}

export function addField(plan, name, count, length, width) {
  if (!name.trim() || name.trim().length > 80 || !Number.isInteger(count) || count < 1 || count > 100 ||
      !Number.isFinite(length) || length < 1 || length > 10000 || !Number.isFinite(width) || width < 0.25 || width > 100) {
    throw new Error('Check the field name, bed count and dimensions.');
  }
  const id = 'g-' + crypto.randomUUID();
  const garden = { id, name: name.trim(), type: 'field', active: true, order: plan.gardens.length, ...library.gardenTypes.field };
  const beds = Array.from({ length: count }, (_, i) => ({
    id: id + '-' + (i + 1), gardenId: id, bed: String(i + 1), type: 'RB', orient: 'NS', w: width, l: length, px: null, note: '', active: true
  }));
  return { ...plan, gardens: [...plan.gardens, garden], beds: [...plan.beds, ...beds] };
}

export function backup(plan) {
  return JSON.stringify(planIO.join(plan, null), null, 2);
}

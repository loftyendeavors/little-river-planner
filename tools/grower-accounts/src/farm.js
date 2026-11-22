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

export function backup(stored) {
  const { __growerFiles: files = {}, ...core } = stored;
  const attic = JSON.parse(files.attic || '{}');
  const extra = JSON.parse(files['attic-new'] || '{}');
  const plan = planIO.join(core, { ...attic, varieties: { ...attic.varieties, ...extra.varieties } });
  // The ordinary planner reads keep and ignores the account copy. Farm settings can also restore photos.
  plan.lrfNextKeep = { v: 1, savedAt: new Date().toISOString(), keep: core.lrfNext || {},
    grower: { version: 1, plan: stored } };
  return JSON.stringify(plan);
}

export function readGrowerBackup(text) {
  return growerBackupPlan(JSON.parse(text)?.lrfNextKeep?.grower);
}

export function growerBackupPlan(record) {
  if (record?.version !== 1) throw Error('Choose a backup downloaded from your grower account.');
  planIO.assertPlan(record.plan);
  return record.plan;
}

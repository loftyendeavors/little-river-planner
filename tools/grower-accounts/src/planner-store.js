// Only the authenticated account row is durable. Every write compares the revision we opened.
export function createPlannerStore(row, persist, onStatus) {
  const { __growerFiles: savedFiles = {}, ...opened } = row.plan;
  let plan = structuredClone(opened);
  let files = { ...savedFiles };
  let revision = row.revision;
  let dirty = false;
  let writing = null;
  let active = true;
  let conflict = false;
  let timer;
  const stored = () => Object.keys(files).length ? { ...plan, __growerFiles: files } : plan;
  const status = (state, detail = '') => {
    if (active) onStatus({ backend: 'cloud', state, detail,
      label: state === 'error' && conflict ? 'Newer farm saved · view recovery options' : undefined });
  };
  const unsaved = () => conflict
    ? 'Another window saved a newer farm. Download your edits or reopen the latest farm.'
    : 'Your changes have not reached your account. Retry when connected.';
  async function write() {
    while (active && dirty) {
      if (conflict) throw Error(unsaved());
      dirty = false;
      const next = stored();
      status('saving');
      try {
        const result = await persist(next, revision);
        if (!active) return;
        revision = result.revision;
      } catch (error) {
        dirty = true;
        conflict = error?.code === '40001';
        const reason = error?.code === '23514' ? 'This farm exceeds the account storage limit. Download your edits before reopening.' : unsaved();
        status('error', reason);
        throw Error(reason);
      }
    }
    status('saved');
  }
  function flush() {
    clearTimeout(timer);
    if (!active) return Promise.reject(Error('Reopen your farm.'));
    if (!writing && dirty) writing = write().finally(() => { writing = null; });
    return writing || Promise.resolve();
  }
  function queue() {
    dirty = true;
    clearTimeout(timer);
    if (conflict) { status('error', unsaved()); return; }
    status('pending');
    timer = setTimeout(() => flush().catch(() => {}), 180);
  }
  function save(value) {
    if (!active) return;
    plan = structuredClone(value);
    queue();
  }
  return {
    backend: 'cloud', connect: async () => 'cloud', load: async () => structuredClone(plan),
    watch() {}, save, flush, resume: queue, get pending() { return dirty || !!writing; },
    get conflicted() { return conflict; },
    async saveNow(value) { if (value !== undefined) save(value); await flush(); },
    retry: () => flush().catch(() => {}),
    loadBlob: async key => files[key] ?? null,
    async saveBlob(key, value, progress) {
      files = { ...files, [key]: value }; queue(); await flush();
      progress?.(1, 1); return true;
    },
    async clearBlob(key) {
      if (!(key in files)) return;
      files = { ...files }; delete files[key]; queue(); await flush();
    },
    draft: () => structuredClone(stored()),
    recover: () => ({ plan: structuredClone(stored()), revision }),
    dispose() { active = false; clearTimeout(timer); }
  };
}

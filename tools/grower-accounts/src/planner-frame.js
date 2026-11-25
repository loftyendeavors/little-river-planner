// The grower site supplies the authenticated row before the planner may start.
const host = window.parent !== window && window.parent.openGrowerEditor?.(window);
if (!host) {
  location.replace('../');
} else {
  const prefs = new Map();
  window.LRFGrowerPreferences = {
    getItem: k => prefs.get(k) ?? null,
    setItem: (k, v) => prefs.set(k, String(v)),
    removeItem: k => prefs.delete(k)
  };
  window.LRF_BUNDLED = { info: null };
  let store;
  window.LRFStore = { create(status) { store = host.createStore(status); return store; } };
  const script = document.createElement('script');
  script.src = './planner.js';
  script.onload = () => {
    const app = window.LRFApp;
    if (!app) return host.failed();
    const importPortableBackup = app.importBackup;
    app.exportBackup = host.download;
    app.importBackup = async (file, options) => {
      if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') {
        let account;
        try { account = JSON.parse(await file.text())?.lrfNextKeep?.grower; }
        catch { /* The portable importer reports unreadable files. */ }
        if (account) return host.restore(account);
      }
      return importPortableBackup(file, options);
    };
    app.retrySave = () => store.conflicted ? host.focusRecovery() : store.retry();
    app.saveNow = async () => {
      try {
        await store.flush();
        window.LRFUI.toast('Saved to your grower account.');
        return { cloud: true };
      } catch { return null; } // The account banner keeps the error and recovery actions visible.
    };
    let startView = host.startView;
    const ready = () => {
      document.getElementById('folderMenu').hidden = true;
      document.getElementById('saveNowNote').textContent = 'Save to your grower account (Ctrl+S)';
      if (!app.state.ready) return;
      if (startView === 'map') {
        startView = null;
        window.LRFSowView.leavePhone();
        app.setView('map');
      }
      host.ready();
    };
    app.on('plan', ready);
    ready();
  };
  script.onerror = host.failed;
  window.addEventListener('error', () => { if (!window.LRFApp?.state.ready) host.failed(); });
  document.body.append(script);
}

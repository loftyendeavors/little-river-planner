"""Step 3a (preview 0.22) in a real browser: where a crop's days start, and the review of figures kept on plantings.

usage: python3 -I step3a_check.py <app-dir-or-built-site-dir> <shots-dir> [backup.zip]
       DARK=1 for a dark page; WIDTH=1480 for the wider window (default 1280).
       The app folder opens the plan it ships with. A built site ships none: give it a backup to load.

Everything expected is worked out in the page from the plan that is open, so the check holds for whatever plan ships.
The rules under test:
  - the list says, for every crop, where its days start; a crop sown in place or planted as a bulb has no choice;
  - a row's numbers count from there, and the "from seed" column shows nursery + bed = from seed;
  - nothing moves until a starting point is set; setting one is one step, said in a toast, taken back by one undo;
  - a published starting point is offered only where it would change how the crop is counted; all of them at once ask first;
  - the review window opens in place, closes with ×, Escape and Cancel without doing anything, shows what would move
    before anything does, and its suggested step moves no date;
  - applying keeps the plan as it stood as a snapshot first, is one step, and one undo takes it back;
  - recorded work and tray batches are never offered; a label is never clipped.
"""
import functools, http.server, json, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

target, shots = sys.argv[1], sys.argv[2]
BACKUP = sys.argv[3] if len(sys.argv) > 3 else None
DARK, WIDTH = os.environ.get('DARK') == '1', int(os.environ.get('WIDTH', '1280'))
os.makedirs(shots, exist_ok=True)
results, failed = [], []


def check(name, ok, detail=None):
    results.append(('ok   ' if ok else 'FAIL ') + name + ('' if ok or detail is None else ' ' + json.dumps(detail, default=str)[:900]))
    if not ok:
        failed.append(name)
    if os.environ.get('LIVE') == '1':
        print(results[-1], flush=True)
    if not ok and os.environ.get('STOP_AT_FAIL') == '1' and name not in json.loads(os.environ.get('GO_ON_AT') or '[]'):   # GO_ON_AT: lines that fail with no fault put in, which are no reason to stop before the lines a fault is meant for
        print('\n'.join(results)); print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}), flush=True)
        os._exit(0)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=target))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/index.html' % server.server_address[1]

# The dates every planting stands on, to compare before and after a step.
DATES = "(() => { const e = LRFApp.state.engine, d = x => x ? LRFEngine.d2s(x) : ''; return Object.fromEntries(LRFApp.state.plan.plantings.map(p => { const r = e.calc(p); return [p.id, r ? [d(r.sow), d(r.first), d(r.last)].join('/') : '']; })); })()"
# A transplanted planting in a soil bed on supplier days whose variety does not say where they start (see the Node test).
SUBJECT = """(() => { const e = LRFApp.state.engine;
  for (const p of LRFApp.state.plan.plantings) { if (e.pinned(p) || p.done) continue; const x = e.effective(p), b = e.bedOf(p.bedId), v = e.variety(p.varietyId), t = x && x.catalogTiming;
    if (x && b && e.isSoilBed(b) && x.method === 'TP' && x.gh > 0 && v && !e.STARTS.includes(v.catalogMaturityBasis) && t && t.activeMode === 'catalog' && !t.inferredBasis && !e.startFixed(e.crop(p.cropId)) && t.printed - Math.round(x.gh * 7) > 15)
      return { id: p.id, cropId: p.cropId, crop: e.crop(p.cropId).name, varietyId: v.id, variety: v.name, env: e.envOf(b), printed: t.printed, nursery: Math.round(x.gh * 7), days: x.dtm }; }
  return null; })()"""
CLIPPED = """(() => { const bad = [];
  for (const el of document.querySelectorAll('#assumeView th, #assumeView tr.as-crop .as-name b, #assumeView .as-hint, #assumeView .as-fixed, #asAudit b, #asAudit i, #asHints b, #asHints .btn, #asReview, .as-seed, .as-use, #auditDlg th, #auditDlg .btn, #auditDlg .au-effect, #auditDlg td.au-n, #auditDlg .au-where')) {
    if (!el.getClientRects().length) continue; if (el.scrollWidth > el.clientWidth + 1) bad.push([el.className || el.tagName, el.textContent.slice(0, 40), el.scrollWidth, el.clientWidth]); }
  for (const el of document.querySelectorAll('#assumeView select.as-from, #auditDlg select')) { if (!el.getClientRects().length) continue; const o = el.selectedOptions[0], c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(el); c.font = cs.font;
    if (o && c.measureText(o.textContent).width + 26 > el.getBoundingClientRect().width + 1) bad.push(['select', o.textContent, Math.round(c.measureText(o.textContent).width), Math.round(el.getBoundingClientRect().width)]); }
  // nothing may spill out of its own cell into the next column
  for (const el of document.querySelectorAll('#asBody .as-nc, #asBody .as-startbox, #asBody .as-start select, #asBody .as-less, #asBody .as-less input, #asBody .as-cell input, #asBody .as-seed b')) { if (!el.getClientRects().length) continue; const td = el.closest('td').getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.right > td.right + 0.6 || r.left < td.left - 0.6) bad.push(['spills', (el.textContent || el.value || el.className).slice(0, 40), Math.round(r.right), Math.round(td.right)]); }
  const view = document.getElementById('assumeView'), table = document.querySelector('table.as'), wrap = document.querySelector('.view-assume .as-wrap');
  // one fault is known and written down (tests/known-faults.json): “Seeding in trays” is wider than its “Days counted from” box. It is
  // counted apart, under `trays`, so that the line it fails is its own and nothing else clipped can hide behind it.
  const trays = bad.filter(b => b[0] === 'select' && b[1] === 'Seeding in trays').length, rest = bad.filter(b => !(b[0] === 'select' && b[1] === 'Seeding in trays'));
  return { bad: rest.slice(0, 6), count: rest.length, trays, sideways: view.scrollWidth > view.clientWidth + 1, tableWider: table.getBoundingClientRect().right > wrap.getBoundingClientRect().right - parseFloat(getComputedStyle(wrap).paddingRight) + 1 }; })()"""

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': WIDTH, 'height': 860}, color_scheme='dark' if DARK else 'light', service_workers='block')
    page = ctx.new_page()
    if BACKUP:
        page.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1') else r.abort())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    ev = page.evaluate

    def ready():
        page.wait_for_function('window.LRFApp && LRFApp.state.ready', timeout=90000)
        if BACKUP and page.evaluate('LRFApp.isSample()'):
            page.set_input_files('#importFile', BACKUP)
            page.wait_for_function("!LRFApp.isSample() && LRFThumbs.count() > 100", timeout=240000)
            page.evaluate('document.fonts.ready'); page.wait_for_timeout(1500)
            # loading a backup is itself undoable history in some builds: start each part from a clean slate
            page.evaluate("LRFApp.state.undo.length = 0; LRFApp.state.redo.length = 0; document.getElementById('toast').classList.remove('show')")
        page.wait_for_function('!LRFApp.isSample()', timeout=90000)

    def settle(ms=350):
        page.wait_for_timeout(ms)

    def toast():
        return ev("document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : ''")

    def asking():
        return ev("(() => { const d = [...document.querySelectorAll('dialog.dialog[open]')].find(x => x.id !== 'auditDlg'); return d ? { title: d.querySelector('h2').textContent, body: d.querySelector('p').textContent, moves: d.querySelectorAll('#assumeMoves li').length } : null; })()")

    def answer(yes):
        page.click("dialog.dialog[open]:not(#auditDlg) .dialog-actions .btn%s" % ('.primary' if yes else ':not(.primary)'))
        settle()

    def pick(selector, value):
        """Choose in a select as a person would; answer yes if the planner asks first."""
        page.select_option(selector, value)
        settle()
        if asking():
            answer(True)

    def undo():
        ev("LRFApp.undo()")
        settle()

    def shot(name):
        page.screenshot(path=os.path.join(shots, '%s-%d-%s.png' % (name, WIDTH, 'dark' if DARK else 'light')))

    page.goto(url)
    ready()
    ev("LRFApp.setView('assume')")
    settle(900)
    key0 = ev("LRFApp.contentKey()")
    dates0 = ev(DATES)

    # ── the list ──
    head = ev("[...document.querySelectorAll('table.as thead th')].map(t => t.textContent)")
    check('the list has a "Days start at" column and a "From seed" column', 'Days counted from' in head and 'From seed' in head and len(head) == 8, head)
    rows = ev("""(() => { const e = LRFApp.state.engine; return [...document.querySelectorAll('#asBody tr.as-crop')].map(tr => { const c = e.crop(tr.dataset.crop), s = tr.querySelector('select.as-from'), seed = tr.querySelector('.as-seed').textContent, m = /^(\\d+) \\+ (\\d+) = (\\d+)$/.exec(seed);
      const main = m && e.ENVS.map(env => e.timingFor(c.id, null, env)).some(t => t.source !== 'none' && t.nursery === +m[1] && t.bed === +m[2] && t.total === +m[3]);
      return { name: c.name, fixed: e.startFixed(c), select: !!s, value: s && s.value, mine: !!(s && s.classList.contains('mine')), options: s ? [...s.options].map(o => o.value) : null, word: (tr.querySelector('.as-start .as-fixed') || {}).textContent || '', seed, sum: m ? +m[1] + +m[2] === +m[3] : null, main, method: c.method, hint: !!tr.querySelector('.as-hint'), offered: (() => { const h = e.startHint(c.id); return !!h; })() }; }); })()""")
    check('%d crops listed; each with a choice has it, each without shows a word instead' % len(rows), len(rows) > 20 and all((r['fixed'] is None) == r['select'] and (r['select'] or r['word'] in ('direct seeding', 'seeding in trays', 'planting')) for r in rows), [r for r in rows if (r['fixed'] is None) != r['select']][:3])
    check('with nothing set every choice reads "Transplanting", none is marked as yours, and the three starts are offered', all(r['value'] == 'transplant' and not r['mine'] and r['options'] == ['transplant', 'seed', 'direct'] for r in rows if r['select']), [r for r in rows if r['select'] and r['value'] != 'transplant'][:3])
    seeded = [r for r in rows if r['seed']]
    check('"from seed" is nursery + bed = total, from the engine’s own figures, on %d transplanted rows and on no other' % len(seeded), len(seeded) > 8 and all(r['sum'] and r['main'] and r['select'] for r in seeded) and all(r['seed'] for r in rows if r['select']), [r for r in seeded if not (r['sum'] and r['main'])][:3])
    check('a published start is offered only on rows that have one and a choice', all(r['offered'] and r['select'] for r in rows if r['hint']) and any(r['hint'] for r in rows), [r['name'] for r in rows if r['hint'] and not r['offered']])
    wanted = ev("""(() => { const e = LRFApp.state.engine, out = { idle: [], missing: [] }; for (const tr of document.querySelectorAll('#asBody tr.as-crop')) { const c = e.crop(tr.dataset.crop), h = e.startHint(c.id); if (!h || e.startRule(c.id).set) continue;
      const guess = e.varietiesOf(c.id).some(v => e.ENVS.some(env => e.timingFor(c.id, v.id, env).startBy === 'guess')), changes = h.from !== 'transplant' || guess, chip = !!tr.querySelector('.as-hint');
      if (chip && !changes) out.idle.push(c.name); if (!chip && changes) out.missing.push(c.name); } return out; })()""")
    check('and only where taking it would change how the crop is counted', not wanted['idle'] and not wanted['missing'], wanted)
    fit = ev(CLIPPED)
    check('nothing in the list is clipped, and it does not scroll sideways at %d' % WIDTH, fit['count'] == 0 and fit['trays'] == 0 and not fit['sideways'] and not fit['tableWider'], fit)
    shot('list')

    subj = ev(SUBJECT)
    check('the plan has a planting to try a starting point on', subj is not None)
    if subj:
        sel = '#asBody select[data-start="%s"]' % subj['cropId']
        days = "LRFApp.state.engine.effective(LRFApp.state.engine.planting('%s')).dtm" % subj['id']
        undo0 = ev("LRFApp.state.undo.length")
        pick(sel, 'seed')
        after = ev("({ days: %s, starts: (LRFApp.state.plan.assumptions || {}).starts || null, mine: document.querySelector('%s').classList.contains('mine'), count: document.getElementById('asCount').textContent, undo: LRFApp.state.undo.length })" % (days, sel.replace("'", "\\'")))
        check('set to Sowing: the nursery time comes off (%s: %d - %d)' % (subj['crop'], subj['printed'], subj['nursery']), after['days'] == subj['printed'] - subj['nursery'] and after['starts'] == {subj['cropId']: {'from': 'seed'}}, after)
        check('it is marked as yours, counted under the table, said in a toast with Undo, and is one step', after['mine'] and '“Days counted from” set for 1 crop' in after['count'] and 'days counted from seeding in trays' in toast() and 'Undo' in toast() and after['undo'] == undo0 + 1, [after, toast()])
        opts = ev("[...document.querySelector('%s').options].map(o => o.textContent)" % sel.replace("'", "\\'"))
        check('once set, the row can be put back to not set', opts[-1] == 'Back to not set' and len(opts) == 4, opts)
        pick(sel, 'direct')
        less = '#asBody input[data-less="%s"]' % subj['cropId']
        d = ev("({ days: %s, less: (() => { const el = document.querySelector('%s'); return el ? { value: el.value, placeholder: el.placeholder } : null; })() })" % (days, less.replace("'", "\\'")))
        check('set to Direct seeding: 14 days come off, and the 14 is there to change', d['days'] == subj['printed'] - 14 and d['less'] == {'value': '', 'placeholder': '14'}, d)
        fit_direct = ev(CLIPPED)
        check('with the days-less box showing, nothing is clipped or spills into the next column', fit_direct['count'] == 0 and fit_direct['trays'] == 0 and not fit_direct['sideways'], fit_direct)
        shot('direct')
        page.fill(less, '10'); page.press(less, 'Tab'); settle()
        if asking(): answer(True)
        d10 = ev("({ days: %s, starts: LRFApp.state.plan.assumptions.starts })" % days)
        check('typing 10 there: 10 days come off', d10['days'] == subj['printed'] - 10 and d10['starts'][subj['cropId']] == {'from': 'direct', 'less': 10}, d10)
        page.fill(less, ''); page.press(less, 'Tab'); settle()
        if asking(): answer(True)
        check('clearing it goes back to 14', ev(days) == subj['printed'] - 14 and ev("LRFApp.state.plan.assumptions.starts['%s']" % subj['cropId']) == {'from': 'direct'})
        # the variety's own word
        pick(sel, 'seed')
        ev("document.querySelector('#asBody tr.as-crop[data-crop=\"%s\"] .as-more').click()" % subj['cropId']); settle()
        vsel = '#asBody select[data-vstart="%s"]' % subj['varietyId']
        vopts = ev("(() => { const s = document.querySelector('%s'); return s ? { value: s.value, options: [...s.options].map(o => o.textContent) } : null; })()" % vsel.replace("'", "\\'"))
        check('a variety row reads "As the crop" until it says otherwise', vopts is not None and vopts['value'] == 'unspecified' and vopts['options'] == ['As the crop', 'Transplanting', 'Seeding in trays', 'Direct seeding'], vopts)
        pick(vsel, 'transplant')
        check('a variety set to Transplanting keeps its printed days under a crop set to Sowing', ev(days) == subj['printed'] and ev("LRFApp.state.engine.variety('%s').catalogMaturityBasis" % subj['varietyId']) == 'transplant', ev(days))
        undo()
        check('one undo puts the variety back', ev(days) == subj['printed'] - subj['nursery'])
        # a number of the grower's own, in a row whose days start at sowing
        cellsel = '#asBody input[data-key="varieties|%s|%s"]' % (subj['varietyId'], subj['env'])
        typed = subj['nursery'] + 33
        page.fill(cellsel, str(typed)); page.press(cellsel, 'Tab'); settle()
        if asking(): answer(True)
        t = ev("(() => { const t = LRFApp.state.engine.timingFor('%s', '%s', '%s'), el = document.querySelector('%s'), row = el.closest('tr'); return { days: %s, mine: t.mine, bed: t.bed, total: t.total, title: el.title, seed: row.querySelector('.as-seed').textContent }; })()" % (subj['cropId'], subj['varietyId'], subj['env'], cellsel.replace("'", "\\'"), days))
        check('a number of your own in that row counts from sowing too: %d typed, 33 in the bed' % typed, t['days'] == 33 and t['mine'] == typed and t['bed'] == 33 and 'in the bed' in t['title'], t)
        insp = ev("(async () => { LRFApp.setView('map'); LRFApp.select({ type: 'planting', id: '%s' }); await new Promise(r => setTimeout(r, 500)); const help = [...document.querySelectorAll('.insp-section.form .help')].map(x => x.textContent).join(' '); LRFApp.select(null); LRFApp.setView('assume'); return help; })()" % subj['id'])
        settle(500)
        check('the planting says it follows the list, and what came off', 'From your assumptions list' in insp and ('%d days from sowing, less %d' % (typed, subj['nursery'])) in insp, insp)
        # back to where it started
        while ev("LRFApp.state.undo.length") > undo0:
            undo()
        check('undone step by step, the plan is exactly as it was', ev("LRFApp.contentKey()") == key0 and ev(DATES) == dates0)

    # ── published starting points ──
    offers = ev("""(() => { const e = LRFApp.state.engine; return { chips: [...document.querySelectorAll('#asBody .as-hint')].map(b => ({ id: b.dataset.hint, text: b.textContent, from: e.startHint(b.dataset.hint).from })), strip: !document.getElementById('asHints').hidden, text: document.getElementById('asHints').textContent, button: !!document.getElementById('asHintsAll') }; })()""")
    check('each offer names the guide and the start it gives', len(offers['chips']) > 0 and all(c['text'] == 'Johnny’s: ' + {'seed': 'seeding in trays', 'direct': 'direct seeding', 'transplant': 'transplanting'}[c['from']] for c in offers['chips']), offers['chips'][:4])
    if offers['chips']:
        one = next((c for c in offers['chips'] if c['from'] != 'transplant'), offers['chips'][0])
        page.click('#asBody .as-hint[data-hint="%s"]' % one['id']); settle()
        if asking(): answer(True)
        got = ev("({ rule: LRFApp.state.engine.startRule('%s'), chip: !!document.querySelector('#asBody .as-hint[data-hint=\"%s\"]'), value: document.querySelector('#asBody select[data-start=\"%s\"]').value })" % (one['id'], one['id'], one['id']))
        check('pressing an offer sets that crop’s start, and the offer is gone', got['rule']['set'] and got['rule']['from'] == one['from'] and not got['chip'] and got['value'] == one['from'], got)
        undo()
        check('undo brings the offer back', ev("!!document.querySelector('#asBody .as-hint[data-hint=\"%s\"]')" % one['id']) and ev("LRFApp.contentKey()") == key0)
    if offers['button']:
        n = ev("document.querySelectorAll('#asBody .as-hint').length")
        check('above the table: how many of your crops have one, and one button for all', offers['strip'] and ('%d crop' % n) in offers['text'], offers['text'][:120])
        undo1 = ev("LRFApp.state.undo.length")
        page.click('#asHintsAll'); settle(900)
        ask = asking()
        moves = ev("(() => { const before = LRFApp.state.engine; return true; })()")
        check('taking them all asks first, with what moves, crop by crop', ask is not None and 'planting' in ask['body'] and ask['moves'] > 0, ask)
        shot('offers-ask')
        if ask:
            answer(False)
            check('Cancel: nothing changed', ev("LRFApp.contentKey()") == key0 and ev("LRFApp.state.undo.length") == undo1)
            page.click('#asHintsAll'); settle(900); answer(True)
            took = ev("""(() => { const e = LRFApp.state.engine, s = LRFApp.state.plan.assumptions.starts || {}; return { set: Object.keys(s).length, right: Object.keys(s).every(id => { const h = LRFGuide.startFor(e.crop(id)); return h && h.from === s[id].from; }), chips: document.querySelectorAll('#asBody .as-hint').length, strip: document.getElementById('asHints').hidden, undo: LRFApp.state.undo.length, guesses: document.querySelectorAll('.as-guess').length }; })()""")
            check('Apply: every offered crop is set as the guide says, in one step, and no offer is left', took['set'] == n and took['right'] and took['chips'] == 0 and took['strip'] and took['undo'] == undo1 + 1, took)
            shot('offers-taken')
            undo()
            check('one undo takes them all back', ev("LRFApp.contentKey()") == key0 and ev(DATES) == dates0)

    # ── the summary above the table ──
    sv = ev("LRFApp.auditSurvey()")
    note = ev("({ figs: [...document.querySelectorAll('#asAudit .au-figs span')].map(s => [s.querySelector('i').textContent, s.querySelector('b').textContent.replace(/,/g, '')]), line: document.getElementById('asAuditLine').textContent, review: !document.getElementById('asReview').disabled })")
    want = [['own days', str(sv['days']['own'])], ['own nursery weeks', str(sv['nursery']['differ'])]] + ([['to place', str(sv['days']['waiting'])]] if sv['days']['waiting'] else []) + [['tray batches', str(sv['trays'])]]
    check('the summary’s figures are the audit’s: %s' % ', '.join(' '.join(x) for x in want), all(x in note['figs'] for x in want) and note['review'] == (sv['days']['own'] + sv['days']['waiting'] + sv['nursery']['differ'] + sv['harvest']['yield'] + sv['harvest']['window'] + sv['harvest']['turnover'] + sv['harvest']['copy'] > 0), note)
    own_cells = ev("[...document.querySelectorAll('#asBody tr.as-crop .as-use span')].reduce((n, s) => n + +(/(\\d+) own/.exec(s.textContent) || [0, 0])[1], 0)")
    listed = ev("(() => { const e = LRFApp.state.engine, shown = new Set([...document.querySelectorAll('#asBody tr.as-crop')].map(t => t.dataset.crop)); return LRFApp.state.plan.plantings.filter(p => e.pinned(p) && !p.liveTray && shown.has(p.cropId)).length; })()")
    check('each crop row counts its plantings that keep their own days, tray batches left out', own_cells == listed, [own_cells, listed])

    # ── the review window ──
    if sv['days']['own'] + sv['nursery']['differ'] > 0:
        study = ev("(() => { const s = LRFApp.auditStudy(); return { rows: s.rows.map(r => ({ key: r.key, kind: r.kind, choice: r.choice, n: r.ids.length, take: !!r.take, agrees: r.agrees })), held: s.held }; })()")
        ev("document.getElementById('toast').classList.remove('show')")
        for way in ('auClose', 'Escape', 'auCancel'):
            page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); page.wait_for_selector('#auditDlg[open]'); settle(600)
            if way == 'Escape':
                page.keyboard.press('Escape')
            else:
                page.click('#' + way)
            settle()
            check('the review window closed with %s: nothing done' % ('Escape' if way == 'Escape' else 'the ×' if way == 'auClose' else 'Cancel'), ev("!document.getElementById('auditDlg') && LRFApp.contentKey()") == key0 and ev("LRFApp.state.undo.length") == 0 and toast() == '')
        page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); page.wait_for_selector('#auditDlg[open]'); settle(600)
        dlg = ev("""(() => { const d = document.getElementById('auditDlg'), r = d.getBoundingClientRect(); return { rows: [...d.querySelectorAll('tr.au-row')].map(tr => ({ key: tr.dataset.key, value: tr.querySelector('select').value, effect: tr.querySelector('.au-effect').textContent, options: [...tr.querySelector('select').options].map(o => o.value) })), head: document.getElementById('auHead').textContent, figs: [...document.querySelectorAll('#auFigs b')].map(b => +b.textContent.replace(/,/g, '')), apply: !document.getElementById('auApply').disabled, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, micro: [...d.querySelectorAll('.au-name b')].some(b => /^micro/i.test(b.textContent)), view: LRFApp.state.view }; })()""")
        check('it opens in place over the list, inside the window, one row for each group (%d)' % len(study['rows']), dlg['view'] == 'assume' and dlg['inside'] and [r['key'] for r in dlg['rows']] == [r['key'] for r in study['rows']], [len(dlg['rows']), len(study['rows']), dlg['inside']])
        check('each row opens on the suggested choice, and offers "take" only where the list can take the number', all(d['value'] == s['choice'] and ('take' in d['options']) == s['take'] for d, s in zip(dlg['rows'], study['rows'])))
        check('no tray batch is offered', not dlg['micro'])
        pv = ev("(() => { const s = LRFApp.auditStudy(), v = LRFApp.auditPreview(s.rows, {}); return { n: v.step.plantings, taken: v.step.taken, harvest: v.harvest, sowing: v.sowing, fresh: v.fresh.length, kept: v.step.kept }; })()")
        check('the summary says what the suggested step does: %d plantings, %d list lines, no date moved' % (pv['n'], pv['taken']), dlg['figs'][:4] == [pv['taken'], pv['harvest'], pv['sowing'], pv['fresh']] and ('%d planting' % pv['n']) in dlg['head'].replace(',', '') and pv['harvest'] == 0 and pv['sowing'] == 0 and pv['fresh'] == 0 and dlg['apply'], [dlg['head'], dlg['figs'], pv])
        check('every row it would let go says no date moves', all('no date moves' in d['effect'] for d, s in zip(dlg['rows'], study['rows']) if s['choice'] != 'keep' and s['kind'] in ('days', 'weeks')) and all('nothing changes' in d['effect'] for d, s in zip(dlg['rows'], study['rows']) if s['choice'] != 'keep' and s['kind'] in ('yield', 'window', 'turn', 'copy')) and all(d['effect'] == 'stays as it is' for d, s in zip(dlg['rows'], study['rows']) if s['choice'] == 'keep'), [d['effect'] for d in dlg['rows']][:6])
        fit = ev(CLIPPED)
        check('nothing in the window is clipped', fit['count'] == 0, fit)
        check('“Seeding in trays” fits its “Days counted from” box', fit['trays'] == 0, fit)
        shot('review')
        mover = next((s for s in study['rows'] if s['kind'] == 'days' and s['take']), None)
        if mover:
            page.select_option('#auditDlg select[data-row="%s"]' % mover['key'], 'follow'); settle(700)
            m = ev("({ effect: document.querySelector('#auditDlg tr.au-row[data-key=\"%s\"] .au-effect').textContent, cls: document.querySelector('#auditDlg tr.au-row[data-key=\"%s\"] .au-effect').classList.contains('moves'), figs: [...document.querySelectorAll('#auFigs b')].map(b => +b.textContent.replace(/,/g, '')), head: document.getElementById('auHead').textContent })" % (mover['key'], mover['key']))
            check('a group made to use the list’s number instead: the row and the summary say what moves, before anything does', 'harvest' in m['effect'] and ('later' in m['effect'] or 'sooner' in m['effect']) and m['cls'] and m['figs'][1] == mover['n'] and m['figs'][0] == pv['taken'] - 1 and ev("LRFApp.contentKey()") == key0, m)
            shot('review-moves')
        page.click('#auKeepAll'); settle(600)
        k = ev("({ head: document.getElementById('auHead').textContent, apply: document.getElementById('auApply').disabled, values: [...document.querySelectorAll('#auditDlg select[data-row]')].map(s => s.value) })")
        check('"Keep all": nothing will change and there is nothing to apply', k['head'] == 'Nothing will change' and k['apply'] and all(v == 'keep' for v in k['values']), k['head'])
        page.click('#auSuggested'); settle(600)
        check('"Suggested" puts every row back', ev("[...document.querySelectorAll('#auditDlg select[data-row]')].map(s => s.value)") == [s['choice'] for s in study['rows']] and ev("document.getElementById('auHead').textContent") == dlg['head'])
        snaps0 = ev("(async () => (await LRFApp.snapshots()).rows.length)()") if ev("LRFApp.snapshotsKept()") else None
        page.click('#auApply'); settle(1800)
        done = ev("""(async () => { const A = LRFApp, e = A.state.engine, s = A.snapshotsKept() ? (await A.snapshots()).rows : null; return { open: !!document.getElementById('auditDlg'), undo: A.state.undo.length, label: A.state.undo.length ? A.state.undo[A.state.undo.length - 1].label : '', own: A.auditSurvey().days.own, snap: s ? s.map(x => ({ name: x.name, auto: x.auto, key: x.key })) : null, lines: (() => { const a = A.state.plan.assumptions || {}; return Object.values(a.crops || {}).concat(Object.values(a.varieties || {})).reduce((n, r) => n + Object.values(r).reduce((m, cell) => m + Object.keys(cell).length, 0), 0) + Object.values(a.sell || {}).reduce((n, r) => n + Object.keys(r).length, 0); })() }; })()""")
        check('Apply: the window closes and it is one step in the undo list', not done['open'] and done['undo'] == 1 and ('%d planting' % pv['n']) in done['label'], done)
        check('said in a toast with Undo: how many follow the list, and that no date moved', ('%d planting' % pv['n']) in toast().replace(',', '') and 'no date moved' in toast() and 'Undo' in toast(), toast())
        check('no planting in the whole plan stands on another day than before', ev(DATES) == dates0)
        released = sum(s['n'] for s in study['rows'] if s['kind'] == 'days' and s['choice'] != 'keep')
        check('%d plantings now follow the list, %d numbers are on it, and the summary counts only the ones kept' % (released, done['lines']), done['own'] == sv['days']['own'] - released and done['lines'] == pv['taken'] and ev("document.querySelector('#asAudit .au-figs b').textContent.replace(/,/g, '')") == str(done['own']), done)
        if done['snap'] is not None:
            named = [x for x in done['snap'] if x['name'] == 'Before plantings followed the list']
            check('the plan as it stood was kept first, as a named snapshot', len(named) == 1 and not named[0]['auto'] and named[0]['key'] == key0 and len(done['snap']) > snaps0, done['snap'][:3])
        shot('after')
        some = ev("(() => { const A = LRFApp, e = A.state.engine, a = A.state.plan.assumptions, id = Object.keys(a.crops || {})[0] || null; const p = A.state.plan.plantings.find(p => !e.pinned(p) && e.effective(p) && e.effective(p).assumed); return p ? { id: p.id, level: e.effective(p).assumed.level } : null; })()")
        if some:
            insp = ev("(async () => { LRFApp.setView('map'); LRFApp.select({ type: 'planting', id: '%s' }); await new Promise(r => setTimeout(r, 500)); const help = [...document.querySelectorAll('.insp-section.form .help')].map(x => x.textContent).join(' '), dtm = document.getElementById('fDtm').value; LRFApp.select(null); LRFApp.setView('assume'); return { help, dtm }; })()" % some['id'])
            settle(500)
            check('a planting let go has an empty days field and says it follows the list', insp['dtm'] == '' and 'From your assumptions list' in insp['help'], insp)
        undo()
        check('one undo takes it all back, exactly', ev("LRFApp.contentKey()") == key0 and ev(DATES) == dates0 and ev("LRFApp.auditSurvey().days.own") == sv['days']['own'])
        ev("LRFApp.redo()"); settle()
        check('and redo does it again', ev("LRFApp.auditSurvey().days.own") == done['own'] and ev(DATES) == dates0)
        page.wait_for_timeout(1500)
        page.reload(); ready(); ev("LRFApp.setView('assume')"); settle(900)
        check('after a reload the plantings still follow the list', ev("LRFApp.auditSurvey().days.own") == done['own'] and ev(DATES) == dates0)
        # put the plan back as it was for the checks that follow
        ev("""(() => { const A = LRFApp, s = A.auditStudy(); return true; })()""")
        back = ev("(async () => { const A = LRFApp, s = (await A.snapshots()).rows.find(x => x.name === 'Before plantings followed the list'); return !!s; })()") if done['snap'] is not None else False
        check('the snapshot is still there after the reload', back or done['snap'] is None)

        # recorded work, and a waiting planting: on a fresh page with the plan as shipped
        ev("(async () => { localStorage.clear(); for (const db of await indexedDB.databases()) indexedDB.deleteDatabase(db.name); })()")
        page.wait_for_timeout(600); page.reload(); ready(); ev("LRFApp.setView('assume')"); settle(900)
        check('(a fresh page opens the plan as shipped)', ev("LRFApp.contentKey()") == key0)
        first = ev("(() => { const s = LRFApp.auditStudy(), r = s.rows.find(x => x.kind === 'days' && x.choice !== 'keep'), k = s.rows.find(x => x.kind === 'days' && x.choice === 'keep'); return { id: r.ids[0], key: r.key, n: r.ids.length, kept: k ? k.ids[0] : null }; })()")
        ev("""(() => { const A = LRFApp, e = A.state.engine, p = e.planting('%s'), w = { ...p, id: 'w-check', wait: {} }; delete w.bedId;
          A.commit('test: one sowing recorded, one planting waiting', [{ before: p, after: { ...p, done: { sow: '2027-01-04' } } }, { kind: 'own', key: 'waiting', before: (A.state.plan.lrfNext || {}).waiting || null, after: [w] }], { unchecked: true }); })()""" % first['id'])
        settle(700)
        page.evaluate("LRFAssume.auditView({ by: 'kind', all: true })"); page.click('#asReview'); page.wait_for_selector('#auditDlg[open]'); settle(700)
        rec = ev("""(() => { const d = document.getElementById('auditDlg'), s = LRFApp.auditStudy(), row = s.rows.find(r => r.key === '%s'); return { inRow: s.rows.some(r => r.ids.includes('%s')), n: row ? row.ids.length : 0, held: s.held, fine: (d.querySelector('.au-sum .au-fine') || {}).textContent || '', wait: [...d.querySelectorAll('tr.au-row[data-kind="wait"]')].map(tr => ({ where: tr.querySelector('.au-where').textContent, value: tr.querySelector('select').value, effect: tr.querySelector('.au-effect').textContent })), sec: [...d.querySelectorAll('tr.au-sec b')].map(b => b.textContent), note: [...document.querySelectorAll('#asAudit .au-figs i')].map(i => i.textContent) }; })()""" % (first['key'], first['id']))
        check('a planting with a sowing recorded is offered in no row, and the window says it is left alone', not rec['inRow'] and rec['n'] == first['n'] - 1 and rec['held'] == 1 and '1 planting with recorded work is left as it is' in rec['fine'], rec)
        check('a waiting planting that carries its own days has a row under "To place"', 'To place' in rec['sec'] and len(rec['wait']) == 1 and len(rec['wait']) > 0 and rec['wait'][0]['where'] == 'To place' and rec['wait'][0]['value'] == 'follow' and 'no bed yet' in rec['wait'][0]['effect'] and 'to place' in rec['note'], rec)
        page.click('#auApply'); settle(1800)
        fin = ev("(() => { const A = LRFApp, e = A.state.engine, w = A.waiting().find(x => x.id === 'w-check'), p = e.planting('%s'); return { w: w ? { dtm: w.dtm || null, mode: w.timingMode || null } : null, rec: { dtm: p.dtm || null, done: p.done }, waiting: A.auditSurvey().days.waiting, recorded: A.auditSurvey().days.recorded }; })()" % first['id'])
        check('applied: the waiting planting has let its days go; the recorded one has kept its own', fin['w'] == {'dtm': None, 'mode': None} and fin['rec']['dtm'] and fin['rec']['done'] == {'sow': '2027-01-04'} and fin['waiting'] == 0 and fin['recorded'] == 1, fin)
    else:
        check('(nothing to review in this plan)', True)

    # ── the Seeds list knows the third starting point ──
    ev("LRFApp.setView('seeds')"); settle(1200)
    seeds = ev("(() => { const s = document.querySelector('#sdBody td.sd-from select'); return s ? [...s.options].map(o => o.value) : null; })()")
    check('in Seeds a variety’s days can start at direct seeding too', seeds is None or seeds == ['unspecified', 'seed', 'direct', 'transplant'], seeds)
    check('no error on the page', not errors, errors[:3])
    browser.close()

print('\n'.join(results))
print(json.dumps({'passed': len(results) - len(failed), 'of': len(results), 'failed': failed}))

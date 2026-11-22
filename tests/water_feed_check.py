"""Exercise first setup, the phone refill card and the irrigation dashboard on the made-up farm."""
import functools
import http.server
import json
import sys
import threading
from playwright.sync_api import sync_playwright

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=sys.argv[1]))
threading.Thread(target=server.serve_forever, daemon=True).start()
passed, failed = [], []
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1480, 'height': 900}, timezone_id='UTC')
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.LRFApp?.state.ready')
        def press(label):
            page.get_by_role('button', name=label, exact=True).first.click()
        def fill(label, value):
            page.get_by_label(label, exact=True).fill(value)
        def check(label, result):
            (passed if result else failed).append(label)
        def check_current_words(tab):
            wording = page.locator('#wfWrap').evaluate('''pane => [
                pane.innerText, ...Array.from(pane.querySelectorAll('[aria-label], [title], [placeholder]'),
                    el => ['aria-label', 'title', 'placeholder'].map(key => el.getAttribute(key) || '').join(' '))
            ].join(' ').toLowerCase()''')
            check(tab + ' uses current planner wording', all(term not in wording for term in ('v7', 'old planner', 'rebuild preview')))
        press('Water')
        check_current_words('Fertility')
        gardens = page.get_by_label('Garden', exact=True)
        check('First use asks for a garden without repeating an empty equipment row per garden',
              gardens.is_visible() and page.get_by_role('button', name='Add tank', exact=True).count() == 0
              and 'Choose a garden' in page.locator('#wfWrap').inner_text())
        gardens.select_option(index=1)
        press('Record field application')
        fill('Product name', 'Test feed')
        fill('Bag weight (lb)', '20')
        fill('N on label (%)', '10')
        press('Save product')
        year = page.evaluate('LRFApp.planYear()')
        page.clock.set_fixed_time(f'{year}-06-12T14:00:00Z')
        fill('Applied at', f'{year}-06-12T08:00')
        fill('Fresh product applied (lb)', '5')
        press('Record application')
        check('First product returns to the dry application and the garden shows the label-basis nutrients',
              '0.5 lb' in page.get_by_role('row', name='Field applied', exact=False).inner_text())
        press('Add tank')
        fill('Recipe name', 'Test stock')
        fill('Final stock volume (gal)', '5')
        fill('Test feed (lb per batch)', '4')
        press('Save recipe')
        fill('Tank name', 'Test tank')
        fill('Tank batch size (gal)', '5')
        press('Save equipment')
        check('The garden kept its equipment through first product and recipe setup',
              page.get_by_text('Test tank', exact=True).first.is_visible())
        press('Request refill')
        press('Add reminder')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.get_by_role('button', name='Refilled as shown', exact=True).wait_for()
        check('The phone names tank, prepared recipe and batch size before completion',
              all(t in page.locator('#swWrap').inner_text() for t in ('Test tank', '4 lb Test feed', '5 gal batch')))
        press('Refilled as shown')
        check('One tap records one refill and shows nothing due',
              page.get_by_text('Nothing due', exact=True).is_visible()
              and page.evaluate("LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'refill').length") == 1)
        page.set_viewport_size({'width': 1480, 'height': 900})
        press('Water')
        check('Applied nutrients and mixed nutrients occupy separate rows',
              '0.4 lb' in page.get_by_role('row', name='Mixed into tanks', exact=False).inner_text()
              and '0.5 lb' in page.get_by_role('row', name='Field applied', exact=False).inner_text())
        press('Irrigation')
        check_current_words('Irrigation')
        press('Add zone')
        fill('Zone name', 'Test zone')
        press('Save equipment')
        press('Record run')
        fill('Actual minutes', '8')
        fill('Planned minutes (optional)', '20')
        page.get_by_label('Run status', exact=True).select_option('Interrupted')
        page.get_by_role('dialog').get_by_role('button', name='Record run', exact=True).click()
        dashboard = page.locator('#wfWrap').inner_text()
        check('The dashboard names the interruption and leaves unmeasured gallons unknown',
              'Interrupted · 8 of 20 min' in dashboard and 'gallons unknown' in dashboard)
        press('Record run')
        fill('Run started at', f'{year}-06-12T07:15')
        page.get_by_label('Run status', exact=True).select_option('Skipped')
        page.get_by_role('dialog').get_by_role('button', name='Record run', exact=True).click()
        dashboard = page.locator('#wfWrap').inner_text()
        check('A skipped run can be recorded without typing zero, and adds no start or minutes',
              '1 started · 1 interrupted · 1 skipped · 8 min' in dashboard)
        press('Season')
        check('The dashboard renders no null placeholders when the chart is hidden',
              'null' not in page.locator('#wfWrap').inner_text().lower())
        press('Add zone')
        fill('Zone name', 'Second line')
        fill('Rated flow (gal/min, optional)', '2')
        press('Save equipment')
        page.set_viewport_size({'width': 390, 'height': 844})
        press('Record irrigation run')
        picker = page.get_by_label('Garden and zone', exact=True)
        check('The phone asks for a specific zone when more than one is configured', picker.input_value() == '')
        picker.select_option(label=next(name for name in picker.locator('option').all_text_contents() if 'Second line' in name))
        press('Continue')
        fill('Actual minutes', '3')
        page.get_by_label('Use 2 gal/min to estimate unmetered water for this run').uncheck()
        page.get_by_role('dialog').get_by_role('button', name='Record run', exact=True).click()
        check('A phone run preserves unknown volume when the configured rate did not apply',
              page.evaluate("""() => { const r = LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run')
                .find(g => g.chosen.label === 'Second line'); return r.chosen.elapsed === 3 && LRFWaterFeed.water(r).gallons === null; }"""))
        page.set_viewport_size({'width': 1480, 'height': 900})
        press('Water')
        press('Fertility')
        press('Fertilizer supplies')
        press('Stock history')
        check('Prior work has a linked movement without inventing opening stock',
              'Shelf count needed' in page.get_by_role('dialog').inner_text()
              and 'Tank refill' in page.get_by_role('dialog').inner_text())
        page.clock.set_fixed_time(f'{year}-06-12T15:00:23Z')
        press('Count shelf')
        fill('Full bags','1')
        fill('Loose pounds','3')
        press('Save shelf count')
        check('A count establishes the physical shelf after previous work',
              '23 lb on hand' in page.get_by_role('dialog').inner_text())
        page.clock.set_fixed_time(f'{year}-06-13T09:10:31Z')
        press('Receive delivery')
        fill('Full bags','1')
        fill('Loose pounds','4')
        fill('Delivery or invoice line reference (optional)','Example line 2')
        press('Record delivery')
        check('A delivery adds the bag and loose pounds to the counted shelf',
              '47 lb on hand' in page.get_by_role('dialog').inner_text())
        press('Done')
        before_order=page.evaluate('LRFApp.contentKey()')
        press('Plan fertilizer order')
        page.get_by_label('remaining full batches',exact=False).fill('9')
        page.get_by_text('Remaining field applications',exact=True).click()
        fill('Test feed (field lb)','24')
        check('Remaining batches and field demand share one 10-percent reserve and bag rounding',
              'Test feed · 1 bag × 20 lb' in page.get_by_role('dialog').inner_text()
              and '60 lb planned · 66 lb including spare' in page.get_by_role('dialog').inner_text())
        with page.expect_download() as dl:
            press('Download order list')
        with open(dl.value.path(), encoding='utf-8') as f:
            exported = f.read()
            check('The order list preserves its input quantities, pack size and shelf credit',
                  all(text in exported for text in ('Test tank · 9 batch(es) × 5 gal','Test feed · 24 lb',
                      '1 bag × 20 lb · 60 lb planned · 66 lb with spare · 47 lb on hand')))
        press('Done')
        check('Preparing the order leaves the plan untouched',before_order==page.evaluate('LRFApp.contentKey()'))
        check('The workflow raised no page errors', not errors)
        browser.close()
except Exception as exc:
    failed.append(str(exc))
finally:
    server.shutdown()
print(json.dumps({'passed': len(passed), 'of': len(passed)+len(failed), 'failed':failed}))
sys.exit(bool(failed))

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
        page = browser.new_page(viewport={'width': 1480, 'height': 900})
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
        press('Add tank')
        fill('Product name', 'Test feed')
        fill('Bag weight (lb)', '20')
        fill('N on label (%)', '10')
        press('Save product')
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
        check('The workflow raised no page errors', not errors)
        browser.close()
except Exception as exc:
    failed.append(str(exc))
finally:
    server.shutdown()
print(json.dumps({'passed': len(passed), 'of': len(passed)+len(failed), 'failed':failed}))
sys.exit(bool(failed))

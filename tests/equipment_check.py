"""Exercise soil snapshots, archived days and Hunter run volumes on the synthetic farm."""
import functools
import http.server
import json
from pathlib import Path
import sys
import threading
from playwright.sync_api import sync_playwright

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=sys.argv[1]))
threading.Thread(target=server.serve_forever, daemon=True).start()
sample = json.loads((Path(__file__).resolve().parents[1] / 'tools/equipment/Sample-WH52.json').read_text())
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':390,'height':844}, timezone_id='America/New_York')
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.LRFApp?.state.ready')
        btn = lambda text: page.get_by_role('button', name=text, exact=True)
        btn('Irrigation and soil readings').click()
        page.get_by_label('Garden',exact=True).select_option(index=1)
        assert page.get_by_role('link',name='Open Hydrawise').get_attribute('href') == 'https://app.hydrawise.com/'
        def upload(payload):
            btn('Read soil probes').click()
            page.get_by_label('Ecowitt snapshot JSON').set_input_files({
                'name':'example.json','mimeType':'application/json','buffer':json.dumps(payload).encode()})
            page.get_by_label('Probe channel').select_option('soil_moisture_ec_ch1')
        upload(sample)
        dialog = page.get_by_role('dialog')
        assert '1.45 mS/cm' in dialog.inner_text() and 'Over 15 minutes old' in dialog.inner_text()
        btn('Save channel to garden').click()
        upload(sample)
        btn('Save channel to garden').click()
        assert 'already saved' in dialog.get_by_role('alert').inner_text()
        btn('Cancel').click()
        archive = {'format':'ecowitt-soil-day-v1','date':'2026-05-15','gateway':'Demo gateway','snapshots':[sample,sample]}
        upload(archive)
        btn('Save daily summary').click()
        assert page.get_by_text('Daily soil summaries · 1',exact=True).is_visible()
        assert page.evaluate('Object.keys(LRFApp.state.plan.lrfNext.waterFeed.soil).length') == 3
        btn('Add zone').click()
        page.get_by_label('Zone name').fill('Test station')
        page.get_by_text('Hunter controller and station',exact=True).click()
        page.get_by_label('Hydrawise controller name').fill('Trial clock')
        page.get_by_label('Hunter station number').fill('2')
        btn('Save equipment').click()
        btn('Record run').first.click()
        page.get_by_label('Actual minutes').fill('8')
        dialog.get_by_role('button',name='Record run',exact=True).click()
        page.get_by_text('Irrigation history · 1',exact=True).click()
        page.locator('details.wf-history > summary').filter(has_text='Test station').click()
        btn('Attach Hunter meter reading').click()
        page.get_by_label('Measured run volume').fill('37.85411784')
        page.get_by_label('Volume unit').select_option('L')
        page.get_by_label('I matched this zone', exact=False).check()
        btn('Attach reading').click()
        assert '10 gal metered' in page.locator('#wfWrap').inner_text()
        assert page.evaluate("LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run').length") == 1
        assert not errors, errors
        browser.close()
    print('Phone irrigation, snapshot replay, compact daily summary and Hunter run volume passed.')
finally:
    server.shutdown()

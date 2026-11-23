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
        garden_id = gardens.input_value()
        gardens.select_option('')
        check('Fertility opens with the requested job, its reason, and a separate group for unconfigured gardens',
              page.get_by_role('heading', name='Needs attention', exact=True).is_visible()
              and page.get_by_text('Confirmed empty tank', exact=True).is_visible()
              and page.get_by_role('heading', name='Your gardens', exact=True).is_visible())
        page.get_by_role('button',name='Refill Test tank',exact=False).click()
        check('Opening a refill focuses the named card', page.evaluate(
            "document.activeElement.contains(document.querySelector('[data-hook=wf-complete]'))"))
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
        gardens.select_option(garden_id)
        check('Applied nutrients and mixed nutrients occupy separate rows',
              '0.4 lb' in page.get_by_role('row', name='Mixed into tanks', exact=False).inner_text()
              and '0.5 lb' in page.get_by_role('row', name='Field applied', exact=False).inner_text())
        press('Garden details')
        page.get_by_text('Season plan · '+str(year), exact=True).click()
        press('View full season')
        dialog=page.get_by_role('dialog')
        check('Full season gives the chart and budget room on desktop', dialog.bounding_box()['width'] >= 800
              and dialog.get_by_text('Field nitrogen applied by week · '+str(year),exact=True).is_visible()
              and dialog.get_by_role('row',name='Field applied',exact=False).is_visible())
        press('Back to garden')
        check('Garden card brings the grower back to its four sections', all(word in dialog.inner_text()
              for word in ('This week', 'Season plan', 'Soil and tissue tests', 'Setup')))
        press('Done')
        press('Products and recipes')
        check('Assumptions shows product analysis and the recipe per gallon',
              dialog.get_by_role('row',name='Test feed',exact=False).is_visible() and '0.8 lb Test feed per gallon' in dialog.inner_text())
        press('Done')
        press('Soil tests')
        press('Review lab result')
        fill('Lab and report ID','Sample report')
        fill('Extraction method or tissue stage','Reported extract')
        page.get_by_text('Paste readings from a spreadsheet',exact=True).click()
        fill('Readings from spreadsheet','Calcium\t12\tppm\nPotassium\t8\tppm')
        press('Review reading')
        def count_labs():
            return page.evaluate("Object.keys(LRFApp.state.plan.lrfNext.waterFeed.labs || {}).length")
        check('Review shows the original values and leaves the plan untouched',
              count_labs()==0 and dialog.get_by_role('row',name='Calcium',exact=False).get_by_text('12 ppm').is_visible())
        page.get_by_label('Include Potassium',exact=True).uncheck()
        press('Add reading')
        press('Back to report')
        check('Returning to the report keeps the full draft and its selections',
              page.get_by_label('Include Calcium',exact=True).is_checked() and not page.get_by_label('Include Potassium',exact=True).is_checked())
        press('Import selected readings')
        check('Only selected readings appear in the garden history', count_labs()==1
              and page.get_by_role('row',name='Calcium',exact=False).get_by_text('12 ppm').is_visible()
              and page.get_by_role('row',name='Potassium',exact=False).count()==0)
        press('Now')
        press('Irrigation')
        check_current_words('Irrigation')
        press('Add zone')
        fill('Zone name', 'Test zone')
        press('Save equipment')
        press('Record run')
        page.get_by_text('Use actual minutes',exact=True).click()
        fill('Actual minutes', '8')
        page.get_by_text('Time, status and controller details',exact=True).click()
        fill('Planned minutes (optional)', '20')
        page.get_by_label('Run status', exact=True).select_option('Interrupted')
        page.get_by_role('dialog').get_by_role('button', name='Save watering', exact=True).click()
        dashboard = page.locator('#wfWrap').inner_text()
        check('The dashboard names the interruption and leaves unmeasured gallons unknown',
              'Interrupted · 8 of 20 min' in dashboard and 'gallons unknown' in dashboard)
        press('Record run')
        page.get_by_text('Time, status and controller details',exact=True).click()
        fill('Run started at', f'{year}-06-12T07:15')
        page.get_by_label('Run status', exact=True).select_option('Skipped')
        page.get_by_role('dialog').get_by_role('button', name='Save watering', exact=True).click()
        dashboard = page.locator('#wfWrap').inner_text()
        check('A skipped run can be recorded without typing zero, and adds no start or minutes',
              '1 started · 1 interrupted · 1 skipped · 8 min' in dashboard)
        page.get_by_text('Run list · 2',exact=True).click()
        page.get_by_role('button',name='Skipped · 0 min',exact=False).last.click()
        check('The run list offers the same evidence as the short skipped timeline mark',
              page.get_by_role('dialog').get_by_text('Test zone',exact=True).is_visible())
        press('Done')
        press('Season')
        check('The dashboard renders no null placeholders when the chart is hidden',
              'null' not in page.locator('#wfWrap').inner_text().lower())
        press('Add zone')
        fill('Zone name', 'Second line')
        fill('Rated flow (gal/min, optional)', '2')
        press('Save equipment')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.locator('[data-hook=wf-phone-run]').click()
        page.get_by_label('Garden watered',exact=True).select_option(garden_id)
        picker = page.get_by_label('Irrigation zone', exact=True)
        check('The phone asks for a specific zone when more than one is configured', picker.input_value() == '')
        picker.select_option(label=next(name for name in picker.locator('option').all_text_contents() if 'Second line' in name))
        page.get_by_text('Use actual minutes',exact=True).click()
        fill('Actual minutes', '3')
        page.get_by_label('Use 2 gal/min to estimate unmetered water for this run').uncheck()
        page.get_by_role('dialog').get_by_role('button', name='Save watering', exact=True).click()
        check('A phone run preserves unknown volume when the configured rate did not apply',
              page.evaluate("""() => { const r = LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run')
                .find(g => g.chosen.label === 'Second line'); return r.chosen.elapsed === 3 && LRFWaterFeed.water(r).gallons === null; }"""))
        press('Irrigation and soil readings')
        check('Phone irrigation preserves its viewport and returns to field Tasks',
              page.get_by_role('button',name='Back to Tasks').is_visible()
              and page.evaluate('document.documentElement.scrollWidth===document.documentElement.clientWidth'))
        press('Back to Tasks')
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
        # A grower with no Water records can complete setup, then water without creating a zone.
        page=browser.new_page(viewport={'width':1280,'height':840},timezone_id='UTC')
        page.on('pageerror',lambda err: errors.append(str(err)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        page.wait_for_function('window.LRFApp?.state.ready')
        page.clock.set_fixed_time(f'{year}-06-12T14:00:00Z')
        press('Water')
        before=page.evaluate('LRFApp.contentKey()')
        press('Add Dosatron')
        garden=page.get_by_label('Garden for this injector')
        garden.select_option(index=1)
        selected=garden.input_value()
        page.get_by_label('Fertilizer setup').select_option('weight')
        fill('Fertilizer name','Sample soluble fertilizer')
        page.get_by_text('Other label nutrients and bag size').click()
        fill('Bag weight (lb)','25')
        fill('N on label (%)','10')
        fill('Fertilizer in this batch (lb)','1')
        fill('Final stock volume (gal)','5')
        fill('Injection ratio','1:100')
        check('One setup sheet shows the mix weight and constant feed before making any changes',
              '1 lb Sample soluble fertilizer' in page.get_by_role('status').last.inner_text()
              and page.get_by_label('Use constant feed for this garden').is_checked() and page.evaluate('LRFApp.contentKey()')==before)
        press('Save Dosatron')
        check('One save creates one product, stock recipe and named garden injector',
              page.evaluate("['products','recipes','tanks'].every(k=>Object.keys(LRFApp.state.plan.lrfNext.waterFeed[k]).length===1)")
              and page.get_by_label('Garden',exact=True).input_value()==selected)
        press('Record watering')
        fill('Metered gallons','200')
        check('The usual injector, dial and ppm are visible without opening a second control',
              'Constant feed · Sample soluble fertilizer · 1:100' in page.get_by_role('dialog').inner_text()
              and not page.get_by_label('Fertilizer used').is_visible() and '0.04 lb N estimated' in page.get_by_role('dialog').inner_text())
        page.get_by_text('Change feed for this watering',exact=True).click()
        page.get_by_label('Fertilizer used').select_option(index=2)
        page.get_by_label('When was the injector on?').select_option('part')
        fill('Gallons with fertilizer','250')
        press('Save watering')
        check('Too many fertilized gallons are explained before anything is saved',
              'exceed' in page.get_by_role('alert').inner_text() and page.evaluate("!LRFApp.state.plan.lrfNext.waterFeed.reports"))
        fill('Gallons with fertilizer','100')
        check('The grower sees the partial-run nutrient estimate before saving',
              '0.02 lb N estimated' in page.get_by_role('dialog').inner_text() and page.get_by_role('dialog').get_by_role('alert').count()==0)
        press('Save watering')
        check('A gallons-only watering preserves its unknown duration and needs no zone setup',
              '200 gal metered' in page.locator('#wfWrap').inner_text() and 'Duration unknown' in page.locator('#wfWrap').inner_text()
              and page.evaluate("Object.keys(LRFApp.state.plan.lrfNext.waterFeed.zones || {}).length===0"))
        press('Fertility')
        check('Season records the injector estimate separately from dry product and tank mixing',
              '0.02 lb' in page.get_by_role('row',name='Via injector (estimated)').inner_text()
              and page.get_by_role('row',name='Field applied').count()==0 and page.get_by_role('row',name='Mixed into tanks').count()==0)
        page.set_viewport_size({'width':390,'height':844})
        page.get_by_role('button',name='Irrigation and soil readings').wait_for()
        page.locator('[data-hook=wf-phone-run]').click()
        page.get_by_label('Garden watered').select_option(selected)
        fill('Metered gallons','40')
        page.get_by_text('Change feed for this watering',exact=True).click()
        page.get_by_label('Fertilizer used').select_option('plain')
        check('Phone watering fits the viewport and labels a water-only run',
              'Water only' in page.get_by_role('dialog').get_by_role('status').inner_text()
              and page.evaluate('document.documentElement.scrollWidth===document.documentElement.clientWidth'))
        press('Cancel')
        check('Cancelling on the phone leaves the garden with one physical run',
              page.evaluate("LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run').length===1") and not errors)
        page.clock.set_fixed_time(f'{year}-06-12T15:00:00Z')
        press('Record watering')
        check('The phone remembers the last watered garden and opens with gallons focused',
              page.get_by_label('Garden watered').input_value()==selected
              and page.get_by_label('Metered gallons').evaluate('el=>el===document.activeElement'))
        fill('Metered gallons','100')
        press('Save watering')
        check('A gallons-only save records whole-run dosing and leaves stock debits to physical work',
              page.evaluate("""() => {const b=LRFApp.state.plan.lrfNext.waterFeed;const gs=LRFWaterFeed.groups(b,'run');
              return gs.length===2 && gs.some(g=>g.chosen.feed.mode==='whole' && LRFWaterFeed.feedDelivery(g).stockGallons===1)
                && LRFWaterFeed.stock(b,Object.keys(b.products)[0]).used===0;}"""))
        press('Record watering')
        fill('Metered gallons','20')
        press('Save watering')
        check('A different amount in the same minute opens the time before another report can change totals',
              page.get_by_label('Run started at').is_visible() and page.get_by_label('Add another report to this same watering').is_visible()
              and page.evaluate("LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run').length===2"))
        press('Cancel')
        page.set_viewport_size({'width':1280,'height':840})
        press('Water')
        press('Fertility')
        page.get_by_label('Garden',exact=True).select_option(selected)
        page.get_by_text('Injector totals by week and season',exact=True).click()
        check('Weekly and seasonal injector totals name their area basis and distinguish missing label nutrients',
              page.get_by_text('Estimated lb/acre over',exact=False).is_visible()
              and 'Unknown' in page.get_by_role('row',name='Week of',exact=False).inner_text())
        press('Edit injector')
        page.get_by_label('Use constant feed for this garden').uncheck()
        press('Save equipment')
        press('Record watering')
        check('Turning off the garden default removes the prefill and preserves the saved doses',
              'Constant feed ·' not in page.get_by_role('dialog').inner_text()
              and page.evaluate("LRFWaterFeed.groups(LRFApp.state.plan.lrfNext.waterFeed,'run').every(g=>g.chosen.feed)"))
        press('Cancel')
        press('Use constant feed')
        page.get_by_role('dialog').get_by_role('button',name='Use constant feed').click()
        press('Record watering')
        page.get_by_text('Time, status and controller details',exact=True).click()
        fill('Run started at',f'{year}-06-11T15:00')
        check('Backdating asks what ran and keeps a previous day out of the automatic feed',
              page.get_by_label('Fertilizer used').input_value()=='' and 'choose what ran' in page.get_by_role('dialog').inner_text())
        press('Cancel')
        press('Add Dosatron')
        page.get_by_label('Garden for this injector').select_option(index=2)
        second=page.get_by_label('Garden for this injector').input_value()
        page.get_by_label('Fertilizer',exact=True).select_option(index=1)
        fill('Target ppm N','100')
        fill('Injection ratio','1:200')
        check('A target ppm and dial calculate the five-gallon stock recipe before saving',
              '8.345' in page.get_by_role('dialog').inner_text() and '100 ppm N at the emitter' in page.get_by_role('dialog').inner_text())
        press('Save Dosatron')
        page.reload()
        page.wait_for_function('window.LRFApp?.state.ready')
        press('Water')
        press('Record watering')
        page.get_by_label('Garden watered').select_option(second)
        check('Reload keeps the second garden’s 100 ppm mix at 1:200 and its own injector',
              '1:200 · 100 ppm N' in page.get_by_role('dialog').inner_text()
              and page.evaluate("Object.values(LRFApp.state.plan.lrfNext.waterFeed.constantFeed).filter(x=>x.tankId).length===2"))
        fill('Metered gallons','20')
        page.get_by_text('Change feed for this watering',exact=True).click()
        fill('Ratio used','1:400')
        press('Save watering')
        page.get_by_text('Run list · 1',exact=True).click()
        page.get_by_role('button',name='Completed · Duration unknown',exact=False).last.click()
        check('A one-off dial change shows its actual ppm and ratio in irrigation history',
              '1:400 · 50 ppm N' in page.get_by_role('dialog').inner_text() and 'at 1:200 at 1:400' not in page.get_by_role('dialog').inner_text())
        press('Done')
        press('Record watering')
        page.get_by_label('Garden watered').select_option(selected)
        check('Changing gardens restores the selected garden’s own dial',
              '1:100' in page.get_by_role('dialog').inner_text() and '1:200' not in page.get_by_role('dialog').inner_text() and not errors)
        browser.close()
except Exception as exc:
    failed.append(str(exc))
finally:
    server.shutdown()
print(json.dumps({'passed': len(passed), 'of': len(passed)+len(failed), 'failed':failed}))
sys.exit(bool(failed))

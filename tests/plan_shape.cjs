'use strict';
/* The plan's shape, written down: every place in a plan the planner writes, what it holds, and how js/merge.js joins it.
 *
 * Why: two devices' plans are joined record by record (js/merge.js). The merge goes by shape, and a field it did not foresee
 * is joined by shape too, which can be wrong (half of a thing from each side, a count added twice). This table is the list
 * of what a plan may hold. tests/shape_test.cjs and tests/shape_check.py hold the made-up farm, the planner's own edits and
 * the merge's own tables to it, so a build that writes a field named nowhere here fails a check, and has to say here how
 * that field is joined. It is not served to a browser: nothing here changes what the planner does.
 *
 * In js/merge.js a place written with "*" is matched for any key (WHOLE: "plantings[].tasks.delay.*" is every job put off), and
 * the two places under ALIAS below are held to the rules of the place they have the shape of.
 *
 * An entry is   'place': 'types [rules]'.   A place is written as js/merge.js writes it: "plantings[].bedLayout" is the key
 * bedLayout of any record of the list plantings, and "*" stands for a key chosen by the data (a crop's key, a job's kind).
 *
 * The types, any of them joined by |:
 *   text, number, bool, null    a plain value
 *   object                      keys of its own, each named here
 *   map                         keys chosen by the data; what each holds is under "<place>.*"
 *   records                     a list of objects with ids, none twice: joined record by record; each is under "<place>[]"
 *   lines                       a list of objects without ids; each is under "<place>[]". Joined as one value unless a rule says otherwise
 *   list                        a list of plain values, or of lists named under "<place>[]": one value
 *   any                         kept as read: nothing under it is named or checked (a copy of a record, text the planner never edits)
 *
 * The rules, each matched one for one to js/merge.js by tests/shape_test.cjs:
 *   whole       taken whole from one side, never half from each (merge.js WHOLE)
 *   kept        lines without ids whose new lines from each side are kept (merge.js NO_IDS)
 *   one         lines without ids the merge takes as one value, by its own default (the cloud's stands when both sides change
 *               them): said outright, so that no such list is left to the default by accident; never in WHOLE or NO_IDS
 *   stamp       "last changed at": the later stands, and nothing is said (merge.js STAMPS, by the key's name)
 *   quiet       who saved a file and with what, and what a device notes for itself about the plan it holds: the cloud's, and
 *               nothing is said (merge.js QUIET)
 *   together    a key of a record read together with others of the same record (a from and a to, a yield and its basis): the
 *               group is one value (merge.js TOGETHER)
 *   place       where a planting is: one value with the others (merge.js PLACE)
 *   time        when a planting is: one value (merge.js TIME)
 *   recording   a job recorded on a planting is one unit with its history and the seed it drew (merge.js joinPlanting)
 *   rule        joined by a rule of its own in merge.js (merge.js RULES)
 * A place with no rule is joined by shape: an object key by key, records by id, anything else as one value.
 *
 * A plan as a file holds it carries, beside the planner's own collections, the records the planner does not edit (harvest
 * logs, soil tests and the like: planio.js calls them the attic). Those are kept as read and are not named here: a top-level
 * key that is not one of planio.js CORE_KEYS, nor lrfNextKeep, is passed over when { attic: CORE_KEYS } is given.
 */
(function (root) {
  const SHAPE = {
    '': 'object',   // the plan

    'assumptions': 'object',
    'assumptions.crops': 'map',
    'assumptions.crops.*': 'map',
    'assumptions.crops.*.*': 'object',
    'assumptions.crops.*.*.dtm': 'number',
    'assumptions.crops.*.*.yield': 'number',
    'assumptions.sell': 'map',
    'assumptions.sell.*': 'object whole',
    'assumptions.sell.*.days': 'number',
    'assumptions.sell.*.house': 'bool',
    'assumptions.sell.*.keep': 'number',
    'assumptions.sell.*.looked': 'number',
    'assumptions.sell.*.pattern': 'text',
    'assumptions.sell.*.price': 'number',
    'assumptions.sell.*.share': 'number',
    'assumptions.sell.*.things': 'map',
    'assumptions.sell.*.things.*': 'object',
    'assumptions.sell.*.things.*.counted': 'text',
    'assumptions.sell.*.things.*.days': 'number',
    'assumptions.sell.*.things.*.from': 'text',
    'assumptions.sell.*.things.*.holds': 'number',
    'assumptions.sell.*.things.*.id': 'text',
    'assumptions.sell.*.things.*.n': 'number',
    'assumptions.sell.*.things.*.name': 'text',
    'assumptions.sell.*.things.*.of': 'text',
    'assumptions.sell.*.things.*.pattern': 'text',
    'assumptions.sell.*.things.*.place': 'text',
    'assumptions.sell.*.things.*.price': 'number',
    'assumptions.sell.*.things.*.share': 'number',
    'assumptions.sell.*.things.*.unit': 'text',
    'assumptions.sell.*.things.*.weighs': 'number',
    'assumptions.sell.*.things.*.yield': 'number',
    'assumptions.sell.*.turnover': 'number',
    'assumptions.sell.*.unit': 'text',
    'assumptions.sell.*.until': 'map',          // a last picking for a place (E2c): taken with the crop's line, whole
    'assumptions.sell.*.until.*': 'text',
    'assumptions.sellV': 'map',
    'assumptions.sellV.*': 'object whole',
    'assumptions.sellV.*.price': 'number',
    'assumptions.sellV.*.unit': 'text',
    'assumptions.starts': 'map',
    'assumptions.starts.*': 'object',
    'assumptions.starts.*.from': 'text',
    'assumptions.starts.*.less': 'number',
    'assumptions.v': 'number',
    'assumptions.varieties': 'map',
    'assumptions.varieties.*': 'map',
    'assumptions.varieties.*.*': 'object',
    'assumptions.varieties.*.*.dtm': 'number',
    'assumptions.varieties.*.*.yield': 'number',

    'beds': 'records',
    'beds[]': 'object',
    'beds[].active': 'bool',
    'beds[].bed': 'text',
    'beds[].count': 'number',
    'beds[].ct': 'text',
    'beds[].gardenId': 'text',
    'beds[].id': 'text',
    'beds[].l': 'number',
    'beds[].liveTrayPool': 'bool',
    'beds[].lrfTrellis': 'object',
    'beds[].lrfTrellis.type': 'text',
    'beds[].lrfTrellis.v': 'number',
    'beds[].note': 'text',
    'beds[].orient': 'text',
    'beds[].potLayout': 'object whole',
    'beds[].potLayout.columns': 'number',
    'beds[].potLayout.gapFt': 'number',
    'beds[].px': 'null|object whole',
    'beds[].px.rot': 'number',
    'beds[].px.x': 'number',
    'beds[].px.y': 'number',
    'beds[].trays': 'number',
    'beds[].type': 'text',
    'beds[].use': 'text',
    'beds[].w': 'number',

    'containers': 'records',
    'containers[]': 'object',
    'containers[].diam': 'number',
    'containers[].id': 'text',
    'containers[].l': 'number',
    'containers[].name': 'text',
    'containers[].plants': 'number',
    'containers[].shape': 'text',
    'containers[].w': 'number',

    'crops': 'records',
    'crops[]': 'object',
    'crops[].baseUnit': 'text',
    'crops[].dtm': 'number',
    'crops[].family': 'text',
    'crops[].fieldSeason': 'text',
    'crops[].firstSafeField': 'text',
    'crops[].frostTender': 'bool',
    'crops[].germ': 'null|number',
    'crops[].gh': 'number',
    'crops[].harvestMode': 'text',
    'crops[].harvestUntil': 'text',
    'crops[].hw': 'number',
    'crops[].id': 'text',
    'crops[].inRow': 'number',
    'crops[].k': 'number',
    'crops[].liveSow': 'object whole',
    'crops[].liveSow.cells': 'number',
    'crops[].liveSow.how': 'text',
    'crops[].liveSow.perCell': 'number',
    'crops[].material': 'text',
    'crops[].method': 'text',
    'crops[].micro': 'bool',
    'crops[].mk': 'number',
    'crops[].n': 'number',
    'crops[].name': 'text',
    'crops[].note': 'text',
    'crops[].p': 'number',
    'crops[].perennial': 'bool',
    'crops[].plantingMaterial': 'text',
    'crops[].potUpWk': 'number',
    'crops[].price': 'number',
    'crops[].prop': 'text',
    'crops[].rockwoolDays': 'number',
    'crops[].rowSp': 'number',
    'crops[].rowsPerBed': 'null|number',
    'crops[].seed1000': 'number',
    'crops[].seedG': 'null|number',
    'crops[].seedLb': 'null|number',
    'crops[].seedsFt': 'number',
    'crops[].spc': 'number',
    'crops[].tower': 'bool',
    'crops[].towerDays': 'number',
    'crops[].tray': 'number',
    'crops[].yBasis': 'text together',
    'crops[].yield': 'number together',
    'crops[].yieldDays': 'number',

    'cropUnits': 'map',
    'cropUnits.*': 'object whole',
    'cropUnits.*.base': 'text',
    'cropUnits.*.units': 'list',
    'cropUnits.*.units[]': 'list',
    'cropUnits.*.units[][]': 'number|text',

    'customers': 'records',
    'customers[]': 'object',
    'customers[].id': 'text',
    'customers[].kind': 'text',
    'customers[].name': 'text',
    'customers[].prices': 'map',
    'customers[].prices.*': 'null|number',
    'customers[].share': 'number',

    'gardens': 'records',
    'gardens[]': 'object',
    'gardens[].active': 'bool',
    'gardens[].bedOrder': 'object whole',
    'gardens[].bedOrder.ids': 'list',
    'gardens[].bedOrder.ids[]': 'text',
    'gardens[].bedOrder.v': 'number',
    'gardens[].close': 'text',
    'gardens[].compost': 'null|number',
    'gardens[].curveMode': 'text',
    'gardens[].dtmFactor': 'number',
    'gardens[].frost': 'bool',
    'gardens[].frostOffset': 'number',
    'gardens[].gapMode': 'text',
    'gardens[].growingEnvironment': 'object whole',
    'gardens[].growingEnvironment.kind': 'text',
    'gardens[].growingEnvironment.minTempF': 'null|number',
    'gardens[].growingEnvironment.v': 'number',
    'gardens[].id': 'text',
    'gardens[].liquidFeedProfile': 'object',
    'gardens[].liquidFeedProfile.enabled': 'bool',
    'gardens[].liquidFeedProfile.ppmN': 'number',
    'gardens[].liquidFeedProfile.productName': 'text',
    'gardens[].liquidFeedProfile.v': 'number',
    'gardens[].liveTrayPool': 'bool',
    'gardens[].mapLayout': 'object whole',
    'gardens[].mapLayout.appliedAt': 'text',
    'gardens[].mapLayout.bedIds': 'list',
    'gardens[].mapLayout.bedIds[]': 'text',
    'gardens[].mapLayout.columns': 'number',
    'gardens[].mapLayout.endGapFt': 'number',
    'gardens[].mapLayout.locked': 'bool',
    'gardens[].mapLayout.pathFt': 'number',
    'gardens[].mapScale': 'number',
    'gardens[].measuredSize': 'object',
    'gardens[].measuredSize.lengthFt': 'number',
    'gardens[].measuredSize.v': 'number',
    'gardens[].measuredSize.widthFt': 'number',
    'gardens[].name': 'text',
    'gardens[].notes': 'text',
    'gardens[].open': 'text',
    'gardens[].order': 'number',
    'gardens[].soilK': 'null|number',
    'gardens[].soilN': 'null|number',
    'gardens[].soilP': 'null|number',
    'gardens[].type': 'text',
    'gardens[].use': 'text',

    'liveTrayPlans': 'records',
    'liveTrayPlans[]': 'object whole',
    'liveTrayPlans[].customerId': 'text',
    'liveTrayPlans[].fall': 'text',
    'liveTrayPlans[].from': 'text',
    'liveTrayPlans[].id': 'text',
    'liveTrayPlans[].name': 'text',
    'liveTrayPlans[].rows': 'records',
    'liveTrayPlans[].rows[]': 'object',
    'liveTrayPlans[].rows[].cropId': 'text',
    'liveTrayPlans[].rows[].days': 'number',
    'liveTrayPlans[].rows[].fall': 'number',
    'liveTrayPlans[].rows[].id': 'text',
    'liveTrayPlans[].rows[].name': 'text',
    'liveTrayPlans[].rows[].price': 'number',
    'liveTrayPlans[].rows[].spring': 'number',
    'liveTrayPlans[].rows[].summer': 'number',
    'liveTrayPlans[].rows[].varietyId': 'null|text',
    'liveTrayPlans[].summer': 'text',
    'liveTrayPlans[].through': 'text',
    'liveTrayPlans[].updatedAt': 'text stamp',
    'liveTrayPlans[].v': 'number',
    'liveTrayPlans[].year': 'number',

    'lrfNext': 'object',
    'lrfNext.attic': 'text quiet',
    'lrfNext.backup': 'null|text quiet',
    'lrfNext.crates': 'text',
    'lrfNext.facts': 'map',
    'lrfNext.facts.*': 'map',
    'lrfNext.facts.*.*': 'object whole',
    'lrfNext.facts.*.*.create': 'any',   // a built-in record the grower changed before the plan had one of its own: the whole record, as made
    'lrfNext.facts.*.*.name': 'text',
    'lrfNext.facts.*.*.set': 'any',
    'lrfNext.facts.*.*.was': 'any',
    'lrfNext.from': 'text quiet',
    'lrfNext.groups': 'map',
    'lrfNext.groups.*': 'text',
    'lrfNext.importedAt': 'text quiet',
    'lrfNext.lastExport': 'text quiet',
    'lrfNext.mapImage': 'object quiet',
    'lrfNext.mapImage.mime': 'text',
    'lrfNext.mapImage.sha256': 'text',
    'lrfNext.passedOver': 'text quiet',
    'lrfNext.sample': 'bool|text',
    'lrfNext.source': 'text quiet',
    'lrfNext.startedAt': 'text quiet',
    'lrfNext.supplies': 'object',
    'lrfNext.supplies.cuft': 'map',
    'lrfNext.supplies.cuft.*': 'number',
    'lrfNext.supplies.have': 'map',
    'lrfNext.supplies.have.*': 'number',
    'lrfNext.supplies.mix': 'map',
    'lrfNext.supplies.mix.*': 'number',
    'lrfNext.supplies.pockets': 'number',
    'lrfNext.trays': 'text',
    'lrfNext.trayStart': 'text',
    'lrfNext.waiting': 'records',
    'lrfNext.waiting[]': 'object',   // a copy of a planting: every other key is read as plantings[] (ALIAS)
    'lrfNext.waiting[].wait': 'object whole',
    'lrfNext.waiting[].wait.beds': 'list',
    'lrfNext.waiting[].wait.beds[]': 'text',
    'lrfNext.waiting[].wait.every': 'number',
    'lrfNext.waiting[].wait.from': 'text',
    'lrfNext.waiting[].wait.gardens': 'list',
    'lrfNext.waiting[].wait.gardens[]': 'text',
    'lrfNext.waiting[].wait.k': 'number',
    'lrfNext.waiting[].wait.of': 'number',
    'lrfNext.waiting[].wait.s': 'text',
    'lrfNext.waiting[].wait.why': 'text',

    'lrfNextKeep': 'object',
    'lrfNextKeep.device': 'text quiet',
    'lrfNextKeep.keep': 'object',
    'lrfNextKeep.savedAt': 'text stamp',
    'lrfNextKeep.v': 'number quiet',

    'map': 'object',
    'map.ftPerPx': 'number',
    'map.imageFile': 'object whole',
    'map.imageFile.mime': 'text',
    'map.imageFile.name': 'text',
    'map.imageFile.sha256': 'text',
    'map.imgH': 'number',
    'map.imgW': 'number',
    'map.towerGap': 'number',
    'map.towerShape': 'text',

    'nursery': 'object',
    'nursery.benchAreas': 'records',
    'nursery.benchAreas[]': 'object',
    'nursery.benchAreas[].id': 'text',
    'nursery.benchAreas[].l': 'number',
    'nursery.benchAreas[].name': 'text',
    'nursery.benchAreas[].w': 'number',
    'nursery.cool': 'lines one',
    'nursery.cool[]': 'object',
    'nursery.cool[].after': 'number',
    'nursery.cool[].cropId': 'text',
    'nursery.cool[].from': 'text',
    'nursery.cool[].to': 'text',
    'nursery.harden': 'number',
    'nursery.lrfEdited': 'bool',
    'nursery.packing': 'number|text',
    'nursery.spaces': 'records',
    'nursery.spaces[]': 'object',
    'nursery.spaces[].active': 'bool',
    'nursery.spaces[].benchLayout': 'object whole',
    'nursery.spaces[].benchLayout.areaId': 'text',
    'nursery.spaces[].benchLayout.rotated': 'bool',
    'nursery.spaces[].benchLayout.x': 'number',
    'nursery.spaces[].benchLayout.y': 'number',
    'nursery.spaces[].from': 'text together',
    'nursery.spaces[].holds': 'number',
    'nursery.spaces[].id': 'text',
    'nursery.spaces[].kind': 'text',
    'nursery.spaces[].l': 'number',
    'nursery.spaces[].name': 'text',
    'nursery.spaces[].to': 'text together',
    'nursery.spaces[].w': 'number',

    'planningPreferences': 'object',
    'planningPreferences.bedsPerSuccession': 'number',
    'planningPreferences.checkNursery': 'bool',
    'planningPreferences.dateBasis': 'text',
    'planningPreferences.every': 'number',
    'planningPreferences.gardenOrder': 'list',
    'planningPreferences.gardenOrder[]': 'text',
    'planningPreferences.labor': 'object',
    'planningPreferences.labor.byCrop': 'map',
    'planningPreferences.labor.byCrop.*': 'null|number',
    'planningPreferences.labor.otherHours': 'number',
    'planningPreferences.labor.weeklyHours': 'null|number',
    'planningPreferences.minBatch': 'number',
    'planningPreferences.mode': 'text',
    'planningPreferences.sowWeekday': 'null|number',
    'planningPreferences.v': 'number',

    'products': 'any',   // carried in a plan; no screen of the planner writes it

    'plantings': 'records',
    'plantings[]': 'object rule',
    'plantings[].bedId': 'text place',
    'plantings[].bedLayout': 'object whole place',
    'plantings[].bedLayout.groupId': 'text',
    'plantings[].bedLayout.rowCount': 'number',
    'plantings[].bedLayout.rowStart': 'number',
    'plantings[].bedLayout.startFt': 'number',
    'plantings[].bedLayout.v': 'number',
    'plantings[].cropId': 'text',
    'plantings[].customerId': 'text',
    'plantings[].date': 'text time',
    'plantings[].done': 'map recording',
    'plantings[].done.*': 'text',
    'plantings[].dtm': 'number',
    'plantings[].established': 'bool',
    // marked failed on its panel (Tasks part 2): the day and when it was marked, written in one act, so taken whole. One a planting,
    // so a mark made on two devices is one record (the S1c note's rule for records still to come: a fact written once is taken whole).
    // Recording too: a mark on one device and work recorded after its day on the other are an order the planner refuses, so
    // joinPlanting keeps the cloud's and drops this device's (reported), as it does two jobs out of order
    'plantings[].failed': 'object whole recording',
    'plantings[].failed.at': 'text',
    'plantings[].failed.on': 'text',
    'plantings[].ft': 'number place',
    'plantings[].gives': 'text',
    'plantings[].growingDefaults': 'object whole',
    'plantings[].growingDefaults.crop': 'map',
    'plantings[].growingDefaults.crop.*': 'object',
    'plantings[].growingDefaults.crop.*.present': 'bool',
    'plantings[].growingDefaults.crop.*.value': 'number|text',
    'plantings[].growingDefaults.cropId': 'text',
    'plantings[].growingDefaults.v': 'number',
    'plantings[].harvestMode': 'text',
    'plantings[].harvestEnd': 'text',
    'plantings[].hw': 'number',
    'plantings[].id': 'text',
    'plantings[].inRow': 'number|text',
    'plantings[].liveTray': 'object whole',
    'plantings[].liveTray.key': 'text',
    'plantings[].liveTray.planId': 'text',
    'plantings[].liveTray.ready': 'text',
    'plantings[].liveTray.rowId': 'text',
    'plantings[].liveTray.week': 'text',
    'plantings[].lrfTrellis': 'object',
    'plantings[].lrfTrellis.type': 'text',
    'plantings[].lrfTrellis.v': 'number',
    'plantings[].note': 'text',
    'plantings[].out': 'text',
    'plantings[].perC': 'number',
    'plantings[].price': 'number',
    'plantings[].rowSp': 'number',
    'plantings[].rowsPerBed': 'number|text',
    'plantings[].seat': 'number place',
    'plantings[].shelter': 'null|object',
    'plantings[].shelter.gardenId': 'text',
    'plantings[].sowOn': 'text time',
    'plantings[].startFt': 'number place',
    'plantings[].tasks': 'object',
    'plantings[].tasks.delay': 'map',
    'plantings[].tasks.delay.*': 'object whole',
    'plantings[].tasks.delay.*.from': 'text',
    'plantings[].tasks.delay.*.own': 'text',
    'plantings[].tasks.delay.*.to': 'text',
    'plantings[].tasks.note': 'map',
    'plantings[].tasks.note.*': 'text',
    'plantings[].tasks.skip': 'map',
    'plantings[].tasks.skip.*': 'text',
    'plantings[].timingMode': 'text',
    'plantings[].towerCycle': 'object whole',
    'plantings[].towerCycle.days': 'number',
    'plantings[].towerCycle.replantSameDay': 'bool',
    'plantings[].towerCycle.v': 'number',
    'plantings[].trays': 'number',
    'plantings[].turnover': 'number',
    'plantings[].use': 'text',
    'plantings[].variety': 'text',
    'plantings[].varietyId': 'text',
    'plantings[].workflow': 'object recording',
    'plantings[].workflow.history': 'lines kept',
    'plantings[].workflow.history[]': 'object',
    'plantings[].workflow.history[].action': 'text',
    'plantings[].workflow.history[].at': 'text',
    'plantings[].workflow.history[].date': 'text',
    'plantings[].workflow.history[].follow': 'object',
    'plantings[].workflow.history[].follow.days': 'number',
    'plantings[].workflow.history[].follow.from': 'text',
    'plantings[].workflow.history[].follow.sowOn': 'text',
    'plantings[].workflow.history[].follow.to': 'text',
    'plantings[].workflow.history[].kind': 'text',
    'plantings[].workflow.history[].note': 'text',
    'plantings[].workflow.history[].previousActual': 'null|text',
    'plantings[].workflow.history[].sowingReview': 'object',
    'plantings[].workflow.history[].sowingReview.batchId': 'text',
    'plantings[].workflow.history[].sowingReview.unit': 'text',
    'plantings[].workflow.history[].sowingReview.v': 'number',
    'plantings[].workflow.seedUse': 'lines kept',
    'plantings[].workflow.seedUse[]': 'object',
    'plantings[].workflow.seedUse[].batchId': 'text',
    'plantings[].workflow.seedUse[].date': 'text',
    'plantings[].workflow.seedUse[].lotId': 'null|text',
    'plantings[].workflow.seedUse[].quantity': 'number',
    'plantings[].workflow.seedUse[].source': 'text',
    'plantings[].workflow.seedUse[].unit': 'text',
    'plantings[].workflow.seedUse[].untracked': 'bool',
    'plantings[].yield': 'number together',
    'plantings[].yieldBasis': 'text together',

    'salesMix': 'map',
    'salesMix.*': 'any',

    'seedInventory': 'object',
    'seedInventory.adjustments': 'records',
    'seedInventory.adjustments[]': 'object',
    'seedInventory.adjustments[].after': 'any',
    'seedInventory.adjustments[].at': 'text',
    'seedInventory.adjustments[].before': 'any',
    'seedInventory.adjustments[].id': 'text',
    'seedInventory.adjustments[].kind': 'text',
    'seedInventory.adjustments[].lotId': 'text',
    'seedInventory.adjustments[].reason': 'text',
    'seedInventory.importReceipts': 'records',
    'seedInventory.importReceipts[]': 'object',
    'seedInventory.importReceipts[].id': 'text',
    'seedInventory.importReceipts[].lineIds': 'list',
    'seedInventory.importReceipts[].lineIds[]': 'text',
    'seedInventory.importReceipts[].lotIds': 'list',
    'seedInventory.importReceipts[].lotIds[]': 'text',
    'seedInventory.importReceipts[].orderDate': 'text',
    'seedInventory.importReceipts[].orderNumber': 'text',
    'seedInventory.importReceipts[].sourceName': 'text',
    'seedInventory.legacyImported': 'any',
    'seedInventory.lots': 'records',
    'seedInventory.lots[]': 'object',
    'seedInventory.lots[].cost': 'number',
    'seedInventory.lots[].createdAt': 'text',
    'seedInventory.lots[].deleted': 'bool',
    'seedInventory.lots[].deletedAt': 'text',
    'seedInventory.lots[].germination': 'object whole',
    'seedInventory.lots[].germination.date': 'text',
    'seedInventory.lots[].germination.percent': 'null|number',
    'seedInventory.lots[].id': 'text',
    'seedInventory.lots[].invoiceId': 'text',
    'seedInventory.lots[].key': 'text',
    'seedInventory.lots[].lotNumber': 'text',
    'seedInventory.lots[].name': 'text',
    'seedInventory.lots[].note': 'text',
    'seedInventory.lots[].orderDate': 'text',
    'seedInventory.lots[].orderLineId': 'text',
    'seedInventory.lots[].orderNumber': 'text',
    'seedInventory.lots[].packLabel': 'text',
    'seedInventory.lots[].packs': 'number',
    'seedInventory.lots[].packSize': 'number',
    'seedInventory.lots[].productCode': 'text',
    'seedInventory.lots[].productURL': 'text',
    'seedInventory.lots[].purchasedQuantity': 'number',
    'seedInventory.lots[].purchaseWeightG': 'null|number',
    'seedInventory.lots[].quantity': 'number rule',
    'seedInventory.lots[].receivedDate': 'text',
    'seedInventory.lots[].reviewedForYear': 'number',
    'seedInventory.lots[].seedCountSource': 'text',
    'seedInventory.lots[].sourceText': 'text',
    'seedInventory.lots[].status': 'text',
    'seedInventory.lots[].storageNote': 'text',
    'seedInventory.lots[].supplier': 'text',
    'seedInventory.lots[].unit': 'text',
    'seedInventory.lots[].unitPrice': 'number',
    'seedInventory.lots[].updatedAt': 'text stamp',
    'seedInventory.lots[].usable': 'bool',
    'seedInventory.lots[].year': 'null|number',
    'seedInventory.performanceNotes': 'any',
    'seedInventory.v': 'number',

    'settings': 'object',
    'settings.benchTrays': 'number',
    'settings.buffer': 'number',
    'settings.cellCost': 'number',
    'settings.compost': 'number',
    'settings.compostCost': 'number',
    'settings.cropTypeList': 'object',
    'settings.cropTypeList.added': 'list',
    'settings.cropTypeList.added[]': 'text',
    'settings.cropTypeList.deleted': 'list',
    'settings.cropTypeList.deleted[]': 'text',
    'settings.cropTypeList.removed': 'list',
    'settings.cropTypeList.removed[]': 'text',
    'settings.cropTypeList.v': 'number',
    'settings.farm': 'text',
    'settings.features': 'object',
    'settings.features.bench': 'bool',
    'settings.features.fert': 'bool',
    'settings.features.fertCost': 'bool',
    'settings.features.irrigation': 'bool',
    'settings.features.map': 'bool',
    'settings.features.overhead': 'bool',
    'settings.features.plugs': 'bool',
    'settings.features.sales': 'bool',
    'settings.features.seed': 'bool',
    'settings.features.spacing': 'bool',
    'settings.features.succession': 'bool',
    'settings.features.varieties': 'bool',
    'settings.features.weather': 'bool',
    'settings.fertilityEnabled': 'bool',
    'settings.firstCoolField': 'text',
    'settings.firstWarmField': 'text',
    'settings.frostFirst': 'text',
    'settings.frostLast': 'text',
    'settings.germ': 'number',
    'settings.houseKeeps': 'bool',
    'settings.lastOutdoorField': 'text',
    'settings.microV2': 'bool',
    'settings.overheadFt': 'number',
    'settings.prices': 'map',
    'settings.prices.*': 'any',
    'settings.prodBase': 'text',
    'settings.prodK': 'text',
    'settings.prodN': 'text',
    'settings.prodP': 'text',
    'settings.soilK': 'number',
    'settings.soilN': 'number',
    'settings.soilP': 'number',
    'settings.theme': 'text',
    'settings.timing': 'text',
    'settings.towerNut': 'number',
    'settings.trayCost': 'number',
    'settings.turnover': 'number',
    'settings.year': 'number',

    'v': 'number',

    'varieties': 'records',
    'varieties[]': 'object',
    'varieties[]._basisFromText': 'text',
    'varieties[]._determinate': 'bool',   // written by planio.js pack for a variety whose notes say determinate, kept by unpack
    'varieties[]._catalogTextBasis': 'text',
    'varieties[]._pageTextBasis': 'text',
    'varieties[].active': 'bool',
    'varieties[].catalogDtm': 'null|number',
    'varieties[].catalogDtmMax': 'null|number',
    'varieties[].catalogDtmText': 'text',
    'varieties[].catalogHarvestStage': 'text',
    'varieties[].catalogMaturityBasis': 'text',
    'varieties[].catalogPage': 'null|number|text',
    'varieties[].catalogPdfPage': 'null|number|text',
    'varieties[].catalogSourceChoice': 'text',
    'varieties[].catalogSourceText': 'text',
    'varieties[].catalogSupplier': 'text',
    'varieties[].catalogTitle': 'text',
    'varieties[].catalogYear': 'null|number|text',
    'varieties[].cropId': 'text',
    'varieties[].deleted': 'bool',
    'varieties[].depth': 'text',
    'varieties[].description': 'text',
    'varieties[].dtm': 'number',
    'varieties[].environmentDefaults': 'object whole',
    'varieties[].environmentDefaults.field': 'object',
    'varieties[].environmentDefaults.field.gh': 'number',
    'varieties[].environmentDefaults.greenhouse': 'object',
    'varieties[].environmentDefaults.greenhouse.gh': 'number',
    'varieties[].environmentDefaults.v': 'number',
    'varieties[].gh': 'number',
    'varieties[].germ': 'number',
    'varieties[].id': 'text',
    'varieties[].inRow': 'number',
    'varieties[].latin': 'text',
    'varieties[].maturitySource': 'text',
    'varieties[].name': 'text',
    'varieties[].notes': 'text',
    'varieties[].photo': 'object whole',
    'varieties[].photo.credit': 'text',
    'varieties[].photo.importedAt': 'text',
    'varieties[].photo.mime': 'text',
    'varieties[].photo.name': 'text',
    'varieties[].photo.sha256': 'text',
    'varieties[].photo.size': 'number',
    'varieties[].photo.sourcePage': 'text',
    'varieties[].photo.sourceUrl': 'text',
    'varieties[].prices': 'any whole',
    'varieties[].rowSp': 'number',
    'varieties[].rowsPerBed': 'number',
    'varieties[].seedsPerG': 'number',
    'varieties[].seedsPerLb': 'number',
    'varieties[].seedsPerOz': 'number',
    'varieties[].seedsPerPacket': 'number',
    'varieties[].sku': 'text',
    'varieties[].source': 'text',
    'varieties[].stub': 'bool',
    'varieties[].supplier': 'text',
    'varieties[].supplierPacks': 'lines whole',
    'varieties[].supplierPacks[]': 'object',
    'varieties[].supplierPacks[].label': 'text',
    'varieties[].supplierPacks[].price': 'number',
    'varieties[].supplierPacks[].seeds': 'number',
    'varieties[].timingMode': 'text',
    'varieties[].url': 'text',
    'varieties[].webImport': 'any whole',
    'varieties[].webImportHistory': 'any',
  };
  /**
   * Places that have the shape of another: what a file keeps of the planner's own record (app.js withOwn) is that record, and a
   * planting waiting to be placed is a copy of a planting (app.js sendToWait, succession.js heldFor). An entry of the place's own
   * (the waiting planting's `wait`) stands over the other's.
   */
  const ALIAS = { 'lrfNextKeep.keep': 'lrfNext', 'lrfNext.waiting[]': 'plantings[]' };
  const TYPES = ['text', 'number', 'bool', 'null', 'object', 'map', 'records', 'lines', 'list', 'any'];
  const RULES = ['whole', 'kept', 'one', 'stamp', 'quiet', 'together', 'place', 'time', 'recording', 'rule'];
  const CONTAINERS = ['object', 'map', 'records', 'lines', 'list'];

  /** An entry read: { types: [...], rules: [...] }, or null when there is none for the place. */
  function entry(place) {
    const spec = SHAPE[place];
    if (typeof spec !== 'string') return null;
    const [types, ...rules] = spec.trim().split(/\s+/);
    return { types: types.split('|'), rules };
  }
  /** The place of a key inside an object or map at `place`, and of a member of a list at `place`. */
  const keyPlace = (place, key, isMap) => {
    if (isMap) return place + '.*';
    const own = place ? place + '.' + key : key;
    return ALIAS[place] && !(own in SHAPE) ? ALIAS[place] + '.' + key : own;
  };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const kindOf = v => (v === null ? 'null' : Array.isArray(v) ? 'list' : isObj(v) ? 'object' : typeof v === 'string' ? 'text' : typeof v === 'boolean' ? 'bool' : typeof v === 'number' && Number.isFinite(v) ? 'number' : typeof v);
  const usable = id => typeof id === 'string' || typeof id === 'number';

  /**
   * Hold a value to the written shape. `place` is where it stands in a plan ('' for a whole plan). Returns
   * { unknown: [{ path, place }], wrong: [{ path, place, want, got }] }: a key named nowhere, and a value of a type its place
   * does not allow (a list of records with a member that has no id, or an id twice, is wrong too). At most `limit` of each.
   * options.attic: the top-level keys that are the planner's own (planio.js CORE_KEYS); any other top-level key is the attic,
   * kept as read, and passed over.
   */
  function check(value, place = '', options = {}) {
    const unknown = [], wrong = [], limit = options.limit || 50, core = options.attic ? new Set([...options.attic, 'lrfNextKeep']) : null;
    const say = (list, item) => { if (list.length < limit) list.push(item); };
    function walk(v, at, path) {
      const e = entry(at);
      if (!e) { say(unknown, { path, place: at }); return; }
      const got = kindOf(v), types = e.types;
      const fits = types.includes('any') || types.includes(got) || (got === 'object' && types.includes('map')) || (got === 'list' && (types.includes('records') || types.includes('lines')));
      if (!fits) { say(wrong, { path, place: at, want: types.join('|'), got }); return; }
      if (types.includes('any')) return;
      if (got === 'object') {
        const isMap = !types.includes('object');
        for (const key of Object.keys(v)) {
          if (!at && core && !core.has(key)) continue;   // the attic
          walk(v[key], keyPlace(at, key, isMap), path ? `${path}.${key}` : key);
        }
      } else if (got === 'list') {
        if (types.includes('records')) {
          const seen = new Set();
          v.forEach((x, i) => { if (!isObj(x) || !usable(x.id) || seen.has(x.id)) say(wrong, { path: `${path}[${i}]`, place: at, want: 'a record with an id of its own', got: isObj(x) ? (usable(x.id) ? 'an id twice' : 'no id') : kindOf(x) }); else seen.add(x.id); });
        }
        const member = at + '[]';
        v.forEach((x, i) => {
          const here = isObj(x) && usable(x.id) && types.includes('records') ? `${path}[#${x.id}]` : `${path}[${i}]`;
          if (entry(member)) walk(x, member, here);
          else if (x !== null && typeof x === 'object') say(unknown, { path: here, place: member });   // a list of plain values holds no objects unless its members are named
        });
      }
    }
    walk(value, place, place);
    return { unknown, wrong };
  }
  /** Every entry, read: [{ place, types, rules }]. */
  const entries = () => Object.keys(SHAPE).map(place => ({ place, ...entry(place) }));
  /** The place a place hangs from, and whether that is a key of an object, a key of a map or a member of a list. '' for a top-level key. */
  function parentOf(place) {
    if (place.endsWith('[]')) return { parent: place.slice(0, -2), how: 'member' };
    const dot = place.lastIndexOf('.');
    if (dot < 0) return { parent: '', how: 'key' };
    return { parent: place.slice(0, dot), how: place.slice(dot + 1) === '*' ? 'any key' : 'key' };
  }

  const api = { SHAPE, ALIAS, TYPES, RULES, CONTAINERS, entry, entries, check, parentOf };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LRFShape = api;
})(typeof self !== 'undefined' ? self : this);

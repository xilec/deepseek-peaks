import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEEPSEEK_PROVIDER,
  PHASE,
  RULE,
  chipText,
  formatRemaining,
  isPeakRuleRoute,
  localWindowsOfDay,
  panelModel,
  phaseAt,
  effectiveRoute,
  routeFromCatalogDefault,
  routeFromModelSelection,
  shallowKeyNames,
} from '../src/peaks-core.mjs'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** 2026-09-18 is a Friday; 2026-09-19/20 the weekend; 2026-09-21 a Monday. */
const at = (iso) => Date.parse(iso)

test('the published rule is the one encoded', () => {
  assert.deepEqual(RULE.peakWindowsUtcMinutes, [
    [60, 240],
    [360, 600],
  ])
  assert.deepEqual(RULE.peakWeekdaysUtc, [1, 2, 3, 4, 5])
  assert.equal(RULE.offPeakRateRatio, 0.5)
  assert.equal(RULE.warnLeadMs, 30 * MINUTE)
})

test('phase around the first window of a weekday', () => {
  assert.equal(phaseAt(at('2026-09-18T00:29:00Z')).phase, PHASE.OFF_PEAK)
  assert.equal(phaseAt(at('2026-09-18T00:30:00Z')).phase, PHASE.SOON, 'warning lead is inclusive')
  assert.equal(phaseAt(at('2026-09-18T00:59:59Z')).phase, PHASE.SOON)
  assert.equal(phaseAt(at('2026-09-18T01:00:00Z')).phase, PHASE.PEAK)
  assert.equal(phaseAt(at('2026-09-18T03:59:59Z')).phase, PHASE.PEAK)
  assert.equal(phaseAt(at('2026-09-18T04:00:00Z')).phase, PHASE.OFF_PEAK, 'window end is exclusive')
})

test('the 04:00-06:00 UTC gap is off-peak and warns before the second window', () => {
  const gap = phaseAt(at('2026-09-18T04:00:00Z'))
  assert.equal(gap.untilMs, 2 * HOUR, 'the next peak is the same day at 06:00 UTC')
  assert.equal(phaseAt(at('2026-09-18T05:29:59Z')).phase, PHASE.OFF_PEAK)
  assert.equal(phaseAt(at('2026-09-18T05:30:00Z')).phase, PHASE.SOON)
  assert.equal(phaseAt(at('2026-09-18T06:00:00Z')).phase, PHASE.PEAK)
})

test('the second window ends the peak day', () => {
  assert.equal(phaseAt(at('2026-09-18T09:59:59Z')).phase, PHASE.PEAK)
  const afterPeak = phaseAt(at('2026-09-18T10:00:00Z'))
  assert.equal(afterPeak.phase, PHASE.OFF_PEAK)
  assert.equal(afterPeak.nextPeakAtMs, at('2026-09-21T01:00:00Z'), 'Friday afternoon waits for Monday')
  assert.equal(afterPeak.untilMs, 2 * 24 * HOUR + 15 * HOUR)
})

test('weekends carry no peak window at all', () => {
  assert.equal(phaseAt(at('2026-09-19T01:00:00Z')).phase, PHASE.OFF_PEAK, 'Saturday 01:00 UTC would be peak on a weekday')
  assert.equal(phaseAt(at('2026-09-19T06:00:00Z')).phase, PHASE.OFF_PEAK)
  assert.equal(phaseAt(at('2026-09-20T23:00:00Z')).phase, PHASE.OFF_PEAK)
  assert.equal(phaseAt(at('2026-09-21T00:29:00Z')).phase, PHASE.OFF_PEAK, 'the weekend simply runs into the warning lead')
  assert.equal(phaseAt(at('2026-09-21T00:30:00Z')).phase, PHASE.SOON, 'the warning before Monday 01:00 UTC is the last half hour of the weekend')
  assert.equal(phaseAt(at('2026-09-21T01:00:00Z')).phase, PHASE.PEAK)
})

test('chip copy for every state', () => {
  assert.equal(chipText(phaseAt(at('2026-09-18T00:10:00Z'))), 'Off-peak · peak in 50m')
  assert.equal(chipText(phaseAt(at('2026-09-18T05:50:00Z'))), 'Peak soon · 10m')
  assert.equal(chipText(phaseAt(at('2026-09-18T04:00:00Z'))), 'Off-peak · peak in 2h')
  assert.equal(chipText(phaseAt(at('2026-09-18T09:59:00Z'))), 'Peak · ends in 1m')
  assert.equal(chipText(phaseAt(at('2026-09-18T06:54:00Z'))), 'Peak · ends in 3h 6m')
  assert.equal(chipText(phaseAt(at('2026-09-18T10:00:00Z'))), 'Off-peak · peak in 2d 15h')
})

test('formatRemaining walks seconds, minutes, hours and days', () => {
  assert.equal(formatRemaining(0), '0s')
  assert.equal(formatRemaining(999), '0s')
  assert.equal(formatRemaining(45_000), '45s')
  assert.equal(formatRemaining(MINUTE), '1m')
  assert.equal(formatRemaining(12 * MINUTE + 30_000), '12m 30s')
  assert.equal(formatRemaining(45 * MINUTE + 12_000), '45m 12s')
  assert.equal(formatRemaining(HOUR), '1h')
  assert.equal(formatRemaining(HOUR + MINUTE), '1h 1m')
  assert.equal(formatRemaining(2 * 24 * HOUR + 15 * HOUR), '2d 15h')
  assert.equal(formatRemaining(25 * HOUR), '1d 1h')
})

test('only the official route is billed by the rule', () => {
  assert.equal(DEEPSEEK_PROVIDER, 'deepseek-official')
  assert.equal(isPeakRuleRoute('deepseek-official'), true)
  assert.equal(isPeakRuleRoute('pi-ai'), false, 'a reseller prices a deepseek-* model by its own rules')
  assert.equal(isPeakRuleRoute(undefined), false)
})

test('local windows convert UTC windows into the display zone', () => {
  const friday = at('2026-09-18T06:54:00Z')
  assert.deepEqual(localWindowsOfDay(friday, 'Europe/Moscow', 0), ['04:00–07:00', '09:00–13:00'])
  assert.deepEqual(localWindowsOfDay(friday, 'Europe/Moscow', 1), [], 'Saturday has no window')
  assert.deepEqual(localWindowsOfDay(friday, 'UTC', 0), ['01:00–04:00', '06:00–10:00'])
  assert.deepEqual(localWindowsOfDay(friday, 'Asia/Tokyo', 0), ['10:00–13:00', '15:00–19:00'])
  assert.deepEqual(localWindowsOfDay(friday, 'America/Los_Angeles', 0), ['18:00–21:00', '23:00–03:00'], 'a window may cross local midnight')
})

test('the panel quotes the table it encodes', () => {
  const friday = at('2026-09-18T06:54:00Z')
  const panel = panelModel({ nowMs: friday, timeZone: 'Europe/Moscow', route: { provider: 'deepseek-official', model: 'deepseek-flash' } })

  assert.equal(panel.zone, 'Europe/Moscow')
  assert.equal(panel.chipText, 'Peak · ends in 3h 6m')
  assert.equal(panel.lines.state, 'Now: peak pricing (×2)')
  assert.equal(panel.lines.route, 'deepseek-official · deepseek-flash')
  assert.equal(panel.lines.today, 'Today (Europe/Moscow): 04:00–07:00, 09:00–13:00')
  assert.equal(panel.lines.tomorrow, 'Tomorrow (Europe/Moscow): off-peak all day')
  assert.equal(panel.lines.utc, 'Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri')
  assert.equal(panel.lines.weekend, 'Weekends are off-peak all day.')
  assert.equal(panel.lines.price, 'Off-peak rates are half of peak rates.')
  assert.equal(panel.lines.nextChange, 'Next change: peak ends today at 13:00 (in 3h 6m)')
  assert.equal(panel.lines.source, 'Source: https://api-docs.deepseek.com/quick_start/pricing · verified 2026-09-18')
})

test('the panel reads correctly while waiting for a peak', () => {
  const saturday = at('2026-09-19T12:00:00Z')
  const panel = panelModel({ nowMs: saturday, timeZone: 'Europe/Moscow' })

  assert.equal(panel.lines.state, 'Now: off-peak pricing (×0.5)')
  assert.equal(panel.lines.today, 'Today (Europe/Moscow): off-peak all day')
  assert.equal(panel.lines.tomorrow, 'Tomorrow (Europe/Moscow): off-peak all day')
  assert.equal(panel.lines.nextChange, 'Next change: peak starts Mon at 04:00 (in 1d 13h)')
  assert.equal(panel.lines.route, undefined, 'no route known means no route line')
})

test('the effective route is next, falling back to lastUsed', () => {
  const official = { provider: 'deepseek-official', model: 'deepseek-flash' }
  const reseller = { provider: 'pi-ai', model: 'deepseek-v3' }

  assert.deepEqual(routeFromModelSelection({ lastUsed: official, next: reseller }), reseller, 'a pending pick wins')
  assert.deepEqual(routeFromModelSelection({ lastUsed: official, next: null }), official, 'a request already made')
  assert.deepEqual(routeFromModelSelection({ lastUsed: null, next: official }), official, 'a pick with no request yet')
  assert.deepEqual(
    routeFromModelSelection({ lastUsed: { ...official, reasoningEffort: 'high' }, next: null }),
    official,
    'the reasoning effort is not part of the route',
  )

  assert.equal(routeFromModelSelection({ lastUsed: null, next: null }), null, 'a session that never picked or requested')
  assert.equal(routeFromModelSelection({ next: { provider: 'deepseek-official' } }), null, 'an incomplete selection is not guessed')
  assert.equal(routeFromModelSelection(undefined), null)
  assert.equal(routeFromModelSelection(null), null)
  assert.equal(routeFromModelSelection({ state: 'loading' }), null)
})

test('diagnostic key names are capped and never throw on live values', () => {
  assert.deepEqual(shallowKeyNames({ lastUsed: 1, next: 2 }), ['lastUsed', 'next'])
  assert.deepEqual(shallowKeyNames(null), [])
  assert.deepEqual(shallowKeyNames('text'), [])
  assert.deepEqual(shallowKeyNames({ a: 1, b: 2, c: 3 }, 2), ['a', 'b'])
})

test('a session with no selection falls back to the catalog default', () => {
  const official = { provider: 'deepseek-official', model: 'deepseek-flash' }

  assert.deepEqual(routeFromCatalogDefault({ status: 'ready', value: { default: official, groups: [] }, error: null }), official)
  assert.equal(routeFromCatalogDefault({ status: 'loading', value: null, error: null }), null, 'not ready yet')
  assert.equal(routeFromCatalogDefault({ status: 'error', value: null, error: 'x' }), null)
  assert.equal(routeFromCatalogDefault({ status: 'ready', value: null }), null)
  assert.equal(routeFromCatalogDefault(undefined), null)
  assert.equal(routeFromCatalogDefault({ status: 'ready', value: { groups: [] } }), null, 'no default is not a guess')
})

test('an empty projection falls back to the catalog default, an absent one does not', () => {
  const official = { provider: 'deepseek-official', model: 'deepseek-flash' }
  const ready = { status: 'ready', value: { default: official }, error: null }
  const empty = { lastUsed: null, next: null }

  assert.deepEqual(effectiveRoute(empty, ready), official, 'read, but nothing recorded yet')
  assert.deepEqual(effectiveRoute({ lastUsed: official, next: null }, ready), official)
  assert.deepEqual(
    effectiveRoute({ lastUsed: official, next: { provider: 'pi-ai', model: 'deepseek-v3' } }, ready),
    { provider: 'pi-ai', model: 'deepseek-v3' },
    'a recorded selection always beats the default',
  )

  assert.equal(effectiveRoute(undefined, ready), null, 'the runtime never said which model this session uses')
  assert.equal(effectiveRoute(null, ready), null)
  assert.equal(effectiveRoute(empty, undefined), null, 'no catalog to read')
  assert.equal(effectiveRoute(empty, { status: 'loading', value: null, error: null }), null)
})

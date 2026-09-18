/**
 * The DeepSeek API peak/off-peak pricing rule, as a pure function of an instant.
 *
 * Rule as published (source below, verified 2026-09-18):
 *   "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday
 *    (all other hours are off-peak)."
 *   "Off-peak rates are half of the peak rates."
 *
 * The rule is stated in UTC — including its weekday — so every phase decision below is
 * made on UTC calendar fields. A local time zone is used for display only, which keeps
 * daylight-saving shifts out of the pricing logic by construction.
 *
 * No imports and no side effects: this module is what the tests pin, and what the
 * browser plugin is generated from.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const RULE = Object.freeze({
  sourceUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
  verifiedOn: '2026-09-18',
  /** Peak windows as `[startMinute, endMinute)` offsets from 00:00 UTC. */
  peakWindowsUtcMinutes: Object.freeze([
    Object.freeze([60, 240]), // 01:00-04:00 UTC
    Object.freeze([360, 600]), // 06:00-10:00 UTC
  ]),
  /** UTC weekdays that carry peak windows: 0=Sun … 6=Sat, so 1..5 is Monday-Friday. */
  peakWeekdaysUtc: Object.freeze([1, 2, 3, 4, 5]),
  /** Off-peak price as a fraction of the peak price. */
  offPeakRateRatio: 0.5,
  /** How long before a peak window starts the indicator warns (the yellow state). */
  warnLeadMs: 30 * MINUTE_MS,
})

/** The provider whose requests are billed by the published rule. */
export const DEEPSEEK_PROVIDER = 'deepseek-official'

/** Phases of the indicator, in the order a day walks through them. */
export const PHASE = Object.freeze({
  PEAK: 'peak',
  SOON: 'soon',
  OFF_PEAK: 'off-peak',
})

/**
 * Whether a session's route is billed by the published peak rule at all.
 * @param provider - provider id from the session's model selection.
 * @returns true only for the official DeepSeek route: a reseller serving a
 * `deepseek-*` model prices it by its own rules, so the indicator must stay silent.
 */
export function isPeakRuleRoute(provider) {
  return provider === DEEPSEEK_PROVIDER
}

/**
 * The route the next request will use, read from a session's `modelSelection` value.
 *
 * The projection's client view is `{ lastUsed, next }`, each a `{provider, model,
 * reasoningEffort?}` or null: `next` is the selection the next request should use
 * (already falling back to `lastUsed`), and `lastUsed` is what the latest recorded
 * request consumed. Both are null in a session that has neither picked a model nor
 * sent a request, which is why callers must supply a fallback.
 *
 * @param value - `modelSelection` projection view, as the runtime delivers it.
 * @returns the route, or null when no provider/model pair is present.
 */
export function routeFromModelSelection(value) {
  if (value === null || typeof value !== 'object') return null
  return routeOfSelection(value.next) ?? routeOfSelection(value.lastUsed)
}

/**
 * Read one `ModelSelection` leaf.
 * @param selection - a `{provider, model, reasoningEffort?}` value or null.
 * @returns `{provider, model}` when both are non-empty strings, else null.
 */
export function routeOfSelection(selection) {
  if (selection === null || typeof selection !== 'object') return null
  const provider = selection.provider
  const model = selection.model
  if (typeof provider !== 'string' || typeof model !== 'string') return null
  return { provider, model }
}

/**
 * The route a session with no recorded selection will use, read from the model
 * catalog's snapshot.
 *
 * A session that has neither picked a model nor sent a request carries
 * `{lastUsed: null, next: null}`, and the model picker resolves the composer's current
 * model as `listing.next ?? catalog.default`. This mirrors that rule, so a fresh session
 * is described by the same route DSH would actually send.
 *
 * @param snapshot - `modelDirectories.catalog.store` snapshot: `{status, value, error}`.
 * @returns the default route, or null while the catalog is unavailable.
 */
export function routeFromCatalogDefault(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object') return null
  const catalog = snapshot.value
  if (catalog === null || typeof catalog !== 'object') return null
  return routeOfSelection(catalog.default)
}

/**
 * The route the session's next request will use, combining both sources.
 *
 * The fallback to the catalog default applies only when the projection was *read* and
 * records no selection. An absent projection means the runtime did not tell us which
 * model this session uses at all — then the indicator stays hidden rather than
 * announcing a price for a route we cannot see. The model picker draws the same line:
 * it falls back to `catalog.default` for an empty projection, but treats a missing
 * projection as an unavailable catalog.
 *
 * @param projection - `modelSelection` view, or undefined when the runtime has none.
 * @param catalogSnapshot - model catalog store snapshot, or undefined when unreadable.
 * @returns the route, or null when it cannot be established without guessing.
 */
export function effectiveRoute(projection, catalogSnapshot) {
  const recorded = routeFromModelSelection(projection)
  if (recorded !== null) return recorded
  if (projection === undefined || projection === null) return null
  return routeFromCatalogDefault(catalogSnapshot)
}

/** Shallow key names of a live value, capped; diagnostics only. */
export function shallowKeyNames(value, cap = 12) {
  if (value === null || typeof value !== 'object') return []
  try {
    return Object.keys(value).slice(0, cap)
  } catch {
    return []
  }
}

/** Wall-clock instant of 00:00 UTC on the UTC day containing `epochMs`. */
function utcDayStart(epochMs) {
  return Math.floor(epochMs / DAY_MS) * DAY_MS
}

/** Peak windows of one UTC day, as absolute instants; empty on Saturday and Sunday. */
function peakWindowsOfUtcDay(dayStartMs) {
  if (!RULE.peakWeekdaysUtc.includes(new Date(dayStartMs).getUTCDay())) return []
  return RULE.peakWindowsUtcMinutes.map(([fromMinute, toMinute]) => ({
    startMs: dayStartMs + fromMinute * MINUTE_MS,
    endMs: dayStartMs + toMinute * MINUTE_MS,
  }))
}

/**
 * Resolve the indicator state for one instant.
 *
 * The two peak windows of a weekday are separated by a genuine off-peak gap
 * (04:00-06:00 UTC), so "the next peak" is not always tomorrow's first window.
 *
 * @param nowMs - instant to describe, epoch milliseconds.
 * @returns `{ phase, untilMs, changeAtMs, nextPeakAtMs }`, where `untilMs` is the
 * distance to the next transition and `changeAtMs` its instant. `phase` is `peak`
 * while a window is open, `soon` inside the warning lead before a window starts, and
 * `off-peak` otherwise.
 */
export function phaseAt(nowMs) {
  const dayStart = utcDayStart(nowMs)
  let active = null
  let next = null

  // Yesterday covers a window still open past UTC midnight in no case today, but it
  // keeps the search independent of that assumption; eight days always contain the
  // next window, since the longest gap is Friday 10:00 UTC -> Monday 01:00 UTC.
  for (let dayOffset = -1; dayOffset <= 8; dayOffset += 1) {
    for (const window of peakWindowsOfUtcDay(dayStart + dayOffset * DAY_MS)) {
      if (active === null && nowMs >= window.startMs && nowMs < window.endMs) active = window
      if (window.startMs > nowMs && (next === null || window.startMs < next.startMs)) next = window
    }
  }

  if (active !== null) {
    return {
      phase: PHASE.PEAK,
      untilMs: active.endMs - nowMs,
      changeAtMs: active.endMs,
      nextPeakAtMs: next === null ? null : next.startMs,
    }
  }

  const untilMs = next.startMs - nowMs
  return {
    phase: untilMs <= RULE.warnLeadMs ? PHASE.SOON : PHASE.OFF_PEAK,
    untilMs,
    changeAtMs: next.startMs,
    nextPeakAtMs: next.startMs,
  }
}

/**
 * Human-readable duration: minutes normally, seconds inside the last hour, days when
 * the wait runs past a day (the weekend gap is 2d 15h long).
 * @param durationMs - non-negative duration.
 * @returns for example `45s`, `12m 30s`, `1h 23m`, `2d 15h`.
 */
export function formatRemaining(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

/**
 * Collapsed-chip copy for one state.
 * @param state - value returned by {@link phaseAt}.
 * @returns for example `Off-peak · peak in 2h 15m`, `Peak soon · 12m 30s`,
 * `Peak · ends in 3h 6m`.
 */
export function chipText(state) {
  const remaining = formatRemaining(state.untilMs)
  if (state.phase === PHASE.PEAK) return `Peak · ends in ${remaining}`
  if (state.phase === PHASE.SOON) return `Peak soon · ${remaining}`
  return `Off-peak · peak in ${remaining}`
}

/** The IANA zone the browser (or Node) reports, falling back to UTC. */
export function resolveTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof zone === 'string' && zone.length > 0 ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Set once when the runtime turns out to lack usable `Intl` zone data. */
let intlAvailable = true

/** UTC fallback fields, used only when `Intl` cannot format a zone. */
function utcParts(epochMs) {
  const date = new Date(epochMs)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return {
    dateKey: `${date.getUTCFullYear()}-${month}-${day}`,
    timeLabel: `${hours}:${minutes}`,
    weekdayShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()],
  }
}

/** Calendar/time fields of one instant inside a zone, with `24:00` never produced. */
function partsInZone(epochMs, timeZone) {
  if (!intlAvailable) return utcParts(epochMs)
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    })
    const parts = {}
    for (const part of formatter.formatToParts(new Date(epochMs))) parts[part.type] = part.value
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      timeLabel: `${parts.hour}:${parts.minute}`,
      weekdayShort: parts.weekday,
    }
  } catch {
    intlAvailable = false
    return utcParts(epochMs)
  }
}

/** `HH:MM` for a minute-of-day offset from 00:00 UTC. */
function formatMinuteOfDayUtc(minuteOfDay) {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const minutes = String(minuteOfDay % 60).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Peak windows of one local calendar day, as local `HH:MM-HH:MM` labels.
 *
 * Each window is formatted from its own UTC instants, so the labels follow the zone's
 * daylight-saving rules without any wall-clock-to-UTC arithmetic here.
 *
 * @param nowMs - instant that defines "today" in the zone.
 * @param timeZone - IANA zone name.
 * @param dayOffset - 0 for today, 1 for tomorrow.
 * @returns labels in window order; empty when that local day has no peak window.
 */
export function localWindowsOfDay(nowMs, timeZone, dayOffset) {
  const targetDateKey = partsInZone(nowMs + dayOffset * DAY_MS, timeZone).dateKey
  const dayStart = utcDayStart(nowMs)
  const labels = []

  // A local day can start on the previous UTC day (east of UTC) and end on the next.
  for (let offset = -1; offset <= 2; offset += 1) {
    for (const window of peakWindowsOfUtcDay(dayStart + offset * DAY_MS)) {
      const start = partsInZone(window.startMs, timeZone)
      if (start.dateKey !== targetDateKey) continue
      const end = partsInZone(window.endMs, timeZone)
      labels.push(`${start.timeLabel}–${end.timeLabel}`)
    }
  }
  return labels.sort()
}

/** `today`, `tomorrow`, or a short weekday name for a transition instant. */
function dayWordFor(epochMs, nowMs, timeZone) {
  const target = partsInZone(epochMs, timeZone)
  if (target.dateKey === partsInZone(nowMs, timeZone).dateKey) return 'today'
  if (target.dateKey === partsInZone(nowMs + DAY_MS, timeZone).dateKey) return 'tomorrow'
  return target.weekdayShort
}

/**
 * Every string the expanded panel shows, derived from {@link RULE} where the rule
 * itself is quoted, so copy and table cannot drift apart.
 *
 * @param input.nowMs - instant to describe.
 * @param input.timeZone - IANA zone for the local lines.
 * @param input.route - `{ provider, model }` of the session, when known.
 * @returns `{ zone, state, chipText, lines }` with one entry per panel line.
 */
export function panelModel({ nowMs, timeZone, route }) {
  const zone = timeZone ?? resolveTimeZone()
  const state = phaseAt(nowMs)
  const windowsText = RULE.peakWindowsUtcMinutes
    .map(([fromMinute, toMinute]) => `${formatMinuteOfDayUtc(fromMinute)}–${formatMinuteOfDayUtc(toMinute)}`)
    .join(' and ')
  const today = localWindowsOfDay(nowMs, zone, 0)
  const tomorrow = localWindowsOfDay(nowMs, zone, 1)
  const endsOrStarts = state.phase === PHASE.PEAK ? 'peak ends' : 'peak starts'
  const changeAt = partsInZone(state.changeAtMs, zone)

  return {
    zone,
    state,
    chipText: chipText(state),
    lines: {
      state: state.phase === PHASE.PEAK ? 'Now: peak pricing (×2)' : 'Now: off-peak pricing (×0.5)',
      route: route === undefined ? undefined : `${route.provider} · ${route.model}`,
      today: `Today (${zone}): ${today.length > 0 ? today.join(', ') : 'off-peak all day'}`,
      tomorrow: `Tomorrow (${zone}): ${tomorrow.length > 0 ? tomorrow.join(', ') : 'off-peak all day'}`,
      utc: `Peak hours: ${windowsText} UTC, Mon–Fri`,
      weekend: 'Weekends are off-peak all day.',
      price: 'Off-peak rates are half of peak rates.',
      nextChange: `Next change: ${endsOrStarts} ${dayWordFor(state.changeAtMs, nowMs, zone)} at ${changeAt.timeLabel} (in ${formatRemaining(state.untilMs)})`,
      source: `Source: ${RULE.sourceUrl} · verified ${RULE.verifiedOn}`,
    },
  }
}

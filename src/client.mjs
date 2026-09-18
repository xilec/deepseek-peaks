import React from 'react'

import {
  chipText,
  effectiveRoute,
  isPeakRuleRoute,
  panelModel,
  phaseAt,
  resolveTimeZone,
  shallowKeyNames,
} from './peaks-core.mjs'

/** Projection key owning the session's current model selection. */
const MODEL_KEY = 'modelSelection'

/**
 * Two additive slot entries, one per surface, and exactly one of them renders at a
 * time: the header chip for a session that already has content, and a floating chip for
 * a fresh (`blank`) session whose header is hidden. Both read the same `useSession`
 * fields, so a chip cannot disappear from both surfaces at once.
 *
 * The floating chip lives in the composer card's overlay anchor — an absolutely
 * positioned, zero-height box on the card's top edge — so it is drawn above the card
 * without contributing a row to the composer stack, which would otherwise push the
 * whole blank-session hero upwards.
 */
const HEADER_ENTRY = { name: 'conversation.session.header.actions', id: 'deepseek-peaks', order: -20 }
const OVERLAY_ENTRY = { name: 'conversation.input.overlay', id: 'deepseek-peaks', order: 10 }

const CSS = `
.dspk-anchor{position:relative;display:inline-flex}
.dspk-float{position:absolute;right:18px;bottom:6px;z-index:1}
.dspk-chip{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:24px;padding:0 10px 2px;border:none;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;white-space:nowrap;cursor:pointer}
.dspk-chip--peak{background:#7d2626;color:#fff}
.dspk-chip--soon{background:#7a5a06;color:#fff}
.dspk-chip--off-peak{background:#1d6b45;color:#fff}
.dspk-chip--peak:hover{background:#8e2c2c}
.dspk-chip--soon:hover{background:#8f6a08}
.dspk-chip--off-peak:hover{background:#237a50}
.dspk-catch{position:fixed;inset:0;z-index:60}
.dspk-panel{position:absolute;z-index:61;display:flex;flex-direction:column;gap:3px;width:max-content;max-width:min(420px,88vw);padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 6px 24px rgba(0,0,0,.16);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;text-align:left}
.dspk-panel--below{top:calc(100% + 6px);left:0}
.dspk-panel--above{bottom:calc(100% + 6px);right:0}
.dspk-title{color:var(--dsw-alias-label-primary);font-weight:600}
`

/**
 * Build the plugin. The browser entry imports this factory and supplies `styles`; the
 * dynamic Package supplies the same `styles` builtin plus a diagnostic `report`.
 *
 * @param deps.styles - `{ insert(css) }` returning a disposer.
 * @param deps.report - optional diagnostic sink, used only by the development probe.
 */
export function createPlugin(deps) {
  const insertStyles = deps.styles.insert.bind(deps.styles)
  const report = deps.report ?? (() => {})
  const zone = resolveTimeZone()
  const reported = new Set()
  let ctxRef = null

  /**
   * The model catalog snapshot — the same source the composer's model picker reads its
   * default from. Read through the dynamic facade; an unreadable catalog yields
   * undefined, which keeps the indicator hidden rather than guessing a route.
   */
  function catalogSnapshot() {
    const directories = ctxRef === null ? undefined : ctxRef.get('modelDirectories')
    if (directories === undefined) return undefined
    try {
      return directories.catalog.store.getSnapshot()
    } catch {
      return undefined
    }
  }

  function panelLines(nowMs, route) {
    const model = panelModel({ nowMs, timeZone: zone, route })
    return [
      model.lines.route,
      model.lines.state,
      model.lines.today,
      model.lines.tomorrow,
      model.lines.utc,
      model.lines.weekend,
      model.lines.price,
      model.lines.nextChange,
      model.lines.source,
    ].filter((line) => typeof line === 'string')
  }

  function createChip(ctx, { forNewSession }) {
    return function PeakChip(props) {
      const standardProp = (name, ...args) => {
        try {
          return typeof props[name] === 'function' ? props[name](...args) : undefined
        } catch {
          return undefined
        }
      }
      const isFreshSession =
        standardProp('useSession', (snapshot) => snapshot.blank && !snapshot.running && !snapshot.promptAttempted) === true
      const projection = standardProp('useProjection', MODEL_KEY)
      const [open, setOpen] = React.useState(false)
      const [nowMs, setNowMs] = React.useState(() => Date.now())

      React.useEffect(() => ctx.interval(() => setNowMs(Date.now()), 1000), [])

      const route = effectiveRoute(projection, catalogSnapshot())
      reportOnce(report, reported, {
        stage: 'render',
        slot: forNewSession ? 'overlay' : 'header',
        propKeys: Object.keys(props).slice(0, 24),
        hasProjectionHook: typeof props.useProjection,
        hasSessionHook: typeof props.useSession,
        projectionType: typeof projection,
        projectionKeys: shallowKeyNames(projection),
        route,
        isFreshSession,
        zone,
      })

      if (isFreshSession !== forNewSession) return null
      if (route === null || !isPeakRuleRoute(route.provider)) return null

      const state = phaseAt(nowMs)
      const text = chipText(state)
      const chip = React.createElement(
        'button',
        {
          type: 'button',
          className: `dspk-chip dspk-chip--${state.phase}`,
          'aria-expanded': open,
          'aria-label': `DeepSeek peak pricing: ${text}`,
          onClick: () => setOpen((value) => !value),
        },
        text,
      )

      const anchor =
        open === false
          ? React.createElement('div', { className: 'dspk-anchor' }, chip)
          : React.createElement(
              'div',
              { className: 'dspk-anchor' },
              chip,
              React.createElement('div', { className: 'dspk-catch', onClick: () => setOpen(false) }),
              React.createElement(
                'div',
                { className: `dspk-panel ${forNewSession ? 'dspk-panel--above' : 'dspk-panel--below'}`, role: 'dialog', 'aria-label': 'DeepSeek peak hours' },
                React.createElement('div', { className: 'dspk-title' }, 'DeepSeek peak hours'),
                panelLines(nowMs, route).map((line, index) => React.createElement('div', { key: `${index}` }, line)),
              ),
            )

      return forNewSession ? React.createElement('div', { className: 'dspk-float' }, anchor) : anchor
    }
  }

  return {
    inject: ['timer'],
    apply(ctx) {
      ctxRef = ctx
      const slots = ctx.get('slots')
      report({ stage: 'apply', hasSlots: slots !== undefined, hasInterval: typeof ctx.interval, zone })
      if (slots === undefined) return
      const removeStyles = insertStyles(CSS)
      ctx.effect(() => removeStyles, 'deepseek-peaks: styles')

      // `ctx.effect` keeps each injection on this fiber, so stop, update and undefine
      // withdraw both occupants instead of leaving a half-mounted chip behind.
      ctx.effect(
        () => slots.inject(HEADER_ENTRY.name, () => slots.register(HEADER_ENTRY, createChip(ctx, { forNewSession: false }))),
        'deepseek-peaks: header chip',
      )
      ctx.effect(
        () => slots.inject(OVERLAY_ENTRY.name, () => slots.register(OVERLAY_ENTRY, createChip(ctx, { forNewSession: true }))),
        'deepseek-peaks: composer overlay chip',
      )
      ctx.effect(() => () => reported.clear(), 'deepseek-peaks: diagnostics')
    },
  }
}

/** One diagnostic record per distinct shape, route and placement; never throws into render. */
function reportOnce(report, reported, payload) {
  const route = payload.route === null || payload.route === undefined ? '-' : `${payload.route.provider}|${payload.route.model}`
  const key = `${payload.stage}|${payload.slot ?? ''}|${route}|${payload.isFreshSession}|${payload.projectionType}`
  if (reported.has(key)) return
  reported.add(key)
  try {
    report(payload)
  } catch {
    // Diagnostics never break the indicator.
  }
}

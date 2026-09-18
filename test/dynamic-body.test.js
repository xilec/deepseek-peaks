import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildDynamicBody } from '../tools/dynamic-body.mjs'

/**
 * Exercise the artifact that actually ships in the browser: the generated dynamic
 * Client body, evaluated with stub builtins. This covers what the core tests cannot —
 * slot registration, the two surfaces, and the route gating.
 */

const FIXED_NOW = Date.parse('2026-09-18T06:54:00Z') // Friday, inside the 06:00-10:00 UTC peak
const FIXED_ZONE = 'Europe/Moscow'

/** A Date that keeps real calendar behaviour but freezes "now". */
class FrozenDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW)
    else super(...args)
  }

  static now() {
    return FIXED_NOW
  }
}

/** An Intl that reports a fixed zone for the no-argument call the core makes. */
const ZoneIntl = {
  DateTimeFormat: function zoneFormat(...args) {
    if (args.length === 0) return { resolvedOptions: () => ({ timeZone: FIXED_ZONE }) }
    return new Intl.DateTimeFormat(...args)
  },
}

/** Minimal React stub: element records plus the hooks the plugin actually uses. */
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  return textOf(node.children)
}

function findClass(node, className) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClass(child, className)
      if (found !== null) return found
    }
    return null
  }
  if (typeof node.props.className === 'string' && node.props.className.split(' ').includes(className)) return node
  return findClass(node.children, className)
}

/** Evaluate the generated body and collect what `apply` registers. */
function mount({ react = ReactStub, catalog = { status: 'ready', value: { default: { provider: 'deepseek-official', model: 'deepseek-flash' }, groups: [] }, error: null } } = {}) {
  const runner = new Function('React', 'host', 'styles', 'console', 'Date', 'Intl', buildDynamicBody())
  const registered = []
  const effects = []
  const inserted = []

  const slots = {
    inject: (name, callback) => {
      callback()
      return () => {}
    },
    register: (entry, component) => {
      registered.push({ name: entry.name, entry, component })
      return () => {}
    },
  }
  const modelDirectories = {
    catalog: { store: { getSnapshot: () => catalog } },
  }
  const ctx = {
    get: (name) => (name === 'slots' ? slots : name === 'modelDirectories' ? modelDirectories : undefined),
    interval: () => () => {},
    effect: (callback) => {
      const disposer = callback()
      effects.push(disposer)
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
  }

  const plugin = runner(
    react,
    { call: () => Promise.resolve(null) },
    {
      insert: (css) => {
        inserted.push(css)
        return () => {}
      },
    },
    { log: () => {}, error: () => {} },
    FrozenDate,
    ZoneIntl,
  )
  plugin.apply(ctx)
  return { plugin, registered, effects, inserted }
}

/** Props a session-scoped slot hands a chip component. */
function sessionProps({ blank = false, provider = 'deepseek-official', model = 'deepseek-flash', projection = 'recorded' } = {}) {
  return {
    sessionId: 'session-1',
    useSession: (selector) => selector({ blank, running: false, promptAttempted: false }),
    useProjection: () => {
      if (projection === 'recorded') return { lastUsed: { provider, model }, next: { provider, model } }
      if (projection === 'absent') return undefined
      return projection
    },
  }
}

test('the generated body is plain JavaScript and returns a plugin owning its timer', () => {
  const { plugin, registered, effects } = mount()

  assert.deepEqual(plugin.inject, ['timer'])
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(
    registered.map((entry) => entry.name),
    ['conversation.session.header.actions', 'conversation.input.overlay'],
  )
  assert.equal(registered[0].component.name, 'PeakChip')
  assert.deepEqual(registered[0].entry, { name: 'conversation.session.header.actions', id: 'deepseek-peaks', order: -20 })
  assert.deepEqual(registered[1].entry, { name: 'conversation.input.overlay', id: 'deepseek-peaks', order: 10 })
  assert.equal(effects.length, 4, 'styles, two slot injections and the diagnostics set are owned by the fiber')
  for (const disposer of effects) assert.equal(typeof disposer, 'function')
})

test('the header chip shows the live peak state for a session in progress', () => {
  const HeaderChip = mount().registered[0].component
  const tree = HeaderChip(sessionProps())

  assert.notEqual(findClass(tree, 'dspk-chip'), null)
  assert.equal(findClass(tree, 'dspk-panel'), null, 'collapsed until clicked')
  assert.deepEqual(textOf(tree), ['Peak · ends in 3h 6m'])
  assert.match(findClass(tree, 'dspk-chip').props.className, /dspk-chip--peak/)
})

test('a fresh session uses the floating chip, and never both surfaces at once', () => {
  const [header, floating] = mount().registered.map((entry) => entry.component)

  assert.equal(header(sessionProps({ blank: true })), null, 'the header is hidden for a fresh session')
  const floatingTree = floating(sessionProps({ blank: true }))
  assert.notEqual(findClass(floatingTree, 'dspk-chip'), null)
  assert.notEqual(findClass(floatingTree, 'dspk-float'), null, 'floating above the composer, outside its layout')

  assert.equal(floating(sessionProps({ blank: false })), null, 'the floating chip yields to the header chip')
  assert.notEqual(header(sessionProps({ blank: false })), null)
})

test('a route the rule does not bill keeps the indicator silent', () => {
  const [header, floating] = mount().registered.map((entry) => entry.component)

  assert.equal(header(sessionProps({ provider: 'pi-ai' })), null, 'a reseller route is not DeepSeek pricing')
  assert.equal(floating(sessionProps({ blank: true, provider: 'pi-ai' })), null)
  assert.notEqual(header(sessionProps({ provider: 'deepseek-official' })), null)
})

test('an unknown selection hides the chip, while a read-but-empty one uses the default', () => {
  const HeaderChip = mount().registered[0].component
  const base = { useSession: (selector) => selector({ blank: false, running: false, promptAttempted: false }) }

  assert.equal(HeaderChip({ ...base, sessionId: 'session-1', useProjection: () => undefined }), null, 'the runtime has no projection')
  assert.equal(HeaderChip({ ...base, sessionId: 'session-1' }), null, 'no projection prop at all')
  assert.notEqual(
    HeaderChip({ ...base, sessionId: 'session-1', useProjection: () => ({ lastUsed: null, next: null }) }),
    null,
    'a session that simply has not picked a model yet is described by the catalog default',
  )
})

test('the revealed panel carries the rule, the local windows and the source', () => {
  const reactWithOpenPanel = {
    ...ReactStub,
    useState: (initial) => {
      if (initial === false) return [true, () => {}]
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
  }
  const [header, floating] = mount({ react: reactWithOpenPanel }).registered.map((entry) => entry.component)

  assert.notEqual(findClass(header(sessionProps()), 'dspk-panel--below'), null, 'the header panel opens downward')
  const panel = findClass(floating(sessionProps({ blank: true })), 'dspk-panel')
  assert.notEqual(panel, null)
  assert.match(panel.props.className, /dspk-panel--above/, 'the floating panel opens upward over the composer')

  const lines = textOf(panel)
  assert.ok(lines.includes('DeepSeek peak hours'))
  assert.ok(lines.includes('deepseek-official · deepseek-flash'))
  assert.ok(lines.includes('Now: peak pricing (×2)'))
  assert.ok(lines.includes('Today (Europe/Moscow): 04:00–07:00, 09:00–13:00'), `lines: ${JSON.stringify(lines)}`)
  assert.ok(lines.includes('Tomorrow (Europe/Moscow): off-peak all day'))
  assert.ok(lines.includes('Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri'))
  assert.ok(lines.includes('Weekends are off-peak all day.'))
  assert.ok(lines.includes('Off-peak rates are half of peak rates.'))
  assert.ok(lines.includes('Next change: peak ends today at 13:00 (in 3h 6m)'))
  assert.ok(lines.includes('Source: https://api-docs.deepseek.com/quick_start/pricing · verified 2026-09-18'))
})

test('a session with no recorded selection uses the catalog default', () => {
  const [header, floating] = mount().registered.map((entry) => entry.component)
  const nothingPicked = { lastUsed: null, next: null }

  const floatingTree = floating(sessionProps({ blank: true, projection: nothingPicked }))
  assert.notEqual(findClass(floatingTree, 'dspk-chip'), null, 'a fresh session still shows the indicator')
  assert.notEqual(findClass(floatingTree, 'dspk-chip--peak'), null, 'the fixture instant is inside the peak window')

  assert.notEqual(header(sessionProps({ projection: nothingPicked })), null, 'an established session falls back the same way')
  assert.deepEqual(textOf(floatingTree), ['Peak · ends in 3h 6m'])
})

test('a catalog default outside the rule keeps the indicator silent too', () => {
  const resellerCatalog = { status: 'ready', value: { default: { provider: 'pi-ai', model: 'deepseek-v3' } }, error: null }
  const [header, floating] = mount({ catalog: resellerCatalog }).registered.map((entry) => entry.component)
  const nothingPicked = { lastUsed: null, next: null }

  assert.equal(floating(sessionProps({ blank: true, projection: nothingPicked })), null)
  assert.equal(header(sessionProps({ projection: nothingPicked })), null)
})

test('an unreadable catalog hides the chip instead of guessing', () => {
  const [header] = mount({ catalog: { status: 'loading', value: null, error: null } }).registered.map((entry) => entry.component)

  assert.equal(header(sessionProps({ projection: { lastUsed: null, next: null } })), null, 'an empty projection with no catalog')
  assert.equal(header(sessionProps({ projection: 'absent' })), null, 'an absent projection is never guessed, catalog or not')
})

test('the chip palette is fixed rather than derived from theme aliases', () => {
  const css = mount().inserted.join('\n')

  assert.match(css, /\.dspk-chip--peak\{background:#7d2626;color:#fff\}/)
  assert.match(css, /\.dspk-chip--soon\{background:#7a5a06;color:#fff\}/)
  assert.match(css, /\.dspk-chip--off-peak\{background:#1d6b45;color:#fff\}/)
  assert.equal(css.includes('color-mix'), false, 'a tinted alias would drift with the theme')
})

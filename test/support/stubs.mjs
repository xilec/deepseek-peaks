/**
 * Fixtures shared by the suites that exercise a plugin artifact — the generated dynamic
 * body and the built browser bundle — against stub builtins, rather than the sources.
 */

export const FIXED_NOW = Date.parse('2026-09-18T06:54:00Z') // Friday, inside the 06:00-10:00 UTC peak
export const FIXED_ZONE = 'Europe/Moscow'

/** A Date that keeps real calendar behaviour but freezes "now". */
export class FrozenDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_NOW)
    else super(...args)
  }

  static now() {
    return FIXED_NOW
  }
}

/** An Intl that reports a fixed zone for the no-argument call the core makes. */
export const ZoneIntl = {
  DateTimeFormat: function zoneFormat(...args) {
    if (args.length === 0) return { resolvedOptions: () => ({ timeZone: FIXED_ZONE }) }
    return new Intl.DateTimeFormat(...args)
  },
}

/** Minimal React stub: element records plus the hooks the plugin actually uses. */
export const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

/** Every string in a rendered tree, in order. */
export function textOf(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  return textOf(node.children)
}

/** The first node in the tree whose className list contains `className`. */
export function findClass(node, className) {
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

/** Props a session-scoped slot hands a chip component. */
export function sessionProps({ blank = false, provider = 'deepseek-official', model = 'deepseek-flash', projection = 'recorded' } = {}) {
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

/** A `<style>`-owning document stub: the CSS owner appends one element to `head`. */
export function createFakeDocument() {
  const styles = []
  const head = { children: [], append: (element) => head.children.push(element) }
  return {
    styles,
    head,
    createElement(tagName) {
      const element = {
        tagName,
        attributes: {},
        textContent: '',
        removed: false,
        setAttribute: (name, value) => {
          element.attributes[name] = value
        },
        remove: () => {
          element.removed = true
        },
      }
      styles.push(element)
      return element
    },
  }
}

/** The `ctx` a client plugin receives: the two read services plus the timer and effects. */
export function createCtx({ modelDirectories, slots, onEffect = () => {} } = {}) {
  return {
    get: (name) => (name === 'slots' ? slots : name === 'modelDirectories' ? modelDirectories : undefined),
    interval: () => () => {},
    effect: (callback) => {
      const disposer = callback()
      onEffect(disposer)
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
  }
}

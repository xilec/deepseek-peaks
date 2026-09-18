import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildPackage } from '../tools/build-package.mjs'
import { ReactStub, createCtx, createFakeDocument, findClass, sessionProps, textOf } from './support/stubs.mjs'

/**
 * The installable package, as opposed to the dynamic Cordis Package the development loop
 * uses: `lib/client.js` is what a profile actually serves to the browser, so it gets the
 * same treatment — loaded the way the page loads it and mounted against stub services.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** Register the built bundle the way the page does, then materialize its factory. */
function materializeBundle({ react = ReactStub, document = createFakeDocument() } = {}) {
  const registrations = []
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  const source = readFileSync(join(root, manifest.exports['./client']), 'utf8')

  // The bundle is a classic script: give it the two globals it reaches for.
  new Function('window', 'document', source)(window, document)

  assert.equal(registrations.length, 1, 'a bundle registers exactly one factory')
  const registration = registrations[0]
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return react
    throw new Error(`the bundle requested a module outside the client baseline: ${specifier}`)
  })
  return { registration, exports, document }
}

const DEFAULT_CATALOG = {
  status: 'ready',
  value: { default: { provider: 'deepseek-official', model: 'deepseek-flash' }, groups: [] },
  error: null,
}

/** Materialize and activate the bundle against the stub services. */
function mountBundle({ react = ReactStub, document = createFakeDocument(), catalog = DEFAULT_CATALOG } = {}) {
  const { registration, exports } = materializeBundle({ react, document })
  const registered = []
  const effects = []
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
  const modelDirectories = { catalog: { store: { getSnapshot: () => catalog } } }

  exports.apply(createCtx({ modelDirectories, slots, onEffect: (disposer) => effects.push(disposer) }))

  return { registration, exports, registered, effects, document, inserted: document.styles[0]?.textContent ?? '' }
}

test('the built artifacts are in step with the sources', () => {
  const built = buildPackage()

  for (const file of built.files) {
    assert.equal(readFileSync(join(root, file.path), 'utf8'), file.text, `${file.path} is stale — run npm run build`)
  }
})

test('the manifest declares what the client module system looks for', () => {
  assert.equal(typeof manifest.name, 'string')
  assert.equal(manifest.dsh?.client?.platform, 'web', 'the browser roster is keyed by this declaration')
  assert.equal(typeof manifest.exports['./client'], 'string', 'the bundle path is resolved from this export')
  assert.equal(manifest.main.replace(/^\.\//, ''), manifest.exports['.'].replace(/^\.\//, ''), 'the Host row imports the package root')

  // The bundle must be a single file: the shell serves it as a classic script.
  assert.equal(readFileSync(join(root, manifest.exports['./client']), 'utf8').includes('\nimport '), false)
})

test('the bundle registers one factory under the package name and exports a plugin', () => {
  const { registration, exports } = materializeBundle()

  assert.equal(registration.id, manifest.name, 'the registration key must be the package name the row mounts')
  assert.equal(typeof registration.factory, 'function')
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['timer', 'slots'])
})

test('the bundle requests nothing beyond the client baseline', () => {
  const source = readFileSync(join(root, manifest.exports['./client']), 'utf8')
  const requested = [...source.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2])

  assert.deepEqual([...new Set(requested)], ['react'], 'react is a seeded baseline module; anything else needs dsh.client.external')
})

test('the bundle mounts the same two surfaces as the dynamic body', () => {
  const { registered, effects } = mountBundle()

  assert.deepEqual(
    registered.map((entry) => entry.name),
    ['conversation.session.header.actions', 'conversation.input.overlay'],
  )
  assert.deepEqual(registered[0].entry, { name: 'conversation.session.header.actions', id: 'deepseek-peaks', order: -20 })
  assert.deepEqual(registered[1].entry, { name: 'conversation.input.overlay', id: 'deepseek-peaks', order: 10 })

  const [header, floating] = registered.map((entry) => entry.component)
  assert.notEqual(findClass(header(sessionProps()), 'dspk-chip'), null)
  assert.equal(findClass(header(sessionProps({ provider: 'pi-ai' })), 'dspk-chip'), null, 'a reseller route stays silent')
  assert.equal(header(sessionProps({ blank: true })), null, 'the header yields to the floating chip')
  assert.notEqual(findClass(floating(sessionProps({ blank: true })), 'dspk-float'), null)

  assert.equal(effects.length, 4, 'styles, two slot injections and the diagnostics set are owned by the fiber')
  for (const disposer of effects) assert.equal(typeof disposer, 'function')
})

test('the bundle renders the panel from the rule it ships', () => {
  const reactWithOpenPanel = {
    ...ReactStub,
    useState: (initial) => {
      if (initial === false) return [true, () => {}]
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
  }
  const panel = findClass(mountBundle({ react: reactWithOpenPanel }).registered[0].component(sessionProps()), 'dspk-panel')

  assert.notEqual(panel, null)
  const lines = textOf(panel)
  assert.ok(lines.includes('Peak hours: 01:00–04:00 and 06:00–10:00 UTC, Mon–Fri'))
  assert.ok(lines.includes('Source: https://api-docs.deepseek.com/quick_start/pricing · verified 2026-09-18'))
})

test('the stylesheet lives in a <style> element this plugin owns', () => {
  const { document, inserted, effects } = mountBundle()

  assert.equal(document.styles.length, 1, 'one stylesheet per activation')
  const element = document.styles[0]
  assert.equal(element.tagName, 'style')
  assert.equal(element.attributes['data-plugin'], 'deepseek-peaks', 'the module loader attributes injected CSS by this tag')
  assert.equal(element.attributes['data-plugin-css'], 'deepseek-peaks')
  assert.match(inserted, /\.dspk-chip--peak\{background:#7d2626;color:#fff\}/)

  effects[0]()
  assert.equal(element.removed, true, 'disposing the fiber removes the stylesheet')
})

test('the Host half is a plugin that contributes nothing', async () => {
  const host = await import(pathToFileURL(join(root, manifest.main)).href)

  assert.equal(typeof host.apply, 'function')
  assert.equal(host.apply.length, 0)
})

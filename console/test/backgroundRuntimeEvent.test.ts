import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { createEvent, getRequestURL } from 'h3'

// Nitro's runtime entry requires its generated virtual modules. Substitute only
// useEvent so the production helper can run in the repository's plain Node tests.
const source = stripTypeScriptTypes(readFileSync(new URL('../server/utils/backgroundRuntimeEvent.ts', import.meta.url), 'utf8'))
  .replace(/^import .* from 'nitropack\/runtime';?\s*$/m, '')
  .replace(/^import .* from 'h3';?\s*$/m, '')
  .replace('export function getBackgroundRuntimeEvent', 'function getBackgroundRuntimeEvent')
const load = (useEvent: () => unknown) => new Function('useEvent', 'createEvent', `${source}\nreturn getBackgroundRuntimeEvent;`)(useEvent, createEvent) as () => ReturnType<typeof createEvent>

test('startup without async request context supports Nitro runtime-config caching', () => {
  const getEvent = load(() => {
    throw new Error('No async request context')
  })
  const event = getEvent()
  assert.deepEqual(event.context, { nitro: {} })
  assert.doesNotThrow(() => {
    event.context.nitro!.runtimeConfig = { fixture: true }
  })
  assert.equal(getRequestURL(event).href, 'http://localhost/')
  assert.deepEqual(event.node.req, { headers: {}, method: 'GET', url: '/' })
  assert.equal(event.context.consoleAuth, undefined)
  assert.deepEqual(getEvent().context, { nitro: {} }, 'background jobs must not share mutable request caches')
})

test('an empty async context also returns a valid unauthenticated background event', () => {
  const event = load(() => undefined)()
  assert.deepEqual(event.context, { nitro: {} })
  assert.deepEqual(event.node.req.headers, {}, 'no trusted gateway or actor headers are fabricated')
})

test('a real request is preserved with its existing bindings and cache', () => {
  const event = { context: { nitro: { runtimeConfig: { fixture: true } }, consoleAuth: { authenticated: true } } }
  assert.equal(load(() => event)(), event)
})

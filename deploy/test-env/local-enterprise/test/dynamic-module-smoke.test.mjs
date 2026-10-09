import test from 'node:test'
import assert from 'node:assert/strict'
import { probeDynamicModules } from '../dynamic-module-smoke.mjs'

test('dynamic module smoke catches missing routes despite a healthy HTML entry', async () => {
  const paths = ['/entry.js', '/department.vue?macro=true', '/department.vue']
  const seen = []
  const results = await probeDynamicModules(async path => {
    seen.push(path)
    return path.includes('macro') ? { status: 404, body: 'Not Found' } : { status: 200, body: 'export default {}' }
  }, paths)
  assert.deepEqual(seen, paths)
  assert.deepEqual(results.map(result => result.passed), [true, false, true])
})

test('HTML fallback and Vite error overlay are not module success', async () => {
  for (const body of ['<!doctype html>', 'import "vite-error-overlay"']) {
    assert.equal((await probeDynamicModules(async () => ({ status: 200, body }), ['/route.vue']))[0].passed, false)
  }
  assert.equal((await probeDynamicModules(async () => ({ status: 200, body: 'export default {}' }), ['/route.vue']))[0].passed, true)
})

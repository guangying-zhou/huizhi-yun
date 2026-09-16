import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createScopedRuntimeRegistry } from '../app/utils/scopedRuntimeRegistry.ts'

describe('scoped runtime registry', () => {
  test('reuses state inside one Nuxt app and isolates separate SSR requests', () => {
    let sequence = 0
    const runtimeFor = createScopedRuntimeRegistry<object, { value: number }>(() => ({
      value: ++sequence
    }))
    const firstRequest = {}
    const secondRequest = {}

    const first = runtimeFor(firstRequest)
    assert.equal(runtimeFor(firstRequest), first)
    assert.notEqual(runtimeFor(secondRequest), first)
    assert.equal(first.value, 1)
    assert.equal(runtimeFor(secondRequest).value, 2)
  })
})

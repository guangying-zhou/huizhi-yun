import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(
  new URL('../server/utils/platformRuntime.ts', import.meta.url),
  'utf8'
)

describe('Platform runtime request timeouts', () => {
  test('allows the test policy synchronizer to extend bundle fetch beyond the generic budget with a bounded setting', () => {
    assert.match(source, /const POLICY_BUNDLE_FETCH_TIMEOUT_MS = 30_000/)
    assert.match(source, /HZY_PLATFORM_POLICY_BUNDLE_FETCH_TIMEOUT_MS/)
    assert.match(source, /requested > 90_000/)
    assert.equal(source.match(/timeout\n/g)?.length, 2)
  })
})

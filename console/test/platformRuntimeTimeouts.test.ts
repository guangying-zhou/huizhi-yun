import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const source = readFileSync(
  new URL('../server/utils/platformRuntime.ts', import.meta.url),
  'utf8'
)

describe('Platform runtime request timeouts', () => {
  test('allows policy bundle generation to complete beyond the generic ten-second request budget', () => {
    assert.match(source, /const POLICY_BUNDLE_FETCH_TIMEOUT_MS = 30_000/)
    assert.equal(
      source.match(/timeout: POLICY_BUNDLE_FETCH_TIMEOUT_MS/g)?.length,
      2
    )
  })
})

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { shouldTouchConsoleSession } from '../server/utils/sessionTouch.ts'

describe('Console session last-seen write throttling', () => {
  const now = Date.parse('2026-07-13T23:45:00Z')

  test('touches new, missing, or malformed session timestamps', () => {
    assert.equal(shouldTouchConsoleSession(null, now), true)
    assert.equal(shouldTouchConsoleSession('', now), true)
    assert.equal(shouldTouchConsoleSession('not-a-date', now), true)
  })

  test('does not issue another write within five minutes', () => {
    assert.equal(shouldTouchConsoleSession('2026-07-13 23:44:59', now), false)
    assert.equal(shouldTouchConsoleSession('2026-07-13T23:40:01Z', now), false)
  })

  test('refreshes last-seen at the five-minute boundary', () => {
    assert.equal(shouldTouchConsoleSession('2026-07-13 23:40:00', now), true)
    assert.equal(shouldTouchConsoleSession('2026-07-13T23:30:00Z', now), true)
  })
})

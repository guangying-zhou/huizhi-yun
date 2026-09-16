import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  buildShellCacheFingerprint,
  readShellSessionCache,
  writeShellSessionCache
} from '../app/utils/shellSessionCache.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  }
}

describe('shell session cache', () => {
  test('binds cached values to the authenticated user, tenant and policy version', () => {
    const fingerprint = buildShellCacheFingerprint({
      authenticated: true,
      user: 'u1',
      tenant: 'C000001',
      policyVersion: 'policy-v2'
    })
    assert.equal(fingerprint, 'u1|C000001|policy-v2')
    assert.equal(buildShellCacheFingerprint({
      authenticated: false,
      user: 'u1',
      tenant: 'C000001',
      policyVersion: 'policy-v2'
    }), '')
  })

  test('returns a valid cached value within its ttl', () => {
    const storage = memoryStorage()
    writeShellSessionCache(storage, 'summary', 'u1|tenant|v1', { unreadCount: 3 }, 1_000)

    assert.deepEqual(readShellSessionCache(
      storage,
      'summary',
      'u1|tenant|v1',
      30_000,
      value => value && typeof value === 'object'
        ? value as { unreadCount: number }
        : null,
      20_000
    ), {
      value: { unreadCount: 3 },
      cachedAt: 1_000
    })
  })

  test('rejects stale, mismatched and malformed entries', () => {
    const storage = memoryStorage()
    writeShellSessionCache(storage, 'summary', 'u1|tenant|v1', 3, 1_000)

    assert.equal(readShellSessionCache(storage, 'summary', 'u2|tenant|v1', 30_000, Number, 2_000), null)
    writeShellSessionCache(storage, 'summary', 'u1|tenant|v1', 3, 1_000)
    assert.equal(readShellSessionCache(storage, 'summary', 'u1|tenant|v1', 30_000, Number, 31_001), null)
  })
})

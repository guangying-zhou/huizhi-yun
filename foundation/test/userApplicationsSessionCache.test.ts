import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearUserApplicationsSessionCache,
  readUserApplicationsSessionCache,
  USER_APPLICATIONS_SESSION_CACHE_KEY,
  USER_APPLICATIONS_SESSION_CACHE_TTL_MS,
  writeUserApplicationsSessionCache
} from '../app/utils/userApplicationsSessionCache.ts'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

interface CachedApp {
  appCode: string
}

function parseCachedApp(value: unknown): CachedApp | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const appCode = String((value as { appCode?: unknown }).appCode || '').trim()
  return appCode ? { appCode } : null
}

describe('user applications session cache', () => {
  test('reuses a fresh cache only for the same authorization fingerprint', () => {
    const storage = new MemoryStorage()
    const cachedAt = 10_000
    writeUserApplicationsSessionCache(storage, 'user-1|tenant-1|policy-7', [
      { appCode: 'aims' },
      { appCode: 'codocs' }
    ], cachedAt)

    assert.deepEqual(
      readUserApplicationsSessionCache(
        storage,
        'user-1|tenant-1|policy-7',
        parseCachedApp,
        cachedAt + USER_APPLICATIONS_SESSION_CACHE_TTL_MS
      ),
      [{ appCode: 'aims' }, { appCode: 'codocs' }]
    )
    assert.equal(
      readUserApplicationsSessionCache(
        storage,
        'user-1|tenant-1|policy-8',
        parseCachedApp,
        cachedAt + 1
      ),
      null
    )
  })

  test('expires, rejects, and clears unusable cache entries', () => {
    const storage = new MemoryStorage()
    const cachedAt = 20_000
    writeUserApplicationsSessionCache(storage, 'fingerprint', [{ appCode: 'assets' }], cachedAt)

    assert.equal(
      readUserApplicationsSessionCache(
        storage,
        'fingerprint',
        parseCachedApp,
        cachedAt + USER_APPLICATIONS_SESSION_CACHE_TTL_MS + 1
      ),
      null
    )
    assert.equal(storage.getItem(USER_APPLICATIONS_SESSION_CACHE_KEY), null)

    storage.setItem(USER_APPLICATIONS_SESSION_CACHE_KEY, '{"fingerprint":"fingerprint","cachedAt":20000,"items":[{}]}')
    assert.equal(
      readUserApplicationsSessionCache(storage, 'fingerprint', parseCachedApp, cachedAt + 1),
      null
    )
    assert.equal(storage.getItem(USER_APPLICATIONS_SESSION_CACHE_KEY), null)

    writeUserApplicationsSessionCache(storage, 'fingerprint', [{ appCode: 'people' }], cachedAt)
    clearUserApplicationsSessionCache(storage)
    assert.equal(storage.getItem(USER_APPLICATIONS_SESSION_CACHE_KEY), null)
  })
})

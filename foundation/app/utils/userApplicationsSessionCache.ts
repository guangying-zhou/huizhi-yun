export const USER_APPLICATIONS_SESSION_CACHE_KEY = 'hzy:user-applications:v1'
export const USER_APPLICATIONS_SESSION_CACHE_TTL_MS = 60_000
export const USER_APPLICATIONS_SESSION_CACHE_STALE_TTL_MS = 24 * 60 * 60_000

interface UserApplicationsSessionCacheReadOptions {
  allowStale?: boolean
}

interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface UserApplicationsSessionCacheRecord {
  version: 1
  fingerprint: string
  cachedAt: number
  items: unknown[]
}

export function clearUserApplicationsSessionCache(storage: SessionStorageLike) {
  try {
    storage.removeItem(USER_APPLICATIONS_SESSION_CACHE_KEY)
  } catch {
    // sessionStorage unavailable: keep application loading on the network path.
  }
}

export function writeUserApplicationsSessionCache(
  storage: SessionStorageLike,
  fingerprint: string,
  items: readonly unknown[],
  cachedAt = Date.now()
) {
  const normalizedFingerprint = String(fingerprint || '').trim()
  if (!normalizedFingerprint) {
    clearUserApplicationsSessionCache(storage)
    return
  }

  const record: UserApplicationsSessionCacheRecord = {
    version: 1,
    fingerprint: normalizedFingerprint,
    cachedAt,
    items: [...items]
  }

  try {
    storage.setItem(USER_APPLICATIONS_SESSION_CACHE_KEY, JSON.stringify(record))
  } catch {
    // sessionStorage unavailable or full: the in-memory cache remains usable.
  }
}

export function readUserApplicationsSessionCache<T>(
  storage: SessionStorageLike,
  fingerprint: string,
  parseItem: (value: unknown) => T | null,
  now = Date.now(),
  options: UserApplicationsSessionCacheReadOptions = {}
): T[] | null {
  const normalizedFingerprint = String(fingerprint || '').trim()
  if (!normalizedFingerprint) return null

  try {
    const raw = storage.getItem(USER_APPLICATIONS_SESSION_CACHE_KEY)
    if (!raw) return null

    const record = JSON.parse(raw) as Partial<UserApplicationsSessionCacheRecord>
    const cachedAt = Number(record.cachedAt)
    const age = now - cachedAt
    const maximumAge = options.allowStale
      ? USER_APPLICATIONS_SESSION_CACHE_STALE_TTL_MS
      : USER_APPLICATIONS_SESSION_CACHE_TTL_MS
    if (
      record.version !== 1
      || record.fingerprint !== normalizedFingerprint
      || !Number.isFinite(cachedAt)
      || age < 0
      || age > maximumAge
      || !Array.isArray(record.items)
    ) {
      clearUserApplicationsSessionCache(storage)
      return null
    }

    const parsedItems: T[] = []
    for (const item of record.items) {
      const parsed = parseItem(item)
      if (!parsed) {
        clearUserApplicationsSessionCache(storage)
        return null
      }
      parsedItems.push(parsed)
    }

    return parsedItems
  } catch {
    clearUserApplicationsSessionCache(storage)
    return null
  }
}

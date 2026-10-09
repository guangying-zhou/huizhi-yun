export interface ShellSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface ShellSessionCacheRecord {
  version: 1
  fingerprint: string
  cachedAt: number
  value: unknown
}

export function buildShellCacheFingerprint(input: {
  authenticated: boolean
  user: unknown
  tenant: unknown
  policyVersion: unknown
}) {
  const user = String(input.user || '').trim()
  if (!input.authenticated || !user) return ''

  return [
    user,
    String(input.tenant || '').trim(),
    String(input.policyVersion || '').trim()
  ].join('|')
}

export function clearShellSessionCache(storage: ShellSessionStorage, key: string) {
  try {
    storage.removeItem(key)
  } catch {
    // sessionStorage unavailable: keep the network path usable.
  }
}

export function writeShellSessionCache(
  storage: ShellSessionStorage,
  key: string,
  fingerprint: string,
  value: unknown,
  cachedAt = Date.now()
) {
  const normalizedFingerprint = String(fingerprint || '').trim()
  if (!normalizedFingerprint) return

  const record: ShellSessionCacheRecord = {
    version: 1,
    fingerprint: normalizedFingerprint,
    cachedAt,
    value
  }

  try {
    storage.setItem(key, JSON.stringify(record))
  } catch {
    // sessionStorage unavailable or full: the in-memory state remains usable.
  }
}

export function readShellSessionCache<T>(
  storage: ShellSessionStorage,
  key: string,
  fingerprint: string,
  ttlMs: number,
  parseValue: (value: unknown) => T | null,
  now = Date.now()
) {
  const normalizedFingerprint = String(fingerprint || '').trim()
  if (!normalizedFingerprint) return null

  try {
    const raw = storage.getItem(key)
    if (!raw) return null

    const record = JSON.parse(raw) as Partial<ShellSessionCacheRecord>
    const cachedAt = Number(record.cachedAt)
    const age = now - cachedAt
    if (
      record.version !== 1
      || record.fingerprint !== normalizedFingerprint
      || !Number.isFinite(cachedAt)
      || age < 0
      || age > ttlMs
    ) {
      clearShellSessionCache(storage, key)
      return null
    }

    const value = parseValue(record.value)
    if (value === null) {
      clearShellSessionCache(storage, key)
      return null
    }

    return { value, cachedAt }
  } catch {
    clearShellSessionCache(storage, key)
    return null
  }
}

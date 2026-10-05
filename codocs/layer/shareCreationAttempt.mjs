// Session storage keeps a failed document action's retry key across a reload.
// The caller binds the current session, document and target in the scope;
// the digest binds the full request body without persisting its message.
export function createShareCreationAttempt({
  storage = () => globalThis.sessionStorage,
  newKey = () => crypto.randomUUID(),
  storagePrefix = 'codocs:pending-document-share'
} = {}) {
  const pending = new Map()
  const storageKey = scope => `${storagePrefix}:${scope}`
  const read = (scope) => {
    try {
      const value = storage().getItem(storageKey(scope))
      if (!value) return null
      const parsed = JSON.parse(value)
      return typeof parsed?.digest === 'string' && typeof parsed?.key === 'string' ? parsed : null
    } catch {
      return null
    }
  }

  return {
    async keyFor(scope, payload) {
      const normalized = JSON.stringify(Object.keys(payload).sort().map(key => [key, payload[key]]))
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
      const digest = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
      const prior = pending.get(scope) || read(scope)
      if (prior?.digest === digest) {
        pending.set(scope, prior)
        return prior.key
      }
      const entry = { digest, key: newKey() }
      pending.set(scope, entry)
      try {
        storage().setItem(storageKey(scope), JSON.stringify(entry))
      } catch { /* private mode: in-memory retry only */ }
      return entry.key
    },
    complete(scope, key) {
      if (pending.get(scope)?.key !== key) return
      pending.delete(scope)
      try {
        if (read(scope)?.key === key) storage().removeItem(storageKey(scope))
      } catch { /* storage is optional */ }
    }
  }
}

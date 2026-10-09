/** Keeps one key for a user's pending command across transport retries. */
export function createCommandIntents() {
  const pending = new Map<string, { payload: string, key: string }>()
  return {
    headers(action: string, body: unknown = null) {
      const payload = JSON.stringify(body)
      let current = pending.get(action)
      if (!current || current.payload !== payload) {
        current = { payload, key: crypto.randomUUID() }
        pending.set(action, current)
      }
      return { 'Idempotency-Key': current.key }
    },
    complete(action: string) { pending.delete(action) },
    abandon(action: string) { pending.delete(action) },
    clear() { pending.clear() }
  }
}

// Page-local, in-flight-only coalescing. Completed responses are not retained:
// session, authorization and catalog changes must be read again on refresh.
export function createCoalescedRead<T>(load: (query: Record<string, string>) => Promise<T>, scope: () => string) {
  const pending = new Map<string, Promise<T>>()
  return (query: Record<string, string>): Promise<T> => {
    const key = JSON.stringify([scope(), Object.entries(query).sort(([a], [b]) => a.localeCompare(b))])
    const existing = pending.get(key)
    if (existing) return existing
    const request = Promise.resolve().then(() => load(query))
    pending.set(key, request)
    void request.then(() => { if (pending.get(key) === request) pending.delete(key) },
      () => { if (pending.get(key) === request) pending.delete(key) })
    return request
  }
}

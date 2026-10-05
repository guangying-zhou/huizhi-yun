// Only one HTTP event owns each result. Never share session validity across
// requests; a new event must observe revocation immediately.
export function createRequestAuthMemo<T>() {
  const entries = new WeakMap<object, { key: string, result: Promise<T> }>()
  return (event: object, key: string, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(event)
    if (entry?.key === key) return entry.result
    const result = Promise.resolve().then(load)
    entries.set(event, { key, result })
    return result
  }
}

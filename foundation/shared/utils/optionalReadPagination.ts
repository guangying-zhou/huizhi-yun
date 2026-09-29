// Optional read pagination: absence preserves legacy wire contracts.
export function optionalReadPagination(query: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, max] of [['page', 1_000_000], ['pageSize', 100]] as const) {
    if (!(key in query)) continue
    const raw = query[key]
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || Number(raw) > max) throw new Error('Invalid pagination')
    result[key] = raw
  }
  return result
}

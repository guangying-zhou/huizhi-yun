import { optionalReadPagination } from './optionalReadPagination'

export function consoleSyncReadQuery(query: Record<string, unknown>): Record<string, string> {
  if (Object.keys(query).some(key => !['limit', 'page', 'pageSize'].includes(key))) throw new Error('Unsupported sync query')
  const pagination = optionalReadPagination(query)
  if (query.limit === undefined) return pagination
  if (Object.keys(pagination).length || typeof query.limit !== 'string' || !/^(?:[1-9][0-9]?|100)$/.test(query.limit)) throw new Error('Invalid sync limit')
  return { limit: query.limit }
}

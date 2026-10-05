import { optionalReadPagination } from './optionalReadPagination'
export function notificationReadQuery(query: Record<string, unknown>): Record<string, string> {
  const keys = ['status', 'category', 'sourceAppCode', 'source_app_code', 'cursor', 'limit', 'page', 'pageSize']
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (!keys.includes(key) || typeof value !== 'string' || value.length > 1000 || /[\0\r\n]/.test(value)) throw new Error('Invalid notification query')
    result[key] = value
  }
  const pagination = optionalReadPagination(query)
  if (Object.keys(pagination).length && ('cursor' in query || 'limit' in query)) throw new Error('Cannot mix page and cursor')
  if ('status' in result && !['all','unread','read','archived'].includes(result.status!)) throw new Error('Invalid status')
  for (const key of ['category','sourceAppCode','source_app_code']) if (key in result && new TextEncoder().encode(result[key]).length > 64) throw new Error('Invalid filter')
  if ('cursor' in result && result.cursor !== '' && !/^[1-9]\d*$/.test(result.cursor!)) throw new Error('Invalid cursor')
  if ('limit' in result && !/^[1-9]\d*$/.test(result.limit!)) throw new Error('Invalid limit')
  return result
}

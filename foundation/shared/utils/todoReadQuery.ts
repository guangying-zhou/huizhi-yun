import { optionalReadPagination } from './optionalReadPagination'
export function todoReadQuery(query: Record<string, unknown>, hosted = false): Record<string, unknown> {
  const allowed = hosted ? ['todoKind','cursor','limit','page','pageSize'] : ['todoKind','todo_kind','category','sourceAppCode','source_app_code','cursor','limit','page','pageSize']
  for (const [key,value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string' || /[\0\r\n]/.test(value)) throw new Error('Invalid todo query')
  }
  const pagination = optionalReadPagination(query)
  const paged = Object.keys(pagination).length > 0
  if (paged && ('cursor' in query || 'limit' in query)) throw new Error('Cannot mix page and cursor')
  if ('todoKind' in query && 'todo_kind' in query || 'sourceAppCode' in query && 'source_app_code' in query) throw new Error('Duplicate alias')
  const kind = query.todoKind ?? query.todo_kind
  if (kind !== undefined && !['approval','due','risk','follow_up'].includes(String(kind))) throw new Error('Invalid todo kind')
  for (const key of ['category','sourceAppCode','source_app_code']) if (key in query && new TextEncoder().encode(String(query[key])).length > 64) throw new Error('Invalid filter')
  if ('cursor' in query && String(query.cursor).length > 512) throw new Error('Invalid cursor')
  const limit = query.limit === undefined ? 20 : Number(query.limit)
  if (!paged && (query.limit !== undefined && !/^\d+$/.test(String(query.limit)) || !Number.isInteger(limit) || limit < 1 || limit > (hosted ? 50 : 100))) throw new Error('Invalid limit')
  return { ...(kind === undefined ? {} : { todoKind: kind }), ...(!hosted && query.category !== undefined ? { category: query.category } : {}), ...(!hosted && (query.sourceAppCode ?? query.source_app_code) !== undefined ? { sourceAppCode: query.sourceAppCode ?? query.source_app_code } : {}), ...(paged ? pagination : { ...(query.cursor === undefined ? {} : { cursor: query.cursor }), limit }) }
}

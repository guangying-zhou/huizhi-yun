import type { H3Event } from 'h3'
import { callAimsRuntime } from '~~/server/utils/projectDocumentAccess'
import { buildAimsProjectRuntimeAccessQuery } from '~~/server/utils/aimsProjectRuntimeAccess'

export interface RuntimePage<T> {
  items?: T[]
  total?: number
  page?: number
  pageSize?: number
}

export async function listAllAimsRuntime<T>(
  event: H3Event,
  path: string,
  query: Record<string, unknown> = {}
) {
  const pageSize = 100
  const items: T[] = []
  const uid = getRequestUid(event)
  const actorQuery: Record<string, unknown> = { ...query }
  if (uid) {
    actorQuery.current_user ||= uid
    actorQuery.operator_uid ||= uid
  }
  const projectID = projectIDFromRuntimePath(path)
  const runtimeQuery = uid && projectID
    ? await buildAimsProjectRuntimeAccessQuery(event, { projectId: projectID, uid, baseQuery: actorQuery })
    : actorQuery

  for (let page = 1; page <= 1000; page += 1) {
    const data = await callAimsRuntime<RuntimePage<T> | T[]>(event, path, {
      query: { ...runtimeQuery, page, pageSize },
      scope: 'aims.read'
    })

    if (Array.isArray(data)) return data

    const pageItems = Array.isArray(data.items) ? data.items : []
    items.push(...pageItems)

    const total = Number(data.total || 0)
    if (pageItems.length < pageSize || (total > 0 && items.length >= total)) break
  }

  return items
}

function projectIDFromRuntimePath(path: string) {
  const match = path.match(/^\/v1\/aims\/projects\/([^/]+)\//)
  return match ? decodeURIComponent(match[1] || '') : ''
}

export function stringValue(value: unknown) {
  return String(value ?? '').trim()
}

export function numberValue(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

export function nullableNumberValue(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

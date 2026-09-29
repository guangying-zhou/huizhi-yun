import { consoleSyncReadQuery } from '@hzy/foundation/shared/utils/consoleSyncReadQuery'
import { createError, getQuery, getRouterParam, type H3Event } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { DirectorySyncJob, DirectorySyncEvent } from '@hzy/foundation/app/types/consoleDirectorySync'

export function syncJobCode(event: H3Event) {
  const code = getRouterParam(event, 'jobCode') || ''
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(code) || code === '.' || code === '..') throw createError({ statusCode: 400, message: 'Invalid sync job code' })
  return code
}
export function syncReadQuery(event: H3Event, allowLimit = false): Record<string, string> {
  const query = getQuery(event)
  try {
    if (!allowLimit && Object.keys(query).length) throw new Error('Unsupported sync query')
    return allowLimit ? consoleSyncReadQuery(query) : {}
  } catch { throw createError({ statusCode: 400, message: 'Invalid sync query' }) }
}
// Fixed prefixes written by Runtime; never return a suffix or the original error.
export function syncFailureCategory(value: unknown, status: unknown): string | null {
  if (status !== 'failed' && status !== 'partial_success') return null
  if (typeof value === 'string') {
    if (['Directory data updated, but Platform subject sync failed: ', 'Platform subject projection failed: ', 'Platform subject sync returned HTTP ', 'Platform subject sync response is invalid', 'Platform projection chunk '].some(prefix => value.startsWith(prefix))) return 'Platform同步失败'
    if (['LDAP connector result is missing uid or dn', 'Connector Runtime DingTalk Directory sync failed'].some(prefix => value.startsWith(prefix))) return '连接器同步失败'
  }
  return '同步失败'
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value) && value !== '.' && value !== '..' ? value : ''
const enumeration = (value: unknown, allowed: string[]) => typeof value === 'string' && allowed.includes(value) ? value : 'unknown'
const timestamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : null
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
const statuses = ['pending', 'running', 'success', 'failed', 'partial_success', 'skipped']
export function projectSyncJob(value: unknown): DirectorySyncJob {
  const row = record(value)
  if (!identifier(row.jobCode)) throw createError({ statusCode: 502, message: 'Sync response invalid' })
  return {
    jobCode: identifier(row.jobCode), providerCode: enumeration(row.providerCode, ['console', 'manual', 'ldap', 'dingtalk', 'platform', 'wecom']),
    syncType: enumeration(row.syncType, ['manual', 'full', 'incremental', 'shadow_check']), objectScope: enumeration(row.objectScope, ['all', 'subjects', 'users', 'departments', 'projects', 'committees', 'user_profile']),
    status: enumeration(row.status, statuses), startedAt: timestamp(row.startedAt), finishedAt: timestamp(row.finishedAt), createdAt: timestamp(row.createdAt) || '', updatedAt: timestamp(row.updatedAt) || '',
    totalCount: count(row.totalCount), createdCount: count(row.createdCount), updatedCount: count(row.updatedCount), deletedCount: count(row.deletedCount), skippedCount: count(row.skippedCount), errorCount: count(row.errorCount),
    failureCategory: syncFailureCategory(row.errorMessage, row.status)
  }
}
export function projectSyncEvent(value: unknown): DirectorySyncEvent {
  const row = record(value)
  return {
    id: count(row.id), jobCode: identifier(row.jobCode), objectType: enumeration(row.objectType, ['user', 'department', 'project', 'committee', 'summary']), objectCode: identifier(row.objectCode),
    changeType: enumeration(row.changeType, ['create', 'update', 'delete', 'skip', 'error', 'noop']), sourceProvider: enumeration(row.sourceProvider, ['console', 'manual', 'ldap', 'dingtalk', 'platform', 'wecom']),
    status: enumeration(row.status, statuses), createdAt: timestamp(row.createdAt) || '', failureCategory: syncFailureCategory(row.message, row.status)
  }
}
export function projectSyncList(value: unknown, kind: 'jobs' | 'events') {
  if (!Array.isArray(value)) throw createError({ statusCode: 502, message: 'Sync response invalid' })
  return kind === 'jobs' ? value.map(projectSyncJob) : value.map(projectSyncEvent)
}
export function projectSyncResult(value: unknown, kind: 'jobs' | 'events', query: Record<string, string>) {
  if (!('page' in query) && !('pageSize' in query)) return projectSyncList(value, kind)
  const row = record(value)
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20)
  if (!Number.isSafeInteger(row.total) || Number(row.total) < 0 || row.page !== page || row.pageSize !== pageSize || !Array.isArray(row.items) || row.items.length > pageSize) throw createError({ statusCode: 502, message: 'Sync response invalid' })
  // Rebuild both envelope and rows: no future upstream field can leak into Host.
  return { items: projectSyncList(row.items, kind), total: Number(row.total), page, pageSize }
}
export async function fetchSyncRead(event: H3Event, id: string, options: { params?: Record<string, string>, query: Record<string, string> }) {
  try {
    return await fetchConsoleUserApi<unknown>(event, id, options)
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode)
    throw createError({ statusCode: [401, 403, 404, 503].includes(status) ? status : 502, message: 'Sync data unavailable' })
  }
}

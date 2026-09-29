import { createError, getQuery, type H3Event } from 'h3'
import { fetchConsoleUserApi } from '@hzy/foundation/server/utils/consoleUserApi'
import type { ConsoleRuntimeSummary } from '@hzy/foundation/app/types/consoleRuntimeSummary'

const invalid = () => createError({ statusCode: 502, message: 'Runtime status response invalid' })
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  return value as Record<string, unknown>
}
function timestamp(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
}
function version(value: unknown) {
  return typeof value === 'string' && /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,79})?(?:\+[A-Za-z0-9][A-Za-z0-9.-]{0,79})?$/.test(value) ? value : null
}
export function runtimeSummaryQuery(event: H3Event) {
  if (Object.keys(getQuery(event)).length) throw createError({ statusCode: 400, message: 'Unsupported runtime status query' })
}
export async function fetchRuntimeSummary(event: H3Event, id: 'runtime-summary.data.read' | 'runtime-summary.applications.read') {
  try {
    return await fetchConsoleUserApi<unknown>(event, id)
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode)
    throw createError({ statusCode: [401, 403, 404, 503].includes(status) ? status : 502, message: 'Runtime status unavailable' })
  }
}
export function projectDataRuntimeSummary(value: unknown): ConsoleRuntimeSummary {
  const runtime = record(record(value).runtime)
  if (typeof runtime.reachable !== 'boolean') throw invalid()
  const available = runtime.reachable
  const healthy = available && ['ok', 'healthy', 'online', 'active'].includes(String(runtime.status))
  return {
    version: version(runtime.version), status: !available ? 'unavailable' : healthy ? 'healthy' : ['degraded', 'unhealthy', 'failed', 'error'].includes(String(runtime.status)) ? 'degraded' : 'unknown',
    healthy, available, lastSeenAt: timestamp(runtime.lastSeenAt), checkedAt: timestamp(runtime.checkedAt) || new Date().toISOString(),
    failureCategory: !available ? 'runtime-unavailable' : healthy ? null : 'runtime-unhealthy'
  }
}
export function projectRuntimeApplicationsSummary(value: unknown): ConsoleRuntimeSummary {
  const response = record(value)
  const context = record(response.context)
  if (typeof context.enabled !== 'boolean' || !Array.isArray(response.items)) throw invalid()
  const items = response.items.map(record).filter(item => item.enabledInStack === true)
  const available = context.enabled && items.length > 0
  const healthy = available && items.every(item => item.status === 'online')
  return {
    version: null, status: !available ? 'unavailable' : healthy ? 'healthy' : 'degraded', healthy, available,
    lastSeenAt: null, checkedAt: new Date().toISOString(), failureCategory: !available ? 'applications-unavailable' : healthy ? null : 'applications-degraded'
  }
}

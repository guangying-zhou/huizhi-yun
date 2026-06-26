import { createError, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  notifyOpportunityStaleItems,
  type OpportunityStaleNotice
} from '~~/server/utils/runtimeNotifications'

/**
 * 手动触发商机超期扫描（管理员/调试用）。
 *
 * 扫描逻辑和数据权限由 tenant-runtime 执行；Nuxt 侧只负责用户权限校验
 * 和企业微信通知编排，避免恢复 Altoc 本地 DB 访问路径。
 */

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface StaleScanResult {
  scanned?: number
  stale_ids?: number[]
  items?: OpportunityStaleNotice[]
  notified_owners?: number
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

function normalizeStaleDays(value: unknown) {
  const days = Number(value)
  if (!Number.isFinite(days) || days <= 0) return 7
  return Math.min(Math.trunc(days), 365)
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:opportunity:edit',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for stale opportunity scan.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'opportunity', 'edit')

  const body = objectBody(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'opportunity', 'edit')
  const result = await callAltocRuntime<StaleScanResult>(
    event,
    '/v1/altoc/opportunities/scan-stale',
    { staleDays: normalizeStaleDays(body.staleDays || body.stale_days) },
    dataAccessQuery
  )
  const notifiedOwners = await notifyOpportunityStaleItems(Array.isArray(result.items) ? result.items : [])

  return {
    code: 0,
    message: 'ok',
    data: {
      ...result,
      notified_owners: notifiedOwners
    }
  }
})

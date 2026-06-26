import { createError, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'
import {
  notifyReceivableOverdueItems,
  type ReceivableOverdueNotice
} from '~~/server/utils/runtimeNotifications'

/**
 * POST /api/v1/payments/scan-overdue
 *
 * 手动触发“扫描并标记逾期回款计划”。
 * 数据扫描和状态更新由 tenant-runtime 执行；Nuxt 侧只负责权限校验
 * 和通知编排，避免恢复 Altoc 本地 DB 访问路径。
 */

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface OverdueScanResult {
  scanned?: number
  marked_overdue?: number
  updated_days?: number
  newly_overdue?: ReceivableOverdueNotice[]
  overdue_ids?: number[]
  notified_owners?: number
}

function objectBody(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return {}
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:receivable:edit',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for overdue payment scan.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'receivable', 'edit')

  const uid = getRequestUid(event) || 'system'
  const body = objectBody(await readBody(event).catch(() => ({})))
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'receivable', 'edit')
  const result = await callAltocRuntime<OverdueScanResult>(
    event,
    '/v1/altoc/payments/scan-overdue',
    {
      ...body,
      operatorUid: body.operatorUid || body.operator_uid || uid
    },
    dataAccessQuery
  )
  const notifiedOwners = await notifyReceivableOverdueItems(
    Array.isArray(result.newly_overdue) ? result.newly_overdue : []
  )

  return {
    code: 0,
    message: `扫描完成：新标记逾期 ${result.marked_overdue || 0} 条，更新逾期天数 ${result.updated_days || 0} 条`,
    data: {
      ...result,
      notified_owners: notifiedOwners
    }
  }
})

import { createError, getRouterParam, readBody, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { requirePermission } from '~~/server/utils/checkPermission'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ManagementBody {
  action?: 'force_complete' | 'terminate' | 'invalidate'
  reason?: string
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  body: Record<string, unknown>,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.write altoc:contract:admin',
    method: 'POST',
    query,
    body
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for contract management.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'admin', 'admin', '只有系统管理员可以执行合同管理操作')

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: '无效的合同ID' })
  }

  const body = await readBody<ManagementBody>(event)
  const action = String(body.action || '').trim()
  if (!['force_complete', 'terminate', 'invalidate'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: '无效的管理动作' })
  }

  const uid = getRequestUid(event) || 'system'
  const reason = String(body.reason || '').trim()
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'contract', 'admin')
  const data = await callAltocRuntime<Record<string, unknown>>(event, `/v1/altoc/contracts/${id}/management`, {
    action,
    reason,
    operatorUid: uid
  }, dataAccessQuery)

  return { code: 0, message: 'ok', data }
})

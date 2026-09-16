import { getRouterParam, readBody } from 'h3'
import { projectIntegrationOperationReplay } from '@hzy/foundation/server/utils/integrationOperationDiagnosticProjection'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { callFinanceIntegrationOperationAdmin } from '~~/server/utils/integrationOperationAdmin'

export default defineEventHandler(async (event) => {
  if (!getRequestUid(event)) throw createError({ statusCode: 401, message: '请先登录' })
  await requirePermission(event, 'integration_operations', 'replay', '需要跨应用操作重放权限')
  const operationId = String(getRouterParam(event, 'operationId') || '').trim()
  const source = await readBody<Record<string, unknown>>(event)
  const expectedVersion = Number(source?.expectedVersion)
  const reason = String(source?.reason || '').trim()
  if (!operationId || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0 || !reason || reason.length > 500) {
    throw createError({ statusCode: 400, message: 'operationId、expectedVersion 和 1-500 字符 reason 必填' })
  }
  await callFinanceIntegrationOperationAdmin<Record<string, unknown>>(event, `/v1/finance/integration-operations/${encodeURIComponent(operationId)}:replay`, 'replay', { body: { expectedVersion, reason } })
  return { code: 0, data: projectIntegrationOperationReplay(operationId, expectedVersion, reason) }
})

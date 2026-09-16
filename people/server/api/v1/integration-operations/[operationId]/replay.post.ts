import { getRouterParam, readBody } from 'h3'
import { projectIntegrationOperationReplay } from '@hzy/foundation/server/utils/integrationOperationDiagnosticProjection'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callPeopleIntegrationOperationAdmin } from '~~/server/utils/integrationOperationAdmin'

export default defineEventHandler(async (event) => {
  if (!getRequestUid(event)) throw createError({ statusCode: 401, message: '请先登录' })
  await assertPeoplePermission(event, 'integration_operations', 'replay')
  const operationId = String(getRouterParam(event, 'operationId') || '').trim()
  const source = await readBody<Record<string, unknown>>(event)
  const expectedVersion = Number(source?.expectedVersion)
  const reason = String(source?.reason || '').trim()
  if (!operationId || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0 || !reason || reason.length > 500) {
    throw createError({ statusCode: 400, message: 'operationId、expectedVersion 和 1-500 字符 reason 必填' })
  }
  await callPeopleIntegrationOperationAdmin<Record<string, unknown>>(
    event,
    `/v1/people/integration-operations/${encodeURIComponent(operationId)}:replay`,
    'replay',
    { body: { expectedVersion, reason } }
  )
  return { code: 0, data: projectIntegrationOperationReplay(operationId, expectedVersion, reason) }
})

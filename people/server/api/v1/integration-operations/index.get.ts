import { getQuery } from 'h3'
import { projectIntegrationOperationList } from '@hzy/foundation/server/utils/integrationOperationDiagnosticProjection'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'
import { callPeopleIntegrationOperationAdmin } from '~~/server/utils/integrationOperationAdmin'

export default defineEventHandler(async (event) => {
  if (!getRequestUid(event)) throw createError({ statusCode: 401, message: '请先登录' })
  await assertPeoplePermission(event, 'integration_operations', 'view')
  const source = getQuery(event)
  const query: Record<string, unknown> = {}
  for (const key of ['status', 'limit', 'cursor']) {
    if (source[key] !== undefined) query[key] = source[key]
  }
  const data = await callPeopleIntegrationOperationAdmin<Record<string, unknown>>(
    event,
    '/v1/people/integration-operations',
    'view',
    { query }
  )
  return { code: 0, data: projectIntegrationOperationList(data) }
})

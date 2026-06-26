import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(
    event,
    '/v1/codocs/document-access/audit-logs',
    {
      scope: 'codocs.read',
      query
    }
  )

  return {
    code: 0,
    data: result
  }
})

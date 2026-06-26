import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(
    event,
    '/v1/codocs/document-access/check',
    {
      method: 'POST',
      scope: 'codocs.read',
      body
    }
  )

  return {
    code: 0,
    data: result
  }
})

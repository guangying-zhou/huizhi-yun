import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const documentUuid = getRouterParam(event, 'documentUuid')
  if (!documentUuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  const query = getQuery(event)
  const result = await callCodocsTenantRuntime<Record<string, unknown>>(
    event,
    `/v1/codocs/document-access/policies/${encodeURIComponent(documentUuid)}`,
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

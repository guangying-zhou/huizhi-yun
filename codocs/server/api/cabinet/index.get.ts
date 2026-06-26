import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface RuntimePage {
  items?: unknown[]
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const ownerUid = query.owner_uid as string

  if (!ownerUid) {
    throw createError({ statusCode: 400, message: 'owner_uid 不能为空' })
  }

  const data = await callCodocsTenantRuntime<RuntimePage>(event, '/v1/codocs/cabinet', {
    query,
    scope: 'codocs.read'
  })

  return { success: true, data: { items: data.items || [] } }
})

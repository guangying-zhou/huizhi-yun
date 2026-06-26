import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  const body = await readBody(event)
  const { uid } = body

  if (!uuid || !uid) {
    throw createError({ statusCode: 400, message: 'Missing params' })
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(uuid)}/read`, {
    method: 'POST',
    scope: 'codocs.write',
    body: { uid }
  })

  return { success: true }
})

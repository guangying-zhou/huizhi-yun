import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createEnvironmentFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'environments', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createEnvironmentFromDb(payload, getOperatorUid(event))

  return ok({ id }, '环境已创建')
})

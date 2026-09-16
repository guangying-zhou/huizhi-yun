import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createTechnologyBaseFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'technology_bases', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createTechnologyBaseFromDb(payload, getOperatorUid(event))

  return ok({ id }, '技术底座已创建')
})

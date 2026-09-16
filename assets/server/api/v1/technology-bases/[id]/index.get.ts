import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getTechnologyBaseFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'technology_bases', 'view')

  const id = parseIdParam(event)
  const base = await getTechnologyBaseFromDb(id)

  return ok(assertFound(base, '技术底座不存在'))
})

import { assertFound, ok, parseIdParam } from '~~/server/utils/assetsApi'
import { getEnvironmentFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'environments', 'view')

  const id = parseIdParam(event)
  const environment = await getEnvironmentFromDb(id)

  return ok(assertFound(environment, '环境不存在'))
})

import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createAssignmentFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'assignments', 'edit')

  const payload = await readRequestBody<Record<string, unknown>>(event)
  const id = await createAssignmentFromDb(payload, getOperatorUid(event))

  return ok({ id }, '操作记录已创建')
})

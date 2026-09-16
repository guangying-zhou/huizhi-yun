import { getOperatorUid, ok, readRequestBody } from '~~/server/utils/assetsApi'
import { createAssignmentFromDb } from '~~/server/utils/assetsRepository'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveAssetsApiPermission } from '~~/server/utils/assetsPermissionRoutes'

export default defineEventHandler(async (event) => {
  const payload = await readRequestBody<Record<string, unknown>>(event)
  const rule = resolveAssetsApiPermission('assignments', 'POST', String(payload.status || ''), String(payload.action_type || payload.actionType || ''))
  await requirePermission(event, 'assignments', rule?.action || 'edit')
  const id = await createAssignmentFromDb(payload, getOperatorUid(event))

  return ok({ id }, '操作记录已创建')
})

import { readBody } from 'h3'
import { explainAssetsInstanceConflicts } from '~~/server/utils/assetsInstanceConflictExplanation'
import { requirePermission } from '~~/server/utils/checkPermission'

interface AssetsInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AssetsInstanceConflictExplainBody>(event)
    .catch(() => ({} as AssetsInstanceConflictExplainBody))
  const targetType = String(body.targetType || '').trim()
  await requirePermission(event, targetType === 'assignment' ? 'assignments' : 'purchase_orders', 'approve')

  const result = await explainAssetsInstanceConflicts(event, {
    targetType: body.targetType,
    id: body.id,
    code: body.code,
    action: body.action,
    includeBaseline: body.includeBaseline
  })

  return {
    code: 0,
    data: result
  }
})

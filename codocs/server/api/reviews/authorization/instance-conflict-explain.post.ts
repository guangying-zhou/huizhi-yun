import { readBody } from 'h3'
import { explainCodocsInstanceConflicts } from '~~/server/utils/codocsInstanceConflictExplanation'
import { requirePermission } from '~~/server/utils/checkPermission'

interface CodocsInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<CodocsInstanceConflictExplainBody>(event)
    .catch(() => ({} as CodocsInstanceConflictExplainBody))
  await requirePermission(event, 'reviews', 'view', '缺少审阅查看权限')

  const result = await explainCodocsInstanceConflicts(event, {
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

import { createError, readBody } from 'h3'
import { explainAltocInstanceConflicts } from '~~/server/utils/altocInstanceConflictExplanation'
import { requirePermission } from '~~/server/utils/checkPermission'

interface AltocInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function viewResourceForTargetType(value: unknown) {
  const targetType = stringValue(value)
  if (targetType === 'quotation') return 'quotation'
  if (targetType === 'contract') return 'contract'
  if (targetType === 'receivable') return 'receivable'
  throw createError({
    statusCode: 400,
    statusMessage: 'Bad Request',
    message: 'targetType must be quotation, contract or receivable'
  })
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AltocInstanceConflictExplainBody>(event)
    .catch(() => ({} as AltocInstanceConflictExplainBody))

  await requirePermission(event, viewResourceForTargetType(body.targetType), 'view')

  const result = await explainAltocInstanceConflicts(event, {
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

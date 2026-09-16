import { readBody } from 'h3'
import {
  explainAimsInstanceConflicts,
  loadAimsInstanceConflictFacts
} from '~~/server/utils/aimsInstanceConflictExplanation'
import { requirePermission } from '~~/server/utils/checkPermission'

interface AimsInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<AimsInstanceConflictExplainBody>(event)
    .catch(() => ({} as AimsInstanceConflictExplainBody))

  const facts = await loadAimsInstanceConflictFacts(event, {
    targetType: body.targetType,
    id: body.id,
    code: body.code,
    action: body.action,
    includeBaseline: body.includeBaseline
  })
  await requirePermission(event, facts.resourceCode, 'view')

  const result = await explainAimsInstanceConflicts(event, {
    targetType: body.targetType,
    id: body.id,
    code: body.code,
    action: body.action,
    includeBaseline: body.includeBaseline
  }, facts)

  return {
    code: 0,
    data: result
  }
})

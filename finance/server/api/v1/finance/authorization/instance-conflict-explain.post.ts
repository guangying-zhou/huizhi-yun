import { readBody } from 'h3'
import { explainFinanceInstanceConflicts } from '~~/server/utils/financeInstanceConflictExplanation'

interface FinanceInstanceConflictExplainBody {
  targetType?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
}

export default defineEventHandler(async (event) => {
  const body = await readBody<FinanceInstanceConflictExplainBody>(event)
    .catch(() => ({} as FinanceInstanceConflictExplainBody))
  const result = await explainFinanceInstanceConflicts(event, {
    targetType: String(body.targetType || ''),
    code: String(body.code || ''),
    action: body.action == null ? null : String(body.action),
    includeBaseline: body.includeBaseline === undefined
      ? undefined
      : !['0', 'false', 'no', 'off'].includes(String(body.includeBaseline).trim().toLowerCase())
  })

  return {
    code: 0,
    data: result
  }
})

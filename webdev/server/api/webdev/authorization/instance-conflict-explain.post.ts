import { readBody } from 'h3'
import { explainWebDevInstanceConflicts } from '~~/server/utils/webdevInstanceConflictExplanation'
import { requireWebDevPermission } from '~~/server/utils/auth'

interface WebDevInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  jobId?: unknown
  action?: unknown
  includeBaseline?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const body = await readBody<WebDevInstanceConflictExplainBody>(event)
    .catch(() => ({} as WebDevInstanceConflictExplainBody))
  const activeRoleCode = stringValue(body.activeRoleCode)
  const snapshot = await requireWebDevPermission(event, 'webdev_workspace', 'deploy')
  const result = await explainWebDevInstanceConflicts(event, stringValue(snapshot.uid), {
    targetType: body.targetType,
    id: body.id,
    jobId: body.jobId,
    action: body.action,
    includeBaseline: body.includeBaseline,
    activeRoleCode,
    authorizationMode: body.authorizationMode
  })

  return {
    code: 0,
    data: result
  }
})

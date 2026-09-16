import { readBody } from 'h3'
import { explainPeopleInstanceConflicts } from '~~/server/utils/peopleInstanceConflictExplanation'
import { assertPeoplePermission } from '~~/server/utils/peoplePermissions'

interface PeopleInstanceConflictExplainBody {
  targetType?: unknown
  id?: unknown
  code?: unknown
  action?: unknown
  includeBaseline?: unknown
  activeRoleCode?: unknown
  authorizationMode?: unknown
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export default defineEventHandler(async (event) => {
  const body = await readBody<PeopleInstanceConflictExplainBody>(event)
    .catch(() => ({} as PeopleInstanceConflictExplainBody))
  const activeRoleCode = stringValue(body.activeRoleCode)
  const snapshot = await assertPeoplePermission(event, 'assignments', 'view')
  const result = await explainPeopleInstanceConflicts(event, stringValue(snapshot.uid), {
    targetType: body.targetType,
    id: body.id,
    code: body.code,
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

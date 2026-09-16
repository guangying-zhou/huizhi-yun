import { normalizeNullableString, ok, requireString } from '~~/server/utils/api'
import {
  authorizationObjectContextFromQuery,
  authorizationQueryBooleanValue,
  authorizationQueryValue
} from '~~/server/utils/authorizationObjectContext'
import { explainInstanceConflicts } from '~~/server/utils/instanceConflictExplanation'

function principal(kind: string, uid: unknown) {
  return {
    kind,
    uid: normalizeNullableString(uid)
  }
}

function principalsFromQuery(query: Record<string, unknown>) {
  return [
    principal('requester', query.requesterUid),
    principal('applicant', query.applicantUid),
    principal('initiator', query.initiatorUid),
    principal('creator', query.createdByUid),
    principal('owner', query.ownerUid),
    principal('handler', query.handlerUid),
    principal('operator', query.operatorUid),
    principal('submitter', query.submittedByUid),
    principal('maker', query.makerUid)
  ].filter(item => item.uid)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event) as Record<string, unknown>
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const uid = requireString(query.uid, 'uid')
  const appCode = requireString(query.appCode, 'appCode')
  const resourceCode = requireString(query.resourceCode, 'resourceCode')
  const action = requireString(query.action, 'action')

  return ok(await explainInstanceConflicts({
    tenantCode,
    uid,
    appCode,
    resourceCode,
    action,
    activeRoleCode: authorizationQueryValue(query.activeRoleCode),
    authorizationMode: authorizationQueryValue(query.authorizationMode),
    includeBaseline: authorizationQueryBooleanValue(query.includeBaseline, true),
    object: authorizationObjectContextFromQuery(query, uid),
    principals: principalsFromQuery(query)
  }))
})

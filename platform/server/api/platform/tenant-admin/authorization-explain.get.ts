import { requireString } from '~~/server/utils/api'
import { explainDbAuthorization } from '~~/server/utils/authorization'
import {
  authorizationObjectContextFromQuery,
  authorizationQueryBooleanValue,
  authorizationQueryValue
} from '~~/server/utils/authorizationObjectContext'

interface ExplainScopeDto {
  dimension: string
  predicate: string
  value: string | null
  group: string | null
  source: string
}

interface ExplainGrantDto {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: {
    appCode: string
    resourceCode: string
    action: string
  }
  active: boolean
  actionMatched: boolean
  scopeMatched: boolean
  defaultScopes: ExplainScopeDto[]
  assignmentScopes: ExplainScopeDto[]
  relationScopes: ExplainScopeDto[]
}

interface ExplainResponseDto {
  uid: string
  tenantCode: string
  subjectId: number | null
  selectedRoleCodes: string[]
  availableRoleCodes: string[]
  activeRoleCode: string | null
  allowed: boolean
  reasonCode: string
  matchedAction: string | null
  matchedGrant: ExplainGrantDto | null
  candidateGrants: ExplainGrantDto[]
}

interface ExplainScopeInput {
  dimension: string
  predicate: string
  value?: string | null
  group?: string | null
  source: string
}

function serializeScope(scope: ExplainScopeInput): ExplainScopeDto {
  return {
    dimension: scope.dimension,
    predicate: scope.predicate,
    value: scope.value || null,
    group: scope.group || null,
    source: scope.source
  }
}

function serializeGrant(grant: {
  grantId: string
  roleCode: string | null
  subjectType: string
  sourceType: string
  permission: { appCode: string, resourceCode: string, action: string }
  active: boolean
  actionMatched: boolean
  scopeMatched: boolean
  defaultScopes: ExplainScopeInput[]
  assignmentScopes: ExplainScopeInput[]
  relationScopes: ExplainScopeInput[]
}): ExplainGrantDto {
  return {
    grantId: grant.grantId,
    roleCode: grant.roleCode,
    subjectType: grant.subjectType,
    sourceType: grant.sourceType,
    permission: {
      appCode: grant.permission.appCode,
      resourceCode: grant.permission.resourceCode,
      action: grant.permission.action
    },
    active: grant.active,
    actionMatched: grant.actionMatched,
    scopeMatched: grant.scopeMatched,
    defaultScopes: grant.defaultScopes.map(serializeScope),
    assignmentScopes: grant.assignmentScopes.map(serializeScope),
    relationScopes: grant.relationScopes.map(serializeScope)
  }
}

export default defineEventHandler(async (event): Promise<unknown> => {
  const query = getQuery(event) as Record<string, unknown>
  const tenantCode = requireString(query.tenantCode, 'tenantCode')
  const uid = requireString(query.uid, 'uid')
  const appCode = requireString(query.appCode, 'appCode')
  const resourceCode = requireString(query.resourceCode, 'resourceCode')
  const action = requireString(query.action, 'action')

  const result = await explainDbAuthorization(tenantCode, uid, appCode, {
    activeRoleCode: authorizationQueryValue(query.activeRoleCode),
    authorizationMode: authorizationQueryValue(query.authorizationMode),
    allowRoleSimulation: authorizationQueryValue(query.authorizationMode) === 'role_simulation',
    allowUserSimulation: authorizationQueryValue(query.authorizationMode) === 'user_simulation',
    includeBaseline: authorizationQueryBooleanValue(query.includeBaseline, true),
    required: {
      appCode,
      resourceCode,
      action
    },
    object: authorizationObjectContextFromQuery(query, uid)
  })

  const data: ExplainResponseDto = {
    uid: result.uid,
    tenantCode: result.tenantCode,
    subjectId: result.subjectId,
    selectedRoleCodes: result.selectedRoleCodes,
    availableRoleCodes: result.availableRoleCodes,
    activeRoleCode: result.activeRoleCode,
    allowed: result.allowed,
    reasonCode: result.reasonCode,
    matchedAction: result.matchedAction || null,
    matchedGrant: result.matchedGrant ? serializeGrant(result.matchedGrant) : null,
    candidateGrants: result.candidateGrants.map(serializeGrant)
  }

  return {
    success: true,
    data
  }
})

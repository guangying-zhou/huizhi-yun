import { actionSatisfies } from '@hzy/authz-core'
import { buildScopedAuthorizationGrantsFromPolicyBundle } from '@hzy/foundation/server/utils/applicationAuthorization'
import {
  evaluateFoundationScopedAuthorization,
  type FoundationObjectContext,
  type FoundationScopedAuthorizationDecision,
  type FoundationScopedAuthorizationGrant
} from '@hzy/foundation/server/utils/scopeEvaluator'
import type { H3Event } from 'h3'
import {
  loadPolicyAuthorizationSnapshot,
  type PolicyAuthorizationOptions,
  type PolicyAuthorizationRole
} from './policyAuthorization'

export interface PolicyScopedAuthorizationOptions extends PolicyAuthorizationOptions {
  resourceCode?: string | null
  action?: string | null
  object?: FoundationObjectContext | null
}

export interface PolicyScopedAuthorizationSnapshot {
  uid: string
  appCode: string
  roles: string[]
  availableRoles: PolicyAuthorizationRole[]
  activeRoleCode: string
  authorizationMode: string
  bundleVersion: string
  bundleHash: string
  grants: FoundationScopedAuthorizationGrant[]
  decision?: FoundationScopedAuthorizationDecision
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function permissionMatches(
  permission: { appCode: string, resourceCode: string, action: string },
  appCode: string,
  resourceCode: string,
  action: string
) {
  if (permission.appCode !== appCode) return false
  if (resourceCode && permission.resourceCode !== resourceCode) return false
  if (action && !actionSatisfies(permission.action, action)) return false
  return true
}

function filterGrants(
  grants: FoundationScopedAuthorizationGrant[],
  appCode: string,
  resourceCode: string,
  action: string
) {
  return grants
    .map(grant => ({
      ...grant,
      permissions: grant.permissions.filter(permission =>
        permissionMatches(permission, appCode, resourceCode, action)
      )
    }))
    .filter(grant => grant.permissions.length > 0)
}

export async function loadPolicyScopedAuthorization(
  uid: string,
  targetAppCode: string,
  event: H3Event,
  options: PolicyScopedAuthorizationOptions = {}
): Promise<PolicyScopedAuthorizationSnapshot> {
  const appCode = stringValue(targetAppCode)
  const resourceCode = stringValue(options.resourceCode)
  const action = stringValue(options.action)
  const snapshot = await loadPolicyAuthorizationSnapshot(uid, appCode, event, options)

  const grantResult = buildScopedAuthorizationGrantsFromPolicyBundle({
    payload: snapshot.payload || {},
    uid: snapshot.uid,
    requestedRoleCode: snapshot.activeRoleCode,
    authorizationMode: snapshot.authorizationMode,
    allowRoleSimulation: snapshot.authorizationMode === 'role_simulation',
    allowUserSimulation: snapshot.authorizationMode === 'user_simulation',
    allowPrivileged: snapshot.authorizationMode === 'privileged',
    includeBaseline: snapshot.includeBaseline
  })
  const grants = filterGrants(grantResult.grants, appCode, resourceCode, action)
  const decision = resourceCode && action
    ? evaluateFoundationScopedAuthorization({
        grants,
        required: {
          appCode,
          resourceCode,
          action
        },
        object: options.object || undefined
      })
    : undefined

  return {
    uid: snapshot.uid,
    appCode,
    roles: snapshot.roles,
    availableRoles: snapshot.availableRoles,
    activeRoleCode: snapshot.activeRoleCode,
    authorizationMode: snapshot.authorizationMode,
    bundleVersion: snapshot.bundleVersion,
    bundleHash: snapshot.bundleHash,
    grants,
    decision
  }
}

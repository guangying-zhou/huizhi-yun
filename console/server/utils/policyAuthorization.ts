import { appCode as defaultAppCode, manifestResources } from '~~/app/config/permissions'
import { getCookie, getHeader, getQuery, type H3Event } from 'h3'
import { actionSatisfies, resolveAuthorizationMode, selectEffectiveRoleCodes, type AuthorizationMode } from '@hzy/authz-core'
import { isEnterpriseRoleRecord } from '@hzy/foundation/server/utils/authorizationRoles'
import {
  getCachedBundleInvalidReason,
  readActivationStatus,
  readCachedBundle
} from '~~/server/utils/bundleCache'
import {
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'
import { expireAuthorizationSimulationSessionIfNeeded } from '~~/server/utils/authorizationSimulation'

type BundleRecord = Record<string, unknown>
type PermissionAction = string

export interface RuntimePermissionInput {
  appCode?: string
  resourceCode?: string
  action?: string
  actions?: string[]
}

export interface PolicyAuthorizationRole {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  sources: string[]
}

export interface PolicyAuthorizationSnapshot {
  uid: string
  roles: string[]
  availableRoles: PolicyAuthorizationRole[]
  activeRoleCode: string
  authorizationMode: AuthorizationMode
  includeBaseline: boolean
  permissions: Array<{
    appCode: string
    resourceCode: string
    action: string
  }>
  resources: Record<string, string[]>
  bundleVersion: string
  bundleHash: string
  payload?: Record<string, unknown>
}

export interface PolicyAuthorizationOptions {
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
  ignoreSimulationSession?: boolean
}

export class PolicyAuthorizationError extends Error {
  statusCode: number
  reason: string

  constructor(reason: string, message: string, statusCode = 403) {
    super(message)
    this.name = 'PolicyAuthorizationError'
    this.reason = reason
    this.statusCode = statusCode
  }
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function queryValue(value: unknown) {
  return stringValue(Array.isArray(value) ? value[0] : value)
}

const ACTIVE_ENTERPRISE_ROLE_COOKIE = 'hzy_active_enterprise_role'

function activeRoleCookieName(_appCode?: string) {
  return ACTIVE_ENTERPRISE_ROLE_COOKIE
}

export function resolveRequestedActiveRoleCode(event: H3Event | undefined, targetAppCode = defaultAppCode) {
  if (!event) return ''

  const query = getQuery(event)
  return queryValue(query.activeRoleCode)
    || queryValue(query.roleCode)
    || stringValue(getHeader(event, 'x-hzy-active-role'))
    || stringValue(getCookie(event, activeRoleCookieName(targetAppCode)))
    || stringValue(getCookie(event, 'hzy_active_role'))
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function isActive(record: BundleRecord) {
  const status = stringValue(record.status)
  return !status || status === 'active'
}

function appMatches(appCode: unknown, targetAppCode: string) {
  const normalized = stringValue(appCode)
  return !normalized || normalized === targetAppCode
}

function isLegacyConsoleViewerRole(roleCode: string) {
  return roleCode === 'console.viewer'
    || roleCode === 'tenant_console_view'
    || roleCode === 'tenant_console_viewer'
}

function isLegacyConsoleViewerPermission(permission: BundleRecord, roleCode: string, targetAppCode: string) {
  if (targetAppCode !== defaultAppCode) return false
  if (!appMatches(permission.appCode, defaultAppCode)) return false

  return isLegacyConsoleViewerRole(roleCode)
    || isLegacyConsoleViewerRole(stringValue(permission.appRoleCode))
}

function manifestResourceActions(resource: BundleRecord) {
  const actions = Array.isArray(resource.actions)
    ? resource.actions.map(action => stringValue(action)).filter(Boolean)
    : []
  return actions.length ? actions : ['view']
}

function buildConsoleDevAuthorizationSnapshot(uid: string, targetAppCode: string): PolicyAuthorizationSnapshot {
  const resources: Record<string, string[]> = {}
  for (const resource of records(manifestResources)) {
    const resourceCode = stringValue(resource.code)
    if (resourceCode) {
      resources[resourceCode] = manifestResourceActions(resource)
    }
  }

  const permissions = Object.entries(resources).flatMap(([resourceCode, actions]) =>
    actions.map(action => ({
      appCode: targetAppCode,
      resourceCode,
      action
    }))
  )

  return {
    uid,
    roles: ['console:console-dev-admin'],
    availableRoles: [{
      roleCode: 'console:console-dev-admin',
      roleName: 'Console Dev Admin',
      roleType: 'dev',
      appCode: targetAppCode,
      sources: ['dev']
    }],
    activeRoleCode: 'console:console-dev-admin',
    authorizationMode: 'merged',
    includeBaseline: true,
    permissions,
    resources,
    bundleVersion: 'console-dev',
    bundleHash: 'console-dev',
    payload: {}
  }
}

function addRole(roleSources: Map<string, Set<string>>, roleCode: string, source: string) {
  if (!roleCode) return
  const sources = roleSources.get(roleCode) || new Set<string>()
  sources.add(source)
  roleSources.set(roleCode, sources)
}

function removeTemplateRole(roleSources: Map<string, Set<string>>, roleCode: string) {
  const sources = roleSources.get(roleCode)
  if (!sources) return
  sources.delete('template')
  if (!sources.size) {
    roleSources.delete(roleCode)
  }
}

function toRoleOption(roleCode: string, roleByCode: Map<string, BundleRecord>, sources: Set<string>): PolicyAuthorizationRole {
  const role = roleByCode.get(roleCode)
  return {
    roleCode,
    roleName: stringValue(role?.roleName) || roleCode,
    roleType: stringValue(role?.roleType),
    appCode: stringValue(role?.appCode) || null,
    sources: [...sources].sort()
  }
}

function buildAvailableRoles(
  roleSources: Map<string, Set<string>>,
  roleByCode: Map<string, BundleRecord>
) {
  return [...roleSources.entries()]
    .filter(([roleCode]) => {
      const role = roleByCode.get(roleCode)
      return role ? isEnterpriseRoleRecord(role) && isActive(role) : false
    })
    .map(([roleCode, sources]) => toRoleOption(roleCode, roleByCode, sources))
    .sort((left, right) => left.roleName.localeCompare(right.roleName, 'zh-CN') || left.roleCode.localeCompare(right.roleCode))
}

function hasManifestResource(resourceCode: string) {
  return manifestResources.some(resource => resource.code === resourceCode)
}

function isConsoleBaselinePermission(permission: BundleRecord) {
  return stringValue(permission.appCode) === defaultAppCode
}

export function isPolicyAuthorizationError(error: unknown): error is PolicyAuthorizationError {
  return error instanceof PolicyAuthorizationError
}

export function normalizeAuthorizationResources(
  permissions: RuntimePermissionInput[] = [],
  targetAppCode = defaultAppCode
) {
  const resourceMap = new Map<string, Set<string>>()

  for (const permission of permissions) {
    if (!appMatches(permission.appCode, targetAppCode)) continue

    const resourceCode = stringValue(permission.resourceCode)
    if (!resourceCode) continue

    const actions = Array.isArray(permission.actions)
      ? permission.actions.map(action => stringValue(action)).filter(Boolean)
      : [stringValue(permission.action)].filter(Boolean)

    if (!actions.length) continue

    const existing = resourceMap.get(resourceCode) || new Set<string>()
    for (const action of actions) {
      existing.add(action)
    }
    resourceMap.set(resourceCode, existing)
  }

  return Object.fromEntries(
    [...resourceMap.entries()].map(([resourceCode, actions]) => [resourceCode, [...actions].sort()])
  )
}

export function hasPermissionInSnapshot(
  snapshot: Pick<PolicyAuthorizationSnapshot, 'resources'> | { resources: Record<string, string[]> },
  resource: string,
  action: PermissionAction = 'admin'
) {
  const resourceCode = stringValue(resource)
  if (!resourceCode || !hasManifestResource(resourceCode)) return false

  const actions = snapshot.resources[resourceCode] || []
  // 动作蕴含判定统一走 @hzy/authz-core，与 platform authorization.ts 共用同一事实源。
  return actions.some(held => actionSatisfies(held, action))
}

export async function loadPolicyAuthorizationSnapshot(
  uid: string,
  targetAppCode = defaultAppCode,
  event?: H3Event,
  options: PolicyAuthorizationOptions = {}
): Promise<PolicyAuthorizationSnapshot> {
  const normalizedUid = stringValue(uid)
  if (!normalizedUid) {
    throw new PolicyAuthorizationError('missing_uid', 'uid is required', 401)
  }

  const runtimeMode = loadConsoleRuntimeMode(event)
  if (runtimeMode.devPolicyBypassEnabled) {
    return buildConsoleDevAuthorizationSnapshot(normalizedUid, targetAppCode)
  }
  if (!runtimeMode.runtimeEnabled) {
    throw new PolicyAuthorizationError(
      'platform_runtime_disabled',
      `console platform runtime is disabled for run mode ${runtimeMode.runMode}`,
      503
    )
  }

  let config
  try {
    config = loadPlatformRuntimeConfig(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new PolicyAuthorizationError('activation_config_invalid', message, 503)
  }

  const cacheScope = resolvePlatformRuntimeCacheScope(config, event)
  let [activationStatus, bundle] = await Promise.all([
    readActivationStatus(config.bundleCacheDir, cacheScope),
    readCachedBundle(config.bundleCacheDir, cacheScope)
  ])

  let invalidReason = getCachedBundleInvalidReason(bundle)
  const shouldRefreshManagedBundle = config.activationMode === 'managed-cloud-multitenant'
    && (invalidReason || !activationStatus.activated || !activationStatus.bundleReady)
  if (shouldRefreshManagedBundle) {
    const refresh = await refreshPlatformBundle('authorization-cache-miss', event)
    if (refresh.ok && refresh.bundle) {
      activationStatus = refresh.status
      bundle = refresh.bundle
      invalidReason = getCachedBundleInvalidReason(bundle)
    }
  }

  if (invalidReason) {
    throw new PolicyAuthorizationError('bundle_unavailable', invalidReason, 403)
  }
  if (!bundle) {
    throw new PolicyAuthorizationError('bundle_unavailable', 'policy bundle is missing', 403)
  }

  if (!activationStatus.activated || !activationStatus.bundleReady) {
    throw new PolicyAuthorizationError(
      'activation_incomplete',
      activationStatus.lastError || 'console activation is not complete',
      403
    )
  }

  if (bundle.tenantCode !== config.tenantCode) {
    throw new PolicyAuthorizationError(
      'bundle_tenant_mismatch',
      `policy bundle tenant mismatch: ${bundle.tenantCode} !== ${config.tenantCode}`,
      403
    )
  }

  if (config.deploymentCode && bundle.deploymentCode !== config.deploymentCode) {
    throw new PolicyAuthorizationError(
      'bundle_deployment_mismatch',
      `policy bundle deployment mismatch: ${bundle.deploymentCode} !== ${config.deploymentCode}`,
      403
    )
  }

  const simulationInspection = !options.ignoreSimulationSession && event
    ? await expireAuthorizationSimulationSessionIfNeeded(event, normalizedUid, {
        bundleVersion: bundle.bundleVersion,
        bundleHash: bundle.bundleHash
      })
    : { session: null, reason: null }
  const simulation = simulationInspection.reason ? null : simulationInspection.session
  const roleSimulation = simulation?.mode === 'role_simulation' ? simulation : null
  const userSimulation = simulation?.mode === 'user_simulation' ? simulation : null
  const effectiveUid = stringValue(userSimulation?.subjectCode) || normalizedUid

  const payload = bundle.payload || {}
  const subjects = records(payload.subjects)
  const subjectCodes = new Set<string>([effectiveUid])
  let hasActiveUserSubject = false

  for (const subject of subjects) {
    if (stringValue(subject.subjectType) !== 'user' || !isActive(subject)) continue

    const subjectCode = stringValue(subject.subjectCode)
    const externalRef = stringValue(subject.externalRef)
    if (subjectCode && (subjectCode === effectiveUid || externalRef === effectiveUid)) {
      hasActiveUserSubject = true
      subjectCodes.add(subjectCode)
    }
  }

  const roles = records(payload.roles)
  const systemRoles = records(payload.systemRoles)
  const roleByCode = new Map<string, BundleRecord>()
  const tenantRoleCodes = new Set<string>()

  for (const role of systemRoles) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      roleByCode.set(roleCode, role)
    }
  }

  for (const role of roles) {
    const roleCode = stringValue(role.roleCode)
    if (roleCode) {
      tenantRoleCodes.add(roleCode)
      roleByCode.set(roleCode, role)
    }
  }

  const roleSources = new Map<string, Set<string>>()

  for (const subjectRole of records(payload.subjectRoles)) {
    if (stringValue(subjectRole.subjectType) !== 'user') continue
    if (!subjectCodes.has(stringValue(subjectRole.subjectCode))) continue
    addRole(roleSources, stringValue(subjectRole.roleCode), 'direct')
  }

  const boundTemplateCodes = new Set<string>()
  for (const binding of records(payload.templateBindings)) {
    if (stringValue(binding.subjectType) !== 'user') continue
    if (!subjectCodes.has(stringValue(binding.subjectCode))) continue
    if (!isActive(binding)) continue

    const templateCode = stringValue(binding.templateCode)
    if (templateCode) boundTemplateCodes.add(templateCode)
  }

  for (const templateRole of records(payload.templateRoles)) {
    if (!boundTemplateCodes.has(stringValue(templateRole.templateCode))) continue
    addRole(roleSources, stringValue(templateRole.roleCode), 'template')
  }

  for (const override of records(payload.templateOverrides)) {
    if (stringValue(override.subjectType) !== 'user') continue
    if (!subjectCodes.has(stringValue(override.subjectCode))) continue
    if (!isActive(override)) continue

    const roleCode = stringValue(override.roleCode)
    if (stringValue(override.overrideType) === 'exclude') {
      removeTemplateRole(roleSources, roleCode)
      continue
    }

    addRole(roleSources, roleCode, 'override')
  }

  const simulatedRoleCode = stringValue(roleSimulation?.roleCode)
  const simulatedRole = simulatedRoleCode ? roleByCode.get(simulatedRoleCode) : null
  if (simulatedRole && isEnterpriseRoleRecord(simulatedRole) && isActive(simulatedRole)) {
    addRole(roleSources, simulatedRoleCode, 'simulation')
  }

  const requestedActiveRoleCode = roleSimulation?.roleCode
    || stringValue(options.activeRoleCode)
  const availableRoles = buildAvailableRoles(roleSources, roleByCode)
  const authorizationMode = resolveAuthorizationMode({
    requestedMode: userSimulation?.mode || roleSimulation?.mode || options.authorizationMode,
    allowRoleSimulation: options.allowRoleSimulation || Boolean(roleSimulation),
    allowUserSimulation: options.allowUserSimulation || Boolean(userSimulation),
    allowPrivileged: options.allowPrivileged
  })
  const selection = selectEffectiveRoleCodes({
    availableRoleCodes: availableRoles.map(role => role.roleCode),
    requestedRoleCode: requestedActiveRoleCode,
    mode: authorizationMode
  })
  const roleCodes = selection.roleCodes

  const roleCodeSet = new Set(roleCodes)
  const permissionInputs: RuntimePermissionInput[] = []

  for (const permission of records(payload.rolePermissions)) {
    const roleCode = stringValue(permission.roleCode)
    if (!roleCodeSet.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode, targetAppCode)) continue

    permissionInputs.push({
      appCode: stringValue(permission.appCode),
      resourceCode: stringValue(permission.resourceCode),
      action: stringValue(permission.action)
    })
  }

  for (const permission of records(payload.systemRolePermissions)) {
    const roleCode = stringValue(permission.roleCode)
    if (!roleCodeSet.has(roleCode) || tenantRoleCodes.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode, targetAppCode)) continue

    permissionInputs.push({
      appCode: stringValue(permission.appCode),
      resourceCode: stringValue(permission.resourceCode),
      action: stringValue(permission.action)
    })
  }

  const includeBaseline = roleSimulation?.includeBaseline !== false
  if (hasActiveUserSubject && includeBaseline) {
    for (const permission of records(payload.baselinePermissions)) {
      if (isConsoleBaselinePermission(permission)) continue

      permissionInputs.push({
        appCode: stringValue(permission.appCode),
        resourceCode: stringValue(permission.resourceCode),
        action: stringValue(permission.action)
      })
    }
  }

  const resources = normalizeAuthorizationResources(permissionInputs, targetAppCode)
  const permissions = Object.entries(resources).flatMap(([resourceCode, actions]) =>
    actions.map(action => ({
      appCode: targetAppCode,
      resourceCode,
      action
    }))
  )

  return {
    uid: effectiveUid,
    roles: roleCodes,
    availableRoles,
    activeRoleCode: selection.activeRoleCode,
    authorizationMode,
    includeBaseline,
    permissions,
    resources,
    bundleVersion: bundle.bundleVersion,
    bundleHash: bundle.bundleHash,
    payload
  }
}

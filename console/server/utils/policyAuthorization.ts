import { evaluateEnterpriseEntitlement } from './enterpriseEntitlement'
import { appCode as defaultAppCode, manifestResources } from '~~/app/config/permissions'
import type { H3Event } from 'h3'
import { actionSatisfies, isRecordActiveAt, resolveAuthorizationMode, selectEffectiveRoleCodes, type AuthorizationGrant, type AuthorizationMode, type ResourceActionPolicy } from '@hzy/authz-core'
import {
  baselineGrantAppliesToSubject,
  buildPolicyBundleActionPolicy
} from '@hzy/foundation/server/utils/applicationAuthorization'
import { normalizeAuthorizationResources } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import {
  buildFlatSnapshotGrants,
  evaluateFlatSnapshotPermission,
  type CollectedFlatPermission
} from './policyAuthorizationGrants'
import { isEnterpriseRoleRecord } from '@hzy/foundation/server/utils/authorizationRoles'
import {
  getCachedBundleInvalidReason,
  readActivationStatus,
  persistentPolicyStoreEnabled,
  readCachedBundle
} from '~~/server/utils/bundleCache'
import {
  loadConsoleRuntimeMode,
  loadPlatformRuntimeConfig,
  refreshPlatformBundle,
  resolvePlatformRuntimeCacheScope
} from '~~/server/utils/platformRuntime'
import { expireAuthorizationSimulationSessionIfNeeded } from '~~/server/utils/authorizationSimulation'
import { policyBundleDeploymentMatchesRuntime } from '~~/server/utils/platformRuntimePolicyContextCore'
import { createHash } from 'node:crypto'
import { createBundleRefreshFlight } from './bundleRefreshFlight'
import { measureRequestStage } from '@hzy/foundation/server/utils/performanceTiming'

const refreshAuthorizationBundle = createBundleRefreshFlight<Awaited<ReturnType<typeof refreshPlatformBundle>>>()

type BundleRecord = Record<string, unknown>
type PermissionAction = string

export interface PolicyAuthorizationRole {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  sources: string[]
}

export interface PolicyAuthorizationSnapshot {
  uid: string
  appCode: string
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
  actionPolicies: Record<string, ResourceActionPolicy>
  /** 扁平快照授权单元（不含范围谓词）；permissions/resources 由此派生，判定走 evaluate()。 */
  grants: AuthorizationGrant[]
  bundleVersion: string
  bundleHash: string
  policyRevision: number | null
  payload?: Record<string, unknown>
}

export interface PolicyAuthorizationOptions {
  activeRoleCode?: string | null
  authorizationMode?: AuthorizationMode | string | null
  allowRoleSimulation?: boolean
  allowUserSimulation?: boolean
  allowPrivileged?: boolean
  ignoreSimulationSession?: boolean
  /**
   * 绕过同进程内的授权快照缓存。用于通知详情等必须在每次读取时重新计算的高风险路径；
   * 不会绕过 tenant/deployment 绑定或 policy bundle 完整性校验。
   */
  bypassSnapshotCache?: boolean
}

export interface PolicyAuthorizationSnapshotFromPayloadInput {
  uid: string
  targetAppCode?: string | null
  payload?: Record<string, unknown> | null
  bundleVersion?: string | null
  bundleHash?: string | null
  options?: PolicyAuthorizationOptions
  roleSimulation?: {
    mode?: AuthorizationMode | string | null
    roleCode?: string | null
    includeBaseline?: boolean | null
  } | null
  userSimulation?: {
    mode?: AuthorizationMode | string | null
    subjectCode?: string | null
  } | null
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

// snapshot 内存缓存：相同 (scope, bundleHash, uid, appCode, mode, role, allowFlags) 的
// 计算结果是确定的；bundleHash 变 → 自动失效。只缓存无 simulation 的常规请求（simulation
// 必须每次检查会话过期）。这是 Worker 上 CPU 占用的主要节流点：避免对整个 bundle 做多轮
// 全量遍历。
interface SnapshotCacheEntry {
  snapshot: PolicyAuthorizationSnapshot
  expiresAt: number
}
const SNAPSHOT_CACHE_MAX = 256
const SNAPSHOT_CACHE_TTL_MS = 30_000
const snapshotCache = new Map<string, SnapshotCacheEntry>()

function snapshotCacheKey(parts: {
  scope: string
  bundleHash: string
  uid: string
  appCode: string
  requestedMode: string
  requestedRole: string
  allowFlags: number
}) {
  return [
    parts.scope,
    parts.bundleHash,
    parts.uid,
    parts.appCode,
    parts.requestedMode,
    parts.requestedRole,
    parts.allowFlags
  ].join('|')
}

function snapshotCacheGet(key: string): PolicyAuthorizationSnapshot | null {
  const entry = snapshotCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    snapshotCache.delete(key)
    return null
  }
  // LRU: 重新插入以更新最近使用顺序（Map 保持插入顺序）。
  snapshotCache.delete(key)
  snapshotCache.set(key, entry)
  return entry.snapshot
}

function snapshotCacheSet(key: string, snapshot: PolicyAuthorizationSnapshot) {
  if (snapshotCache.size >= SNAPSHOT_CACHE_MAX) {
    const oldest = snapshotCache.keys().next().value
    if (oldest !== undefined) snapshotCache.delete(oldest)
  }
  snapshotCache.set(key, { snapshot, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS })
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function records(value: unknown): BundleRecord[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as BundleRecord[]
    : []
}

function preferredRecords(payload: Record<string, unknown>, preferredKey: string, fallbackKey: string) {
  const preferred = records(payload[preferredKey])
  return preferred.length ? preferred : records(payload[fallbackKey])
}

function roleAssignmentRecords(payload: Record<string, unknown>) {
  return preferredRecords(payload, 'roleAssignments', 'subjectRoles')
}

function baselineGrantRecords(payload: Record<string, unknown>) {
  return preferredRecords(payload, 'baselineGrants', 'baselinePermissions')
}

function rolePermissionGrantRecords(payload: Record<string, unknown>) {
  return preferredRecords(payload, 'rolePermissionGrants', 'rolePermissions')
}

function policyRevisionFromPayload(payload: Record<string, unknown>) {
  const raw = payload.policyRevision
  if (typeof raw === 'number' && Number.isSafeInteger(raw)) return raw
  const parsed = Number.parseInt(stringValue(raw), 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isActive(record: BundleRecord) {
  return isRecordActiveAt(record)
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
  const actionPolicies: Record<string, ResourceActionPolicy> = {}
  const grants = buildFlatSnapshotGrants(
    permissions.map(permission => ({
      origin: 'role_permission' as const,
      roleCode: 'console:console-dev-admin',
      ...permission
    })),
    targetAppCode
  )

  return {
    uid,
    appCode: targetAppCode,
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
    actionPolicies,
    grants,
    bundleVersion: 'console-dev',
    bundleHash: 'console-dev',
    policyRevision: null,
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

function subjectKey(subjectType: unknown, subjectCode: unknown) {
  const type = stringValue(subjectType)
  const code = stringValue(subjectCode)
  return type && code ? `${type}:${code}` : ''
}

function buildEffectiveSubjectKeys(uid: string, payload: Record<string, unknown>) {
  const subjectCodes = new Set<string>([uid])
  const effectiveSubjectKeys = new Set<string>()
  let hasActiveUserSubject = false

  for (const subject of records(payload.subjects)) {
    if (stringValue(subject.subjectType) !== 'user' || !isActive(subject)) continue

    const subjectCode = stringValue(subject.subjectCode)
    const externalRef = stringValue(subject.externalRef)
    if (subjectCode && (subjectCode === uid || externalRef === uid)) {
      hasActiveUserSubject = true
      subjectCodes.add(subjectCode)
    }
  }

  for (const subjectCode of subjectCodes) {
    if (subjectCode) effectiveSubjectKeys.add(subjectKey('user', subjectCode))
  }

  for (const membership of records(payload.subjectMemberships)) {
    if (!isActive(membership)) continue
    if (stringValue(membership.subjectType) !== 'user') continue
    if (!subjectCodes.has(stringValue(membership.subjectCode))) continue
    if (!['member', 'manager', 'leader'].includes(stringValue(membership.relationType) || 'member')) continue

    const containerSubjectType = stringValue(membership.containerSubjectType)
    if (!['department', 'job'].includes(containerSubjectType)) continue

    const key = subjectKey(containerSubjectType, membership.containerSubjectCode)
    if (key) effectiveSubjectKeys.add(key)
  }

  return { effectiveSubjectKeys, hasActiveUserSubject }
}

export function buildPolicyAuthorizationSnapshotFromPayload(
  input: PolicyAuthorizationSnapshotFromPayloadInput
): PolicyAuthorizationSnapshot {
  const normalizedUid = stringValue(input.uid)
  const targetAppCode = stringValue(input.targetAppCode) || defaultAppCode
  const payload = input.payload || {}
  const options = input.options || {}
  const roleSimulation = input.roleSimulation || null
  const userSimulation = input.userSimulation || null
  const effectiveUid = stringValue(userSimulation?.subjectCode) || normalizedUid
  const { effectiveSubjectKeys, hasActiveUserSubject } = buildEffectiveSubjectKeys(effectiveUid, payload)

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

  for (const subjectRole of roleAssignmentRecords(payload)) {
    if (!effectiveSubjectKeys.has(subjectKey(subjectRole.subjectType, subjectRole.subjectCode))) continue
    if (!isActive(subjectRole)) continue
    addRole(roleSources, stringValue(subjectRole.roleCode), 'direct')
  }

  const boundTemplateCodes = new Set<string>()
  for (const binding of records(payload.templateBindings)) {
    if (!effectiveSubjectKeys.has(subjectKey(binding.subjectType, binding.subjectCode))) continue
    if (!isActive(binding)) continue

    const templateCode = stringValue(binding.templateCode)
    if (templateCode) boundTemplateCodes.add(templateCode)
  }

  for (const templateRole of records(payload.templateRoles)) {
    if (!boundTemplateCodes.has(stringValue(templateRole.templateCode))) continue
    addRole(roleSources, stringValue(templateRole.roleCode), 'template')
  }

  for (const override of records(payload.templateOverrides)) {
    if (!effectiveSubjectKeys.has(subjectKey(override.subjectType, override.subjectCode))) continue
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
  const collectedPermissions: CollectedFlatPermission[] = []

  for (const permission of rolePermissionGrantRecords(payload)) {
    const roleCode = stringValue(permission.roleCode)
    if (!roleCodeSet.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode, targetAppCode)) continue

    collectedPermissions.push({
      origin: 'role_permission',
      roleCode,
      appCode: stringValue(permission.appCode),
      resourceCode: stringValue(permission.resourceCode),
      action: stringValue(permission.action)
    })
  }

  for (const permission of records(payload.systemRolePermissions)) {
    const roleCode = stringValue(permission.roleCode)
    if (!roleCodeSet.has(roleCode) || tenantRoleCodes.has(roleCode)) continue
    if (isLegacyConsoleViewerPermission(permission, roleCode, targetAppCode)) continue

    collectedPermissions.push({
      origin: 'system_role_permission',
      roleCode,
      appCode: stringValue(permission.appCode),
      resourceCode: stringValue(permission.resourceCode),
      action: stringValue(permission.action)
    })
  }

  const includeBaseline = roleSimulation?.includeBaseline !== false
  if (hasActiveUserSubject && includeBaseline) {
    for (const permission of baselineGrantRecords(payload)) {
      if (!baselineGrantAppliesToSubject(permission, effectiveUid)) continue
      if (isConsoleBaselinePermission(permission)) continue

      collectedPermissions.push({
        origin: 'baseline',
        appCode: stringValue(permission.appCode),
        resourceCode: stringValue(permission.resourceCode),
        action: stringValue(permission.action)
      })
    }
  }

  // 授权单元是唯一权限事实：resources/permissions 从 grants 派生，保证扁平快照
  // 展示的权限集合与 evaluate() 判定看到的授权单元不会漂移。
  const grants = buildFlatSnapshotGrants(collectedPermissions, targetAppCode)
  const resources = normalizeAuthorizationResources(
    grants.map(grant => grant.permission),
    targetAppCode
  )
  const permissions = Object.entries(resources).flatMap(([resourceCode, actions]) =>
    actions.map(action => ({
      appCode: targetAppCode,
      resourceCode,
      action
    }))
  )
  const actionPolicies = Object.fromEntries(
    Object.keys(resources).flatMap((resourceCode) => {
      const policy = buildPolicyBundleActionPolicy(payload, targetAppCode, resourceCode)
      return policy ? [[resourceCode, policy] as const] : []
    })
  )

  return {
    uid: effectiveUid,
    appCode: targetAppCode,
    roles: roleCodes,
    availableRoles,
    activeRoleCode: selection.activeRoleCode,
    authorizationMode,
    includeBaseline,
    permissions,
    resources,
    actionPolicies,
    grants,
    bundleVersion: stringValue(input.bundleVersion),
    bundleHash: stringValue(input.bundleHash),
    policyRevision: policyRevisionFromPayload(payload),
    payload
  }
}

export function isPolicyAuthorizationError(error: unknown): error is PolicyAuthorizationError {
  return error instanceof PolicyAuthorizationError
}

export function hasPermissionInSnapshot(
  snapshot: {
    resources: Record<string, string[]>
    payload?: Record<string, unknown>
    appCode?: string
    grants?: AuthorizationGrant[]
    actionPolicies?: Record<string, ResourceActionPolicy>
  },
  resource: string,
  action: PermissionAction = 'admin'
) {
  const resourceCode = stringValue(resource)
  if (!resourceCode || !hasManifestResource(resourceCode)) return false

  const actionPolicy = snapshot.actionPolicies?.[resourceCode]
    || buildPolicyBundleActionPolicy(snapshot.payload, defaultAppCode, resourceCode)

  // 主路径：按授权单元经 @hzy/authz-core evaluate() 判定，与 scoped / explain 共用同一决策引擎。
  if (Array.isArray(snapshot.grants) && snapshot.grants.length) {
    return evaluateFlatSnapshotPermission(snapshot.grants, {
      appCode: stringValue(snapshot.appCode) || defaultAppCode,
      resourceCode,
      action
    }, actionPolicy).allowed
  }

  const actions = snapshot.resources[resourceCode] || []
  // 兼容路径（无授权单元的裸 resources 快照）：动作蕴含判定统一走 @hzy/authz-core，
  // 与 platform authorization.ts 共用同一事实源。
  return actions.some(held => actionSatisfies(held, action, actionPolicy))
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
    readActivationStatus(config.bundleCacheDir, cacheScope, event),
    readCachedBundle(config.bundleCacheDir, cacheScope, event)
  ]).catch((error) => {
    if (persistentPolicyStoreEnabled()) throw new PolicyAuthorizationError('bundle_unavailable', 'persistent policy bundle unavailable', 503)
    throw error
  })

  let invalidReason = getCachedBundleInvalidReason(bundle)
  const shouldRefreshManagedBundle = config.activationMode === 'managed-cloud-multitenant'
    && !persistentPolicyStoreEnabled()
    && (invalidReason || !activationStatus.activated || !activationStatus.bundleReady)
  if (shouldRefreshManagedBundle) {
    // Include the full runtime configuration (hashed, never logged) so tenants,
    // deployments, endpoints and credential rotations cannot share a flight.
    const refreshKey = createHash('sha256').update(JSON.stringify([cacheScope, config])).digest('hex')
    const runRefresh = () => refreshAuthorizationBundle(refreshKey, () => refreshPlatformBundle('authorization-cache-miss', event))
    const refresh = event
      ? await measureRequestStage(event, 'policy_refresh', runRefresh)
      : await runRefresh()
    if (refresh.ok && refresh.bundle) {
      activationStatus = refresh.status
      bundle = refresh.bundle
      invalidReason = getCachedBundleInvalidReason(bundle)
    }
  }

  if (invalidReason) {
    throw new PolicyAuthorizationError('bundle_unavailable', invalidReason,
      invalidReason === 'enterprise_entitlement_invalid' || invalidReason.startsWith('policy bundle is not active:') ? 403 : 503)
  }
  if (!bundle) {
    throw new PolicyAuthorizationError('bundle_unavailable', 'policy bundle is missing', 503)
  }

  if (bundle.tenantCode !== config.tenantCode) {
    throw new PolicyAuthorizationError(
      'bundle_tenant_mismatch',
      `policy bundle tenant mismatch: ${bundle.tenantCode} !== ${config.tenantCode}`,
      403
    )
  }

  if (!policyBundleDeploymentMatchesRuntime({
    activationMode: config.activationMode,
    runtimeDeploymentCode: config.deploymentCode,
    bundleDeploymentCode: bundle.deploymentCode
  })) {
    throw new PolicyAuthorizationError(
      'bundle_deployment_mismatch',
      `policy bundle deployment mismatch: ${bundle.deploymentCode} !== ${config.deploymentCode}`,
      403
    )
  }

  const enterprise = evaluateEnterpriseEntitlement(bundle.payload, config.tenantCode)
  if (!enterprise.allowed) throw new PolicyAuthorizationError(enterprise.reason || 'enterprise_entitlement_inactive', 'Enterprise access is not active', 403)

  if (!activationStatus.activated || !activationStatus.bundleReady) {
    throw new PolicyAuthorizationError(
      'activation_incomplete',
      activationStatus.lastError || 'console activation is not complete',
      503
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

  // 无 simulation 时走快路径：相同输入复用上次结果，避免对 bundle 做多轮全量遍历。
  // 缓存键含 bundleHash，bundle 一更新即自然失效；权限撤销最多滞后 TTL（默认 30s）。
  const allowFlags = (options.allowPrivileged ? 1 : 0)
    | (options.allowRoleSimulation ? 2 : 0)
    | (options.allowUserSimulation ? 4 : 0)
    | (options.ignoreSimulationSession ? 8 : 0)
  const canUseSnapshotCache = !simulation && !options.bypassSnapshotCache
  const cacheKeyValue = canUseSnapshotCache
    ? snapshotCacheKey({
        scope: cacheScope || '',
        bundleHash: bundle.bundleHash,
        uid: normalizedUid,
        appCode: targetAppCode,
        requestedMode: stringValue(options.authorizationMode),
        requestedRole: stringValue(options.activeRoleCode),
        allowFlags
      })
    : ''
  if (cacheKeyValue) {
    const cached = snapshotCacheGet(cacheKeyValue)
    if (cached) return cached
  }

  const snapshot = buildPolicyAuthorizationSnapshotFromPayload({
    uid: normalizedUid,
    targetAppCode,
    payload: bundle.payload,
    bundleVersion: bundle.bundleVersion,
    bundleHash: bundle.bundleHash,
    options,
    roleSimulation,
    userSimulation
  })
  if (cacheKeyValue) snapshotCacheSet(cacheKeyValue, snapshot)
  return snapshot
}

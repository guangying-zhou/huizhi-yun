import { createHash } from 'node:crypto'
import { createError } from 'h3'
import { parseRecommendedRoles } from './manifestRoleDefinition.ts'
import { stableStringifyPolicyPayload } from './policyEnvelopeDelivery.ts'

// Bundle fact rows are heterogeneous; the selected manifest parser validates authorization fields.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fact = Record<string, any>
export interface AppPin { appCode: string, releaseId: number | null }
export interface ResolvedAppRelease extends AppPin {
  releaseId: number
  releaseVersion: string
  releaseKind?: string
  sourceTag: string
  manifestId: number
  manifestHash: string
  manifest: Fact
  resources: Fact[]
  actions: Fact[]
}
export interface EnvironmentAppSelection {
  revision: number
  sourceBundleId: number | null
  sourceBundleHash: string | null
  baseline: Fact | null
  pins: AppPin[]
  releases: ResolvedAppRelease[]
}
export const pinHash = (value: unknown) => createHash('sha256').update(stableStringifyPolicyPayload(value)).digest('hex')
export function pinEnvironment(value: unknown) {
  if (!['prod', 'test', 'dev'].includes(String(value))) throw createError({ statusCode: 400, message: '必须明确选择 prod/test/dev 环境' })
  return String(value)
}
export function parseAppPins(value: unknown): AppPin[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw createError({ statusCode: 400, message: '应用版本选择必须为 1–100 项' })
  const seen = new Set<string>()
  return value.map((p) => {
    if (!p || Object.keys(p).some(k => !['appCode', 'releaseId'].includes(k)) || !/^[a-z][a-z0-9-]{0,63}$/.test(p.appCode) || seen.has(p.appCode)
      || (p.releaseId !== null && (!Number.isSafeInteger(p.releaseId) || p.releaseId <= 0))) throw createError({ statusCode: 400, message: '应用或 releaseId 无效/重复' })
    seen.add(p.appCode)
    return { appCode: p.appCode, releaseId: p.releaseId }
  }).sort((a, b) => a.appCode.localeCompare(b.appCode))
}
const rows = (value: unknown): Fact[] => Array.isArray(value) ? value : []
const key = (r: Fact) => `${r.appCode}:${r.resourceCode}:${r.action}`

export function selectedAppCodes(selection: EnvironmentAppSelection) {
  // Old envelopes do not record release IDs for routing-only apps (e.g. Enterprise).
  // Preserve their route metadata, never invent a historical permission release.
  const withCatalog = new Set(rows(selection.baseline?.manifestResources).map(r => r.appCode))
  const routingOnly = rows(selection.baseline?.applications).filter(a => !withCatalog.has(a.appCode)).map(a => String(a.appCode))
  return [...new Set([...selection.releases.map(r => r.appCode), ...routingOnly])].sort()
}

/** Pure projection: never materializes global recommended roles or restores subject assignments. */
export function projectEnvironmentReleaseFacts(facts: Fact, selection: EnvironmentAppSelection) {
  const result = { ...facts }
  const releases = selection.releases
  const codes = new Set(selectedAppCodes(selection))
  const allActions = releases.flatMap(r => r.actions)
  const actions = new Map(allActions.map(a => [key(a), a]))
  const valid = (r: Fact) => actions.has(key(r))
  const remap = (r: Fact) => ({ ...r, ...(Object.hasOwn(r, 'manifestActionId') ? { manifestActionId: actions.get(key(r))?.id ?? r.manifestActionId } : {}), ...(Object.hasOwn(r, 'sourceManifestActionId') ? { sourceManifestActionId: actions.get(key(r))?.id ?? r.sourceManifestActionId } : {}) })
  result.manifestResources = releases.flatMap(r => r.resources)
  result.manifestActions = allActions.map(({ id: _id, ...action }) => action)
  result.manifestActionImplications = releases.flatMap(r => rows(r.manifest.actionImplications).map(i => ({ ...i, appCode: r.appCode, source: 'app-manifest' })))
  result.appRoles = []
  result.appRolePermissions = []
  result.appRoleScopes = []
  for (const release of releases) {
    if (release.appCode === 'collab') continue
    const historical = selection.baseline && rows(selection.baseline.manifestResources).some(r => r.appCode === release.appCode && Number(r.manifestId) === release.manifestId)
    // Historical role metadata is signed evidence; permissions still validate against the selected manifest.
    const old = historical ? selection.baseline! : null
    const definitions = parseRecommendedRoles(release.appCode, release.manifest)
    if (new Set(definitions.map(r => r.roleCode)).size !== definitions.length) throw createError({ statusCode: 409, message: '选定 manifest 含重复角色' })
    const historicalRoles = rows(old?.appRoles).filter(r => r.appCode === release.appCode)
    for (const role of definitions) {
      if (['console.viewer', 'tenant_console_view', 'tenant_console_viewer'].includes(role.roleCode)) continue
      const priorRole = historicalRoles.find(r => r.roleCode === role.roleCode)
      result.appRoles.push(priorRole || { roleCode: role.roleCode, roleName: role.roleName, roleType: 'app', appCode: release.appCode, description: role.description, isRequired: 0, status: 'active' })
      const permissions = role.permissions.map((p) => {
        const action = actions.get(key(p))
        if (!action) throw createError({ statusCode: 409, message: `选定 manifest 的角色引用无效动作：${role.roleCode}/${key(p)}` })
        return { roleCode: role.roleCode, ...p, manifestActionId: action.id }
      })
      result.appRolePermissions.push(...permissions)
      const permissionKeys = new Set(permissions.map(key))
      // Manual grants/revocations remain live, never restored from a historical bundle.
      // Global latest manifest_default rows are not inputs to a pinned release.
      const manual = rows(facts.appRoleScopes).filter(s => s.roleCode === role.roleCode && s.sourceType === 'manual' && permissionKeys.has(key(s)))
      const scopeKey = (s: Fact) => `${key(s)}:${s.scopeType}:${s.scopeValue}`
      const manualKeys = new Set(manual.map(scopeKey))
      const scopes = manual.filter(s => s.status === 'active').map(({ sourceType: _sourceType, ...scope }) => remap(scope))
      scopes.push(...(role.defaultScopes || []).filter(s => !manualKeys.has(scopeKey(s))).map(s => ({ roleCode: role.roleCode, ...s, manifestActionId: actions.get(key(s))!.id, status: 'active' })))
      result.appRoleScopes.push(...scopes)
    }
  }
  const roleCodes = new Set(result.appRoles.map((r: Fact) => r.roleCode))
  result.systemAppRoleMaps = rows(facts.systemAppRoleMaps).filter(m => roleCodes.has(m.appRoleCode))
  result.roleAppRoleMaps = rows(facts.roleAppRoleMaps).filter(m => roleCodes.has(m.appRoleCode))
  // Tenant mappings are live governance facts, including an intentionally empty set.
  // System templates describe defaults; a preview must not replay them over tenant decisions.
  // The collector already joins active tenant roles; keep a second active-role intersection
  // for pure/offline callers. Never restore a mapping from the historical baseline.
  const activeRoles = new Set(rows(facts.roles).filter(r => !r.status || r.status === 'active').map(r => r.roleCode))
  result.roleAppRoleMaps = result.roleAppRoleMaps.filter((m: Fact) => activeRoles.has(m.roleCode))
  for (const [target, source] of ([['rolePermissions', 'appRolePermissions'], ['roleScopes', 'appRoleScopes']] as const)) {
    result[target] = rows(facts[target]).filter(r => r.sourceType !== 'app_role' && valid(r)).map(remap)
    for (const mapping of result.roleAppRoleMaps) {
      result[target].push(...result[source].filter((p: Fact) => p.roleCode === mapping.appRoleCode).map((p: Fact) => {
        const { manifestActionId, ...rest } = p
        return { ...rest, roleCode: mapping.roleCode, appRoleCode: mapping.appRoleCode, sourceType: 'app_role', sourceManifestActionId: manifestActionId }
      }))
    }
  }
  // Never create baseline permissions from a manifest. Existing grants are intersected with selected actions.
  result.baselinePermissions = rows(facts.baselinePermissions).filter(valid)
  result.subjectRoleScopes = rows(facts.subjectRoleScopes).filter(r => !r.appCode || valid(r)).map(remap)
  for (const field of ['appRoles', 'appRolePermissions', 'appRoleScopes', 'roleAppRoleMaps', 'rolePermissions', 'roleScopes']) {
    result[field].sort((a: Fact, b: Fact) => stableStringifyPolicyPayload(a).localeCompare(stableStringifyPolicyPayload(b)))
  }
  result.applications = rows(facts.applications).filter(a => codes.has(a.appCode))
  return result
}

/** Full semantic diff includes scopes/assignments; excludes array order and top-level clocks. */
export function diffEnvironmentPolicy(before: Fact, after: Fact) {
  const clean = (v: unknown): unknown => Array.isArray(v)
    ? v.map(clean).sort((a, b) => stableStringifyPolicyPayload(a).localeCompare(stableStringifyPolicyPayload(b)))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v
  const changes: Fact[] = []
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (['generatedAt', 'policyRevision'].includes(field)) continue
    const a = clean(before[field] ?? null)
    const b = clean(after[field] ?? null)
    if (stableStringifyPolicyPayload(a) === stableStringifyPolicyPayload(b)) continue
    if (Array.isArray(a) && Array.isArray(b)) {
      const old = new Set(a.map(stableStringifyPolicyPayload))
      const next = new Set(b.map(stableStringifyPolicyPayload))
      changes.push({ field, removed: a.filter(v => !next.has(stableStringifyPolicyPayload(v))), added: b.filter(v => !old.has(stableStringifyPolicyPayload(v))) })
    } else changes.push({ field, before: a, after: b })
  }
  return changes
}

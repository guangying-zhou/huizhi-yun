import { collectConfiguredBaselinePermissionsWithQueries } from '../server/utils/policyBundleBaseline.ts'
import { overlayExportedGovernance } from './offlinePolicyGovernance.ts'
import { reviewEnvironmentPolicy } from '../server/utils/environmentPolicyReview.ts'
// Protected local snapshots only. No network, DB driver, signing, or raw payload output.
import { readFile, writeFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { planMigrationBaselines, registerMigrationBaselines } from '../server/utils/migrationBaselineReleases.ts'
import { loadEnvironmentAppSelection, pinsFromBundle, selectionReceipt, type PinTransaction } from '../server/utils/environmentAppReleases.ts'
import { diffEnvironmentPolicy, pinHash, projectEnvironmentReleaseFacts, type Fact } from '../server/utils/environmentAppReleaseModel.ts'
import { buildPolicyBundleV2CompatFields } from '../server/utils/policyBundleV2.ts'

const dir = process.argv[2], report = process.argv[3]
if (!dir || !report) throw Error('Usage: tsx preview-migration-baselines-offline.ts <private snapshot directory> <new private report>')
const rawPath = resolve(dir, 'raw/bundle40.json')
if ((await stat(rawPath)).mode & 0o077) throw Error('Snapshot must be 0600')
const manifest = JSON.parse(await readFile(resolve(dir, 'manifest.json'), 'utf8'))
async function verifiedFile(name: string, sha256: string) {
  const text = await readFile(resolve(dir!, name), 'utf8')
  if (createHash('sha256').update(text).digest('hex') !== sha256) throw Error('Snapshot file digest mismatch')
  return JSON.parse(text)
}
const bundle = await verifiedFile('raw/bundle40.json', manifest.raw.sha256)
const snapshot = await verifiedFile('snapshot.json', manifest.files.find((f: Fact) => f.path === 'snapshot.json').sha256)
const catalog = (await verifiedFile('manifest-resources-actions.json', manifest.files.find((f: Fact) => f.path === 'manifest-resources-actions.json').sha256)).tables
const body = bundle.bundle_payload_json as Fact
const releases: Fact[] = snapshot.currentDatabaseTables.platform_app_releases.map((r: Fact) => ({ ...r, release_kind: 'git', baseline_source_json: null }))
const manifests: Fact[] = snapshot.currentDatabaseTables.platform_app_manifests
const targetFile = manifest.files.find((f: Fact) => f.path === 'console-v0.2.5-release.json')
const targetConsole = targetFile ? await verifiedFile(targetFile.path, targetFile.sha256) : null
if (targetConsole) {
  for (const row of targetConsole.releases) if (!releases.some(r => r.id === row.id)) releases.push({ ...row, release_kind: 'git', baseline_source_json: null })
  for (const row of targetConsole.manifests) if (!manifests.some(r => r.id === row.id)) manifests.push(row)
  for (const table of Object.keys(catalog)) for (const row of targetConsole.tables[table]) if (!catalog[table].some((r: Fact) => r.id === row.id)) catalog[table].push(row)
}
let nextID = Math.max(...releases.map(r => Number(r.id))) + 1
let memoryWrites = 0
function catalogRows(table: string, p: unknown[], action = false): Fact[] {
  return catalog[table].filter((r: Fact) => r.manifest_id === p[0] && r.app_code === p[1] && r.status === 'active').map((r: Fact) => ({
    appCode: r.app_code, manifestId: r.manifest_id, resourceCode: r.resource_code,
    ...(action ? { id: r.id, action: r.action, actionCode: r.action_code, actionName: r.action_name, requiresGrant: r.requires_grant } : { resourceName: r.resource_name }),
    description: r.description, sortOrder: r.sort_order, status: r.status
  }))
}
async function rows(sql: string, p: unknown[] = []): Promise<Fact[]> {
  if (!sql.startsWith('SELECT ')) throw Error('Unexpected offline query')
  if (sql.includes('FROM policy_bundles')) return [bundle]
  if (sql.includes('FROM tenants')) return [{ tenant_code: bundle.tenant_code }]
  if (sql.includes('FROM tenant_environment_app_release_sets')) return []
  if (sql.includes('FROM platform_app_manifests m JOIN')) return manifests.filter(m => m.id === p[0] && m.app_code === p[1] && m.status === 'active')
  if (sql.includes('FROM platform_app_manifest_resources')) return catalogRows('platform_app_manifest_resources', p)
  if (sql.includes('FROM platform_app_manifest_resource_actions')) return catalogRows('platform_app_manifest_resource_actions', p, true)
  if (sql.includes('FROM platform_app_releases')) {
    let selected = releases.filter(r => r.app_code === p[0])
    if (sql.includes('release_version=?')) selected = selected.filter(r => r.release_version === p[1])
    else if (sql.includes('r.status IN')) selected = selected.filter(r => ['released', 'baseline'].includes(r.status) && r.id === p[1])
    else if (sql.includes('r.status=\'baseline\'')) selected = selected.filter(r => r.status === 'baseline' && r.manifest_id === p[1] && r.baseline_source_json.tenant === p[2] && r.baseline_source_json.environment === p[3] && r.baseline_source_json.bundleId === p[4])
    else selected = selected.filter(r => r.status === 'released' && r.manifest_id === p[1])
    return selected.map(r => ({ ...r, ...Object.fromEntries(Object.entries(manifests.find(m => m.id === r.manifest_id) || {}).filter(([k]) => ['manifest_json', 'manifest_hash'].includes(k))) }))
  }
  throw Error('Unhandled offline query')
}
const q: PinTransaction = {
  queryRows: async (sql, p) => await rows(sql, p) as never,
  queryRow: async (sql, p) => (await rows(sql, p))[0] as never || null,
  execute: async (sql, p = []) => {
    memoryWrites++
    if (sql.startsWith('INSERT INTO platform_app_releases')) {
      const id = nextID++
      releases.push({ id, app_code: p[0], release_version: p[1], source_tag: '', manifest_id: p[2], status: 'baseline', release_kind: 'baseline', baseline_source_json: JSON.parse(String(p[3])), source_commit_sha: null, source_registration_id: null, released_at: null })
      return { insertId: id, affectedRows: 1 } as never
    }
    if (sql.startsWith('INSERT INTO platform_migration_baseline_audits')) return { affectedRows: 1 } as never
    throw Error('Unexpected offline mutation')
  }
}
const input = { tenant: bundle.tenant_code, environment: bundle.environment, bundleId: bundle.id }
const plan = await planMigrationBaselines(q, input)
await registerMigrationBaselines(q, { ...input, reviewHash: plan.reviewHash, actor: 'offline-fixture', reason: 'offline-only simulation' })
const init = await pinsFromBundle(q, input.tenant, input.environment, input.bundleId)
const selection = (await loadEnvironmentAppSelection(q, input.tenant, input.environment, { pins: init.pins, sourceBundleId: bundle.id }))!
// Freeze non-manifest governance facts from the signed body; NEVER treat current DB projections as historical.
const facts = { ...body, rolePermissions: body.rolePermissionGrants, roleScopes: body.roleDefaultScopes,
  baselinePermissions: body.baselineGrants.map((g: Fact) => ({ ...g, scopeType: g.scopeDimension, scopeValue: g.scopePredicate })), subjectRoleScopes: body.assignmentScopes }
const projected = projectEnvironmentReleaseFacts(facts, selection)
const compiled = buildPolicyBundleV2CompatFields({ tenantCode: input.tenant, environment: input.environment, subjectRoles: body.roleAssignments, subjectRoleScopes: projected.subjectRoleScopes, rolePermissions: projected.rolePermissions, roleScopes: projected.roleScopes, baselinePermissions: projected.baselinePermissions, conflictRules: body.conflictRules, actionImplications: projected.manifestActionImplications, policyRevision: body.policyRevision })
const candidate = { ...body, ...compiled, ...Object.fromEntries(['applications', 'manifestResources', 'manifestActions', 'appRoles', 'appRolePermissions', 'appRoleScopes', 'roleAppRoleMaps', 'systemAppRoleMaps'].map(k => [k, projected[k]])) }
const diff = diffEnvironmentPolicy(body, candidate)
const diagnostics = diff.map((d) => {
  const changedFields: Record<string, number> = {}
  const semanticKey = (r: Fact) => JSON.stringify([r.roleCode, r.appRoleCode, r.appCode, r.resourceCode, r.action, r.sourceType, r.scopeType, r.scopeValue])
  const added = new Map((d.added || []).map((r: Fact) => [semanticKey(r), r]))
  let unmatchedRemoved = 0
  for (const before of d.removed || []) {
    const after = added.get(semanticKey(before)) as Fact | undefined
    if (!after) {
      unmatchedRemoved++
      continue
    }
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changedFields[field] = (changedFields[field] || 0) + 1
    }
  }
  return { field: d.field, changedFields, unmatchedRemoved }
})
// Aggregate only: never emit subject identifiers, names, role assignments or scope values.
const apf = new Set(['altoc', 'finance', 'people'])
const activeSubjects = new Set(body.subjects.filter((s: Fact) => s.subjectType === 'user' && s.status === 'active').map((s: Fact) => s.subjectCode))
const usersFor = (roleCode: string) => new Set(body.roleAssignments.filter((a: Fact) => a.roleCode === roleCode && a.status === 'active' && activeSubjects.has(a.subjectCode)
  && (!a.startsAt || Date.parse(a.startsAt) <= Date.parse(body.generatedAt))
  && (!a.expiresAt || Date.parse(a.expiresAt) > Date.parse(body.generatedAt))).map((a: Fact) => a.subjectCode))
const tuple = (r: Fact) => JSON.stringify([r.roleCode, r.appRoleCode, r.appCode, r.resourceCode, r.action, r.sourceType, r.scopeType, r.scopeValue, r.status])
const sameAction = (a: Fact, b: Fact) => a.appCode === b.appCode && a.resourceCode === b.resourceCode && a.action === b.action && b.status === 'active'
const groups: Fact[] = []
const lostUsersByApp = new Map<string, Set<unknown>>()
for (const d of diff) {
  const next = new Map((d.added || []).map((r: Fact) => [tuple(r), r]))
  for (const r of d.removed || []) {
    const mapped = next.get(tuple(r)) as Fact | undefined
    const appCode = r.appCode || body.appRoles.find((a: Fact) => a.roleCode === r.appRoleCode)?.appCode || 'unknown'
    const users = usersFor(r.roleCode)
    const noAlternateUsers = d.field === 'rolePermissionGrants' && !mapped
      ? [...users].filter((uid) => {
          const assigned = new Set(body.roleAssignments.filter((a: Fact) => a.subjectCode === uid && usersFor(a.roleCode).has(uid)).map((a: Fact) => a.roleCode))
          return !candidate.rolePermissionGrants.some((g: Fact) => assigned.has(g.roleCode) && sameAction(r, g))
        }).length
      : 0
    groups.push({ field: d.field, appCode, roleCode: r.roleCode, appRoleCode: r.appRoleCode ?? null,
      resourceCode: r.resourceCode ?? null, action: r.action ?? null, sourceType: r.sourceType ?? null,
      apf: apf.has(appCode), classification: mapped ? 'same-tuple-source-id-change' : 'removed',
      historicalAssignedActiveUsers: users.size, historicalUsersWithoutExactActionAlternative: noAlternateUsers.length,
      sameRoleExactActionRemains: d.field === 'rolePermissionGrants' && !mapped && candidate.rolePermissionGrants.some((g: Fact) => g.roleCode === r.roleCode && sameAction(r, g)),
      testRole132133: ['apf_sod_test_20261003', 'apf_sod_zhou_reconcile_20261004'].includes(r.roleCode), currentGovernanceChange: 'unknown-no-current-tenant-governance-export' })
  }
}
const impactByApp = [...new Set(groups.map(g => g.appCode))].sort().map((appCode) => {
  const relevant = groups.filter(g => g.appCode === appCode)
  const potential = new Set(relevant.flatMap(g => [...usersFor(g.roleCode)]))
  const losses = lostUsersByApp.get(appCode) || new Set()
  return { appCode, historicalAssignedUniqueUsers: potential.size, historicalPermissionLossCandidateUsers: losses.size }
})
const attribution = { asOf: body.generatedAt, historicalActiveUserCount: activeSubjects.size,
  currentRealUserImpact: 'Not provable from this export: no current tenant roles, assignments, statuses or test-subject classification. Counts below are signed historical active users, not current people.',
  impactByApp, sourceIdEquivalence: 'The permission/scope tuple is unchanged, but grantId/sourceManifestActionId remain real payload changes. Do not omit them from full diff.', rows: groups }
if (manifest.currentGovernance) {
  const current = await verifiedFile(manifest.currentGovernance.path, manifest.currentGovernance.sha256)
  const t = current.tables
  const active = new Set(t.tenant_subject_status.filter((u: Fact) => u.subject_type === 'user' && u.status === 'active').map((u: Fact) => u.subject_code))
  for (const row of groups) {
    const role = t.tenant_roles.find((r: Fact) => r.role_code === row.roleCode)
    const holders = new Set(t.effective_tenant_subject_roles.filter((a: Fact) => a.role_code === row.roleCode && a.status === 'active' && active.has(a.subject_code) && role?.status === 'active').map((a: Fact) => a.subject_code))
    const oldHolders = usersFor(row.roleCode)
    row.testRole132133 = [132, 133].includes(role?.id)
    row.currentRoleStatus = role?.status || 'missing'
    row.currentAssignedActiveUsers = holders.size
    row.roleHoldersChanged = pinHash([...holders].sort()) !== pinHash([...oldHolders].sort())
    row.currentGovernanceChange = { roleStatusChanged: role?.status !== body.roles.find((r: Fact) => r.roleCode === row.roleCode)?.status, roleHoldersChanged: row.roleHoldersChanged }
    if (row.field === 'roleAppRoleMaps') row.removedMappingStillPresentInCurrentGovernance = t.tenant_role_app_role_maps.some((m: Fact) => m.role_id === role?.id && m.app_role_code === row.appRoleCode)
  }
  attribution.currentRealUserImpact = 'Current role/assignment counts verified against private current governance export; actual scoped behavioral comparison is a separate owning-Foundation diagnostic, not implied by exact-action counts.'
}
const candidateHash = pinHash(candidate)
const reviewHash = pinHash({ mode: 'offline-frozen-prod39', sourceBundleHash: bundle.bundle_hash, registrationReviewHash: plan.reviewHash, selection: selectionReceipt(selection), candidateHash, diff })
function compileProjection(source: Fact, selected: typeof selection) {
  const projected = projectEnvironmentReleaseFacts(source, selected)
  const compiled = buildPolicyBundleV2CompatFields({ tenantCode: input.tenant, environment: input.environment, subjectRoles: source.subjectRoles || source.roleAssignments, subjectRoleScopes: projected.subjectRoleScopes, rolePermissions: projected.rolePermissions, roleScopes: projected.roleScopes, baselinePermissions: projected.baselinePermissions, conflictRules: source.conflictRules, actionImplications: projected.manifestActionImplications, policyRevision: source.policyRevision })
  return { ...source, ...compiled, ...Object.fromEntries(['applications', 'manifestResources', 'manifestActions', 'appRoles', 'appRolePermissions', 'appRoleScopes', 'roleAppRoleMaps', 'systemAppRoleMaps'].map(k => [k, projected[k]])), subjectRoles: undefined, subjectRoleScopes: undefined, rolePermissions: undefined, roleScopes: undefined, baselinePermissions: undefined }
}
const summarizeReview = (before: Fact, after: Fact) => {
  const review = reviewEnvironmentPolicy(before, after)
  return { equivalentCount: review.equivalent.length, equivalentByField: Object.fromEntries([...new Set(review.equivalent.map(r => r.field))].map(field => [field, review.equivalent.filter(r => r.field === field).length])),
    real: review.real.map(r => ({ field: r.field, origin: r.origin, added: r.added?.length, removed: r.removed?.length,
      technicalRows: [...(r.added || []).map((v: Fact) => ({ change: 'added', v })), ...(r.removed || []).map((v: Fact) => ({ change: 'removed', v }))].filter(({ v }) => v.appCode || v.appRoleCode).map(({ change, v }) => ({ change, appCode: v.appCode, roleCode: v.roleCode, appRoleCode: v.appRoleCode, resourceCode: v.resourceCode, action: v.action })) })),
    reviewHash: pinHash({ beforeHash: pinHash(before), afterHash: pinHash(after), review }), fullDiffHash: pinHash(diffEnvironmentPolicy(before, after)) }
}
let routeA: Fact | null = null
if (manifest.currentGovernance && targetConsole) {
  const governance = await verifiedFile(manifest.currentGovernance.path, manifest.currentGovernance.sha256)
  const live = overlayExportedGovernance(body, governance, snapshot.currentDatabaseTables)
  if (manifest.currentBaseline) {
    const baseline = await verifiedFile(manifest.currentBaseline.path, manifest.currentBaseline.sha256)
    live.baselinePermissions = await collectConfiguredBaselinePermissionsWithQueries({ queryRows: async <T>(sql: string, params?: unknown[]) => {
      const table = sql.includes('FROM platform_baseline_excluded_subjects') ? 'platform_baseline_excluded_subjects' : 'platform_baseline_permissions'
      return baseline.tables[table].filter((r: Fact) => r.status === 'active' && (!params?.length || params.includes(r.app_code))) as T
    } }, live.applications.map((a: Fact) => a.appCode))
  }
  const currentPinned = compileProjection(live, selection)
  const target = targetConsole.releases[0]
  const upgradedSelection = (await loadEnvironmentAppSelection(q, input.tenant, input.environment, { pins: init.pins.map(p => p.appCode === 'console' ? { appCode: 'console', releaseId: target.id } : p), sourceBundleId: bundle.id }))!
  const upgraded = compileProjection(live, upgradedSelection)
  const acceptanceCodes = new Set(governance.tables.tenant_roles.filter((r: Fact) => [132, 133].includes(r.id)).map((r: Fact) => r.role_code))
  const selectedActions = new Set(currentPinned.manifestActions.map((r: Fact) => JSON.stringify([r.appCode, r.resourceCode, r.action])))
  const acceptanceScopes = live.roleScopes.filter((r: Fact) => acceptanceCodes.has(r.roleCode))
  const unselectedScopes = acceptanceScopes.filter((r: Fact) => !selectedActions.has(JSON.stringify([r.appCode, r.resourceCode, r.action])))
  routeA = { frozenInitialization: summarizeReview(body, candidate), currentGovernanceInitialization: summarizeReview(body, currentPinned), consoleUpgradeFromCurrentPins: summarizeReview(currentPinned, upgraded), totalUpgrade: summarizeReview(body, upgraded),
    acceptanceScopes: { stored: acceptanceScopes.length, selected: acceptanceScopes.length - unselectedScopes.length, notInSelectedCatalog: unselectedScopes.map((r: Fact) => ({ roleCode: r.roleCode, appCode: r.appCode, resourceCode: r.resourceCode, action: r.action })), approval: 'pending; no role or stored row mutation' },
    baselineEvidence: manifest.currentBaseline ? { sha256: manifest.currentBaseline.sha256, configuredCount: live.baselinePermissions.length, applicability: 'Current global governance; shared by all tenants/environments; not retroactive to signed bundles' } : null,
    targetConsole: { releaseId: target.id, manifestId: target.manifest_id, tag: target.source_tag, commit: target.source_commit_sha },
    limitation: 'Authorization-only current governance overlay. Non-exported display names, parent memberships, templates/runtime facts remain historical; baseline is current only when baselineEvidence is present. These hashes are offline evidence, never production save approval. Fresh actual preview is mandatory.' }
}
const result = { routeA, sourceBundleId: bundle.id, sourceBundleHash: bundle.bundle_hash, baselineApplications: plan.entries.filter(e => e.mode === 'baseline').map(e => e.appCode), reused: plan.entries.filter(e => e.mode === 'reuse').map(e => ({ appCode: e.appCode, releaseId: e.releaseId })), registrationReviewHash: plan.reviewHash, reviewHash, candidateHash, policyDiffCount: diff.length, diagnostics, attribution, policyDiff: diff.map(d => ({ field: d.field, added: d.added?.length, removed: d.removed?.length })), simulatedPins: init.pins, memoryWrites, databaseWrites: 0, signedBundles: 0, limitation: 'Frozen historical governance; simulated IDs are not production allocations. Production preview/reviewHash must be rebuilt after registration. appReleaseSelection provenance remains separately reported.' }
await writeFile(report, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
console.log(JSON.stringify({ policyDiffCount: diff.length, baselineCount: result.baselineApplications.length, reusedCount: result.reused.length }))
if (process.argv.includes('--route-a') ? !routeA || routeA.frozenInitialization.real.length > 0 : diff.length) process.exitCode = 1

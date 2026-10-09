import { assertBaselineOrigin } from './migrationBaselineReleases.ts'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { createError } from 'h3'
import { hashPolicyBundlePayload } from './environmentPolicyPayload.ts'
import { stableStringifyPolicyPayload } from './policyEnvelopeDelivery.ts'
import { parseAppPins, pinHash, type AppPin, type Fact, type EnvironmentAppSelection, type ResolvedAppRelease } from './environmentAppReleaseModel.ts'

export interface PinQueries {
  queryRows<T extends RowDataPacket[]>(sql: string, params?: unknown[]): Promise<T>
  queryRow<T extends RowDataPacket>(sql: string, params?: unknown[]): Promise<T | null>
}
export interface PinTransaction extends PinQueries { execute<T extends ResultSetHeader>(sql: string, params?: unknown[]): Promise<T> }
const json = (v: unknown) => typeof v === 'string' ? JSON.parse(v) : v
const fail = (message: string): never => {
  throw createError({ statusCode: 409, message })
}
export async function loadPinSourceBundle(q: PinQueries, tenant: string, environment: string, id: number) {
  const row = await q.queryRow<RowDataPacket>('SELECT id, tenant_code, environment, policy_revision, bundle_hash, bundle_payload_json, signature FROM policy_bundles WHERE id=? AND tenant_code=? AND environment=?', [id, tenant, environment])
  if (!row || !row.signature) return fail('找不到此租户/环境的已签基线包')
  const payload = json(row.bundle_payload_json) as Fact
  if (hashPolicyBundlePayload(stableStringifyPolicyPayload(payload)) !== row.bundle_hash || payload.tenant?.tenantCode !== tenant || payload.environment !== environment) return fail('基线包内容/绑定与摘要不一致')
  return { id: Number(row.id), bundle_hash: String(row.bundle_hash), policy_revision: Number(row.policy_revision), payload }
}
export async function pinsFromBundle(q: PinQueries, tenant: string, environment: string, bundleId: number) {
  const source = await loadPinSourceBundle(q, tenant, environment, bundleId)
  const byApp = new Map<string, Set<number>>()
  for (const row of [...(source.payload.manifestResources || []), ...(source.payload.manifestActions || [])]) {
    const ids = byApp.get(row.appCode) || new Set<number>()
    ids.add(Number(row.manifestId))
    byApp.set(row.appCode, ids)
  }
  if (!byApp.size) return fail('基线包缺少实际 manifest ID，不能推断 release')
  const pins: AppPin[] = []
  for (const [appCode, ids] of byApp) {
    if (ids.size !== 1) return fail(`基线含多个 manifest：${appCode}`)
    const releases = await q.queryRows<RowDataPacket[]>(`SELECT id FROM platform_app_releases WHERE app_code=? AND manifest_id=? AND status='released'`, [appCode, [...ids][0]])
    {
      const baseline = await q.queryRows<RowDataPacket[]>(`SELECT r.*,m.manifest_hash FROM platform_app_releases r JOIN platform_app_manifests m ON m.id=r.manifest_id AND m.app_code=r.app_code WHERE r.app_code=? AND r.manifest_id=? AND r.status='baseline' AND JSON_UNQUOTE(JSON_EXTRACT(r.baseline_source_json,'$.tenant'))=? AND JSON_UNQUOTE(JSON_EXTRACT(r.baseline_source_json,'$.environment'))=? AND JSON_EXTRACT(r.baseline_source_json,'$.bundleId')=?`, [appCode, [...ids][0], tenant, environment, source.id])
      if (baseline.length > 1) return fail(`迁移基线多义：${appCode}`)
      const b = baseline[0]
      if (b) {
        assertBaselineOrigin(b, { tenant, environment, bundleId: source.id, bundleHash: source.bundle_hash, manifestId: Number([...ids][0]), manifestHash: b.manifest_hash })
        releases.splice(0, releases.length, b)
      }
    }
    if (releases.length !== 1) return fail(`实际 release 缺失或不唯一：${appCode}；请先补齐可核验的历史 release`)
    pins.push({ appCode, releaseId: Number(releases[0]!.id) })
  }
  return { source, pins: parseAppPins(pins) }
}
export async function loadEnvironmentAppReleaseState(q: PinQueries, tenant: string, environment: string, lock = false) {
  const row = await q.queryRow<RowDataPacket>(`SELECT revision,source_bundle_id,source_bundle_hash FROM tenant_environment_app_release_sets WHERE tenant_code=? AND environment=?${lock ? ' FOR UPDATE' : ''}`, [tenant, environment])
  if (!row) return null
  const pins = (await q.queryRows<RowDataPacket[]>('SELECT app_code AS appCode,release_id AS releaseId FROM tenant_environment_app_releases WHERE tenant_code=? AND environment=? ORDER BY app_code', [tenant, environment])).map(r => ({ appCode: String(r.appCode), releaseId: r.releaseId === null ? null : Number(r.releaseId) }))
  return { revision: Number(row.revision), sourceBundleId: Number(row.source_bundle_id) || null, sourceBundleHash: row.source_bundle_hash as string | null, pins }
}
export async function loadEnvironmentAppSelection(q: PinQueries, tenant: string, environment: string, override?: { pins: AppPin[], sourceBundleId: number | null }, lock = false): Promise<EnvironmentAppSelection | null> {
  const row = await q.queryRow<RowDataPacket>(`SELECT revision,source_bundle_id,source_bundle_hash FROM tenant_environment_app_release_sets WHERE tenant_code=? AND environment=?${lock ? ' FOR UPDATE' : ''}`, [tenant, environment])
  if (!row && !override) return null
  const pins = override?.pins || (await q.queryRows<RowDataPacket[]>('SELECT app_code AS appCode,release_id AS releaseId FROM tenant_environment_app_releases WHERE tenant_code=? AND environment=? ORDER BY app_code', [tenant, environment])).map(r => ({ appCode: r.appCode, releaseId: r.releaseId === null ? null : Number(r.releaseId) }))
  const sourceBundleId = override ? override.sourceBundleId : Number(row?.source_bundle_id) || null
  const source = sourceBundleId ? await loadPinSourceBundle(q, tenant, environment, sourceBundleId) : null
  if (source && row?.source_bundle_id === sourceBundleId && row.source_bundle_hash !== source.bundle_hash) return fail('环境基线摘要漂移')
  const releases: ResolvedAppRelease[] = []
  for (const pin of parseAppPins(pins)) {
    const release = await q.queryRow<RowDataPacket>(`SELECT r.id,r.release_version,r.source_tag,r.manifest_id,m.manifest_hash,m.manifest_json,r.status,r.release_kind,r.baseline_source_json,r.source_commit_sha,r.source_registration_id,r.released_at
      FROM platform_app_releases r JOIN platform_app_manifests m ON m.id=r.manifest_id AND m.app_code=r.app_code
      JOIN platform_applications a ON a.app_code=r.app_code
      WHERE r.app_code=? AND ${pin.releaseId === null ? 'r.status=\'released\' AND r.release_kind=\'git\'' : 'r.status IN (\'released\',\'baseline\')'} AND m.status='active' AND a.status='active'
      ${pin.releaseId === null ? '' : 'AND r.id=?'}
      ORDER BY r.released_at DESC,r.id DESC LIMIT 1${lock ? ' FOR SHARE' : ''}`, pin.releaseId === null ? [pin.appCode] : [pin.appCode, pin.releaseId])
    if (!release) return fail(`选定 release 不可用，禁止回退 latest：${pin.appCode}`)
    if (release.status === 'baseline') {
      if (!source) return fail('迁移基线只允许绑定原始已签包的显式 pin')
      assertBaselineOrigin(release, { tenant, environment, bundleId: source.id, bundleHash: source.bundle_hash, manifestId: Number(release.manifest_id), manifestHash: release.manifest_hash })
    }
    const resources = await q.queryRows<RowDataPacket[]>(`SELECT app_code AS appCode,manifest_id AS manifestId,resource_code AS resourceCode,resource_name AS resourceName,description,sort_order AS sortOrder,status FROM platform_app_manifest_resources WHERE manifest_id=? AND app_code=? AND status='active' ORDER BY resource_code`, [release.manifest_id, pin.appCode])
    const actions = await q.queryRows<RowDataPacket[]>(`SELECT a.id,a.app_code AS appCode,a.manifest_id AS manifestId,a.resource_code AS resourceCode,a.action,a.action_code AS actionCode,a.action_name AS actionName,a.description,a.sort_order AS sortOrder,a.requires_grant AS requiresGrant,a.status FROM platform_app_manifest_resource_actions a JOIN platform_app_manifest_resources r ON r.manifest_id=a.manifest_id AND r.app_code=a.app_code AND r.resource_code=a.resource_code AND r.status='active' WHERE a.manifest_id=? AND a.app_code=? AND a.status='active' ORDER BY a.resource_code,a.action`, [release.manifest_id, pin.appCode])
    releases.push({ ...pin, releaseId: Number(release.id), releaseVersion: release.release_version, sourceTag: release.source_tag, releaseKind: release.release_kind, manifestId: Number(release.manifest_id), manifestHash: release.manifest_hash, manifest: json(release.manifest_json), resources, actions })
  }
  return { revision: Number(row?.revision || 0), sourceBundleId, sourceBundleHash: source?.bundle_hash || null, baseline: source?.payload || null, pins, releases }
}
export function selectionReceipt(selection: EnvironmentAppSelection | null) {
  if (!selection) return null
  return { revision: selection.revision, sourceBundleId: selection.sourceBundleId, sourceBundleHash: selection.sourceBundleHash, sourcePolicyRevision: selection.baseline?.policyRevision || null, pins: selection.pins, releases: selection.releases.map(({ manifest: _manifest, resources: _resources, actions: _actions, ...r }) => r) }
}
export async function assertSelectionUnchanged(q: PinQueries, tenant: string, environment: string, receipt: unknown) {
  const current = await loadEnvironmentAppSelection(q, tenant, environment, undefined, true)
  if (pinHash(selectionReceipt(current)) !== pinHash(receipt)) return fail('环境应用版本已变化，请重新预览后签包')
}
export async function saveEnvironmentAppSelection(tx: PinTransaction, input: { tenant: string, environment: string, actor: string, reason: string, expectedRevision: number, selection: EnvironmentAppSelection, reviewHash: string, reviewEvidence?: { diff: Fact[], review: Fact, sensitiveConfigurationChanged: boolean } }) {
  if (!input.actor || !input.reason.trim() || input.reason.length > 500) throw createError({ statusCode: 400, message: '必须提供操作者与 1–500 字变更理由' })
  // Lock the tenant to serialize first initialization, then the environment row.
  if (!await tx.queryRow<RowDataPacket>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [input.tenant])) throw createError({ statusCode: 404, message: '租户不存在' })
  const old = await loadEnvironmentAppReleaseState(tx, input.tenant, input.environment, true)
  if (Number(old?.revision || 0) !== input.expectedRevision) return fail('选择版本冲突，请刷新预览')
  const selected = await loadEnvironmentAppSelection(tx, input.tenant, input.environment, { pins: input.selection.pins, sourceBundleId: input.selection.sourceBundleId })
  if (pinHash(selectionReceipt(selected)) !== pinHash(selectionReceipt(input.selection))) return fail('release 在预览后变化，请重新预览')
  await tx.execute(`INSERT INTO tenant_environment_app_release_sets (tenant_code,environment,revision,source_bundle_id,source_bundle_hash,updated_by) VALUES (?,?,1,?,?,?) ON DUPLICATE KEY UPDATE revision=revision+1,updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP(3)`, [input.tenant, input.environment, input.selection.sourceBundleId, input.selection.sourceBundleHash, input.actor])
  await tx.execute('DELETE FROM tenant_environment_app_releases WHERE tenant_code=? AND environment=?', [input.tenant, input.environment])
  for (const pin of input.selection.pins) await tx.execute('INSERT INTO tenant_environment_app_releases (tenant_code,environment,app_code,release_id) VALUES (?,?,?,?)', [input.tenant, input.environment, pin.appCode, pin.releaseId])
  await tx.execute(`INSERT INTO platform_environment_app_release_audits (tenant_code,environment,actor_uid,reason,old_selection_json,new_selection_json,review_hash) VALUES (?,?,?,?,?,?,?)`, [input.tenant, input.environment, input.actor, input.reason, JSON.stringify(old), JSON.stringify({ ...selectionReceipt(selected), revision: input.expectedRevision + 1, ...(input.reviewEvidence ? { reviewEvidence: input.reviewEvidence } : {}) }), input.reviewHash])
  return { revision: input.expectedRevision + 1 }
}

import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { createError } from 'h3'
import { loadPinSourceBundle, type PinQueries, type PinTransaction } from './environmentAppReleases.ts'
import { pinHash, type Fact } from './environmentAppReleaseModel.ts'

export interface BaselineOrigin { tenant: string, environment: string, bundleId: number, bundleHash: string, manifestId: number, manifestHash: string }
export const baselineJSON = (value: unknown): Fact | null => typeof value === 'string' ? JSON.parse(value) : value as Fact | null
const conflict = (message: string): never => {
  throw createError({ statusCode: 409, message })
}
export function assertBaselineOrigin(row: Fact, origin: BaselineOrigin) {
  const actual = baselineJSON(row.baseline_source_json)
  if (row.release_kind !== 'baseline' || row.status !== 'baseline' || row.source_tag !== '' || row.source_commit_sha != null || row.released_at != null || row.source_registration_id != null || pinHash(actual) !== pinHash(origin)) conflict('迁移基线来源不匹配或记录漂移')
}
export async function planMigrationBaselines(q: PinQueries, input: { tenant: string, environment: string, bundleId: number }) {
  const source = await loadPinSourceBundle(q, input.tenant, input.environment, input.bundleId)
  const apps = new Map<string, Set<number>>()
  for (const row of [...(source.payload.manifestResources || []), ...(source.payload.manifestActions || [])]) {
    const ids = apps.get(row.appCode) || new Set<number>()
    ids.add(Number(row.manifestId))
    apps.set(row.appCode, ids)
  }
  if (!apps.size) conflict('历史包缺少权限 manifest')
  const entries = []
  for (const [appCode, ids] of [...apps].sort(([a], [b]) => a.localeCompare(b))) {
    if (ids.size !== 1 || !Number.isSafeInteger([...ids][0])) conflict('历史 manifest 多义或无效')
    const manifestId = [...ids][0]!
    const manifest = await q.queryRow<RowDataPacket>(`SELECT m.id,m.app_code,m.manifest_hash,m.manifest_json FROM platform_app_manifests m JOIN platform_applications a ON a.app_code=m.app_code WHERE m.id=? AND m.app_code=? AND m.status='active' AND a.status='active'`, [manifestId, appCode])
    if (!manifest?.manifest_hash || !manifest.manifest_json) conflict(`历史 manifest 不可用：${appCode}`)
    const origin: BaselineOrigin = { tenant: input.tenant, environment: input.environment, bundleId: source.id, bundleHash: source.bundle_hash, manifestId, manifestHash: String(manifest!.manifest_hash) }
    const releaseVersion = `baseline-b${source.id}-m${manifestId}-${pinHash(origin).slice(0, 12)}`
    const existing = await q.queryRow<RowDataPacket>('SELECT * FROM platform_app_releases WHERE app_code=? AND release_version=?', [appCode, releaseVersion])
    if (existing) {
      assertBaselineOrigin(existing, origin)
      if (Number(existing.manifest_id) !== manifestId) conflict('基线 manifest 被替换')
    }
    const releases = await q.queryRows<RowDataPacket[]>(`SELECT id FROM platform_app_releases WHERE app_code=? AND manifest_id=? AND status='released' AND release_kind='git'`, [appCode, manifestId])
    if (!existing && releases.length > 1) conflict(`真实 released 多义：${appCode}`)
    entries.push({ appCode, origin, releaseVersion, mode: existing || !releases.length ? 'baseline' as const : 'reuse' as const, releaseId: existing ? Number(existing.id) : releases.length === 1 ? Number(releases[0]!.id) : null })
  }
  // Baseline database IDs are allocation results, not reviewed semantics; replays keep the same hash.
  const reviewHash = pinHash({ schema: 1, source: { id: source.id, hash: source.bundle_hash }, entries: entries.map(e => ({ ...e, releaseId: e.mode === 'reuse' ? e.releaseId : null })) })
  return { entries, reviewHash, source }
}
export async function registerMigrationBaselines(tx: PinTransaction, input: { tenant: string, environment: string, bundleId: number, reviewHash: string, actor: string, reason: string }) {
  if (!input.actor.trim() || !input.reason.trim() || input.reason.length > 500) throw createError({ statusCode: 400, message: '必须提供操作者及变更理由' })
  if (!await tx.queryRow<RowDataPacket>('SELECT tenant_code FROM tenants WHERE tenant_code=? FOR UPDATE', [input.tenant])) conflict('租户不存在')
  const locked: PinQueries = {
    queryRow: (sql, params) => tx.queryRow(sql + ' FOR UPDATE', params),
    queryRows: (sql, params) => tx.queryRows(sql + ' FOR UPDATE', params)
  }
  const plan = await planMigrationBaselines(locked, input)
  if (plan.reviewHash !== input.reviewHash) conflict('基线登记事实已变化，请重新审阅')
  const pins = []
  for (const entry of plan.entries) {
    let releaseId = entry.releaseId
    if (releaseId === null) {
      const result = await tx.execute<ResultSetHeader>(`INSERT INTO platform_app_releases(app_code,release_version,source_tag,manifest_id,status,release_kind,baseline_source_json,release_notes) VALUES (?,?,'',?,'baseline','baseline',?,?)`, [entry.appCode, entry.releaseVersion, entry.origin.manifestId, JSON.stringify(entry.origin), '迁移基线；不是 Git 发布，不参与 latest'])
      releaseId = Number(result.insertId)
    }
    pins.push({ appCode: entry.appCode, releaseId })
  }
  await tx.execute<ResultSetHeader>(`INSERT INTO platform_migration_baseline_audits(tenant_code,environment,source_bundle_id,review_hash,actor_uid,reason,registrations_json) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, [input.tenant, input.environment, input.bundleId, input.reviewHash, input.actor, input.reason, JSON.stringify(pins)])
  return { pins, reviewHash: plan.reviewHash }
}

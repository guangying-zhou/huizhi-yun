import { createHash } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { TransactionExecutor } from './db'
import { planEnterpriseEntitlementMigration, parseEntitlementUtc, type EnterpriseStatus, type EntitlementSource } from './enterpriseEntitlement.ts'

type Row = RowDataPacket & Record<string, unknown>
export type EnterpriseTransaction = <T>(work: (tx: TransactionExecutor) => Promise<T>) => Promise<T>
export interface EnterpriseConversionRequest {
  tenantCode: string
  migrationId: string
  mode?: 'dry-run' | 'apply'
  expectedRevision?: number
  sourceHash?: string
}

export type EnterpriseConversionSourceKind = 'tenant-subscription' | 'subscription' | 'order' | 'license' | 'license-deployment'
export interface EnterpriseConversionPreviewSource {
  sourceId: string
  kind: EnterpriseConversionSourceKind
  state: 'current' | 'historical'
  status: string
  planCode: string | null
  effectiveFrom: string | null
  effectiveUntil: string | null
  linkedSourceIds: string[]
}
export interface EnterpriseConversionPreviewConflict {
  code: string
  sourceIds: string[]
}
export interface EnterpriseConversionPreviewReport {
  sources: EnterpriseConversionPreviewSource[]
  historicalIds: string[]
  conflicts: EnterpriseConversionPreviewConflict[]
}

function hash(value: unknown): string {
  return `sha256_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
function utc(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const normalized = String(value).replace(' ', 'T').replace(/(?:\.000)?$/, '')
  const result = normalized.endsWith('Z') ? normalized : `${normalized}Z`
  parseEntitlementUtc(result)
  return result
}
function status(value: unknown): EnterpriseStatus {
  if (value === 'ended' || value === 'expired') return 'expired'
  if (value === 'disabled') return 'suspended'
  if (['pending', 'active', 'suspended', 'revoked'].includes(String(value))) return value as EnterpriseStatus
  throw new Error('unmapped_legacy_entitlement_status')
}

function sourcePeriod(row: Row, fromField: string, untilField: string) {
  try {
    const effectiveFrom = utc(row[fromField])
    const effectiveUntil = utc(row[untilField])
    if (!effectiveFrom || !effectiveUntil) return { effectiveFrom: effectiveFrom || null, effectiveUntil: effectiveUntil || null, valid: false }
    if (parseEntitlementUtc(effectiveUntil) <= parseEntitlementUtc(effectiveFrom)) return { effectiveFrom, effectiveUntil, valid: false }
    return { effectiveFrom, effectiveUntil, valid: true }
  } catch {
    return { effectiveFrom: null, effectiveUntil: null, valid: false }
  }
}

function reportConflict(conflicts: EnterpriseConversionPreviewConflict[], code: string, sourceIds: string[]) {
  const normalized = [...new Set(sourceIds)].sort()
  if (!normalized.length || conflicts.some(item => item.code === code && item.sourceIds.join('|') === normalized.join('|'))) return
  conflicts.push({ code, sourceIds: normalized })
}

/**
 * Pure, credential-free conversion evidence. It deliberately reports every
 * legacy record by stable ID and never derives a service period from a plan,
 * invoice, grace period, or missing timestamp.
 */
export function buildEnterpriseEntitlementPreviewReport(snapshot: {
  primary: Row[]
  children: Row[]
  orders: Row[]
  licenses: Row[]
  bindings: Row[]
}): EnterpriseConversionPreviewReport {
  const sources: EnterpriseConversionPreviewSource[] = []
  const conflicts: EnterpriseConversionPreviewConflict[] = []
  const activePrimary = snapshot.primary.filter(row => row.status !== 'ended')
  const activePrimaryIds = new Set(activePrimary.map(row => Number(row.id)))
  const currentChildren = snapshot.children.filter(row => row.status !== 'ended' && activePrimaryIds.has(Number(row.tenant_subscription_id)))
  const currentChildIds = new Set(currentChildren.map(row => Number(row.id)))
  const currentOrderIds = new Set([...activePrimary, ...currentChildren].map(row => Number(row.current_order_id)).filter(Boolean))
  const currentLicenseIds = new Set(snapshot.licenses.filter(row => currentChildIds.has(Number(row.subscription_id))).map(row => Number(row.id)))
  const primaryById = new Map(snapshot.primary.map(row => [Number(row.id), row]))
  const licenseIdsWithBinding = new Set(snapshot.bindings.map(row => Number(row.license_id)))
  const add = (kind: EnterpriseConversionSourceKind, row: Row, current: boolean, periodFields: [string, string], linkedSourceIds: string[] = []) => {
    const id = `${kind}:${row.id}`
    const period = sourcePeriod(row, periodFields[0], periodFields[1])
    sources.push({
      sourceId: id,
      kind,
      state: current ? 'current' : 'historical',
      status: String(row.status || ''),
      planCode: typeof row.plan_code === 'string' && row.plan_code.trim() ? row.plan_code : null,
      effectiveFrom: period.effectiveFrom,
      effectiveUntil: period.effectiveUntil,
      linkedSourceIds: [...new Set(linkedSourceIds)].sort()
    })
    if (current && !period.valid) reportConflict(conflicts, 'missing_or_invalid_period', [id])
    if ((kind === 'tenant-subscription' || kind === 'subscription') && current) {
      try {
        status(row.status)
      } catch {
        reportConflict(conflicts, 'unmapped_legacy_entitlement_status', [id])
      }
    }
  }

  for (const row of snapshot.primary) add('tenant-subscription', row, activePrimaryIds.has(Number(row.id)), ['started_at', 'ended_at'])
  for (const row of snapshot.children) {
    const parent = primaryById.get(Number(row.tenant_subscription_id))
    add('subscription', row, currentChildIds.has(Number(row.id)), ['started_at', 'ended_at'], parent ? [`tenant-subscription:${parent.id}`] : [])
    if (currentChildIds.has(Number(row.id)) && !parent) reportConflict(conflicts, 'orphan_current_subscription', [`subscription:${row.id}`])
  }
  for (const row of snapshot.orders) {
    const current = currentOrderIds.has(Number(row.id))
    const linked = [...activePrimary, ...currentChildren].filter(item => Number(item.current_order_id) === Number(row.id)).map(item => `${snapshot.primary.includes(item) ? 'tenant-subscription' : 'subscription'}:${item.id}`)
    add('order', row, current, ['effective_from', 'effective_until'], linked)
    if (current && row.status !== 'paid') reportConflict(conflicts, 'current_order_not_paid', [`order:${row.id}`])
  }
  for (const row of snapshot.licenses) {
    const current = currentLicenseIds.has(Number(row.id))
    const child = snapshot.children.find(item => Number(item.id) === Number(row.subscription_id))
    const parent = child ? primaryById.get(Number(child.tenant_subscription_id)) : undefined
    const linked = [child && `subscription:${child.id}`, parent && `tenant-subscription:${parent.id}`].filter((item): item is string => Boolean(item))
    add('license', row, current, ['issued_at', 'expires_at'], linked)
    if (current && !row.expires_at) reportConflict(conflicts, 'license_hard_expiry_missing', [`license:${row.id}`])
    const parentPeriod = parent && sourcePeriod(parent, 'started_at', 'ended_at')
    const licensePeriod = sourcePeriod(row, 'issued_at', 'expires_at')
    if (current && parent && parentPeriod?.valid && licensePeriod.valid && parentPeriod.effectiveUntil !== licensePeriod.effectiveUntil) reportConflict(conflicts, 'license_period_mismatch', [`license:${row.id}`, `tenant-subscription:${parent.id}`])
    if (current && !licenseIdsWithBinding.has(Number(row.id))) reportConflict(conflicts, 'current_license_missing_deployment_binding', [`license:${row.id}`])
  }
  for (const row of snapshot.bindings) {
    const linkedLicense = snapshot.licenses.find(item => Number(item.id) === Number(row.license_id))
    const current = Boolean(linkedLicense && currentLicenseIds.has(Number(linkedLicense.id)))
    add('license-deployment', row, current, ['effective_from', 'effective_until'], [`license:${row.license_id}`])
    if (!linkedLicense) reportConflict(conflicts, 'orphan_license_binding', [`license-deployment:${row.id}`])
  }

  const currentSubscriptionSources = sources.filter(item => item.state === 'current' && (item.kind === 'tenant-subscription' || item.kind === 'subscription'))
  const periods = new Set(currentSubscriptionSources.map(item => `${item.effectiveFrom}/${item.effectiveUntil}`))
  if (periods.size > 1) reportConflict(conflicts, 'subscription_period_mismatch', currentSubscriptionSources.map(item => item.sourceId))
  const plans = new Set(currentSubscriptionSources.map(item => item.planCode).filter((item): item is string => Boolean(item)))
  if (plans.size > 1) reportConflict(conflicts, 'subscription_plan_mismatch', currentSubscriptionSources.map(item => item.sourceId))
  const currentOrders = sources.filter(item => item.state === 'current' && item.kind === 'order')
  if (currentOrders.some(item => !periods.has(`${item.effectiveFrom}/${item.effectiveUntil}`))) reportConflict(conflicts, 'order_period_mismatch', [...currentOrders.map(item => item.sourceId), ...currentSubscriptionSources.map(item => item.sourceId)])

  return {
    sources: sources.sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    historicalIds: sources.filter(item => item.state === 'historical').map(item => item.sourceId).sort(),
    conflicts: conflicts.sort((a, b) => a.code.localeCompare(b.code) || a.sourceIds.join('|').localeCompare(b.sourceIds.join('|')))
  }
}

/** All source reads lock rows during apply; credentials and signed payloads are never selected. */
export async function loadEnterpriseEntitlementSources(tx: TransactionExecutor, tenantCode: string, lock: boolean) {
  const suffix = lock ? ' FOR UPDATE' : ''
  const tenant = await tx.queryRow<Row>(`SELECT tenant_code, status FROM tenants WHERE tenant_code = ?${suffix}`, [tenantCode])
  if (!tenant) throw new Error('enterprise_tenant_not_found')
  const primary = await tx.queryRows<Row[]>(`SELECT id, status, started_at, ended_at, current_order_id, plan_code, updated_at FROM tenant_subscriptions WHERE tenant_code = ? ORDER BY id${suffix}`, [tenantCode])
  const children = await tx.queryRows<Row[]>(`SELECT id, tenant_subscription_id, app_code, status, started_at, ended_at, current_order_id, plan_code, updated_at FROM subscriptions WHERE tenant_code = ? ORDER BY id${suffix}`, [tenantCode])
  const orders = await tx.queryRows<Row[]>(`SELECT id, status, effective_from, effective_until, paid_at, plan_code, updated_at FROM platform_orders WHERE tenant_code = ? ORDER BY id${suffix}`, [tenantCode])
  const licenses = await tx.queryRows<Row[]>(`SELECT id, subscription_id, status, issued_at, expires_at, grace_until, payload_hash, updated_at FROM licenses WHERE tenant_code = ? ORDER BY id${suffix}`, [tenantCode])
  const bindings = await tx.queryRows<Row[]>(`SELECT ld.id, ld.license_id, ld.deployment_id, ld.status, ld.effective_from, ld.effective_until FROM license_deployments ld INNER JOIN licenses l ON l.id = ld.license_id WHERE l.tenant_code = ? ORDER BY ld.id${suffix}`, [tenantCode])
  const snapshot = { tenant, primary, children, orders, licenses, bindings }
  const previewReport = buildEnterpriseEntitlementPreviewReport(snapshot)
  const currentPrimary = primary.filter(row => row.status !== 'ended')
  const currentChildren = children.filter(row => row.status !== 'ended' && currentPrimary.some(parent => Number(parent.id) === Number(row.tenant_subscription_id)))
  const historicalIds = [...primary.filter(row => row.status === 'ended').map(row => `tenant-subscription:${row.id}`), ...children.filter(row => !currentChildren.includes(row)).map(row => `subscription:${row.id}`)]
  const sources: EntitlementSource[] = []
  const sourceConflicts: string[] = previewReport.conflicts.map(item => `${item.code}:${item.sourceIds.join(',')}`)
  const add = (id: string, rowStatus: unknown, fromValue: unknown, untilValue: unknown) => {
    let period: EntitlementSource['period']
    try {
      const from = utc(fromValue)
      const until = utc(untilValue)
      if (from && until) period = { effectiveFrom: from, end: { kind: 'finite', effectiveUntil: until } }
    } catch { /* A malformed source becomes needs-review, never unlimited. */ }
    try {
      sources.push({ id, status: status(rowStatus), evidenceReference: id, period })
    } catch {
      sourceConflicts.push(`unmapped_legacy_entitlement_status:${id}`)
    }
  }
  for (const row of currentPrimary) add(`tenant-subscription:${row.id}`, row.status, row.started_at, row.ended_at)
  for (const row of currentChildren) add(`subscription:${row.id}`, row.status, row.started_at, row.ended_at)
  const currentOrderIds = new Set([...currentPrimary, ...currentChildren].map(row => Number(row.current_order_id)).filter(Boolean))
  for (const row of orders) {
    if (currentOrderIds.has(Number(row.id))) {
      // Paid is an accounting fact, not an automatic renewal decision.
      add(`order:${row.id}`, row.status === 'paid' ? 'active' : 'pending', row.effective_from, row.effective_until)
    } else historicalIds.push(`order:${row.id}`)
  }
  // License hard dates, issue dates and grace have distinct semantics. Keep all in hash/audit;
  // any current hard expiry inconsistent with the enterprise period requires manual evidence.
  const currentLicenseConflicts = licenses.filter(row => currentChildren.some(child => Number(child.id) === Number(row.subscription_id)))
    .filter(row => row.expires_at == null || !currentPrimary.some(parent => String(parent.ended_at) === String(row.expires_at)))
    .map(row => `license_period_requires_review:${row.id}`)
  if (currentPrimary.length > 1) currentLicenseConflicts.push('multiple_current_enterprise_subscriptions')
  return { sourceHash: hash(snapshot), sources, tenantStatus: status(tenant.status), historicalIds, currentLicenseConflicts: [...new Set([...currentLicenseConflicts, ...sourceConflicts])].sort(), previewReport }
}

export function createEnterpriseEntitlementRepository(withTransaction: EnterpriseTransaction) {
  return {
    /** Explicit preview entry point; callers cannot accidentally select apply here. */
    async preview(request: Omit<EnterpriseConversionRequest, 'mode'>, now: string) {
      return this.convert({ ...request, mode: 'dry-run' }, now)
    },
    async convert(request: EnterpriseConversionRequest, now: string) {
      parseEntitlementUtc(now)
      if (!request.tenantCode.trim() || !request.migrationId.trim()) throw new Error('invalid_migration_identity')
      if (request.mode !== undefined && request.mode !== 'dry-run' && request.mode !== 'apply') throw new Error('invalid_migration_mode')
      const apply = request.mode === 'apply'
      if (apply && (!request.sourceHash || !Number.isSafeInteger(request.expectedRevision) || Number(request.expectedRevision) < 0)) throw new Error('migration_preconditions_required')
      return withTransaction(async (tx) => {
        // Tenant row serializes first qualification and all later conversion attempts.
        const loaded = await loadEnterpriseEntitlementSources(tx, request.tenantCode, apply)
        const suffix = apply ? ' FOR UPDATE' : ''
        const pointer = await tx.queryRow<Row>(`SELECT revision FROM tenant_enterprise_entitlement_current WHERE tenant_code = ?${suffix}`, [request.tenantCode])
        const revision = Number(pointer?.revision || 0)
        const payloadHash = hash({ tenantCode: request.tenantCode, migrationId: request.migrationId, expectedRevision: request.expectedRevision, sourceHash: request.sourceHash })
        const receipt = await tx.queryRow<Row>(`SELECT request_hash, result_json FROM tenant_enterprise_entitlement_migrations WHERE tenant_code = ? AND migration_id = ?${suffix}`, [request.tenantCode, request.migrationId])
        if (apply && receipt) {
          if (receipt.request_hash !== payloadHash) throw new Error('migration_id_payload_conflict')
          return { replayed: true, result: typeof receipt.result_json === 'string' ? JSON.parse(receipt.result_json) : receipt.result_json }
        }
        const plan = planEnterpriseEntitlementMigration({ tenantCode: request.tenantCode, migrationId: request.migrationId, expectedRevision: revision, tenantStatus: loaded.tenantStatus, sources: loaded.sources, now })
        const result = { ...plan, sourceHash: loaded.sourceHash, historicalIds: loaded.historicalIds, sourceReport: loaded.previewReport }
        if (loaded.currentLicenseConflicts.length) {
          result.conflicts.push(...loaded.currentLicenseConflicts)
          result.decision = 'needs-review'
          result.entitlement = null
        }
        if (!apply) return { replayed: false, result }
        if (request.sourceHash !== loaded.sourceHash || request.expectedRevision !== revision) throw new Error('entitlement_migration_conflict')
        if (result.decision !== 'ready' || !result.entitlement) throw new Error('entitlement_migration_needs_review')
        const entitlement = result.entitlement
        await tx.execute<ResultSetHeader>(`INSERT INTO tenant_enterprise_entitlements (tenant_code, revision, schema_version, product_code, status, effective_from, effective_until, period_kind, entitlement_json, migration_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [request.tenantCode, entitlement.revision, entitlement.schemaVersion, entitlement.productCode, entitlement.status, entitlement.effectiveFrom.replace('T', ' ').replace('Z', ''), entitlement.end.kind === 'finite' ? entitlement.end.effectiveUntil.replace('T', ' ').replace('Z', '') : null, entitlement.end.kind, JSON.stringify(entitlement), request.migrationId])
        await tx.execute<ResultSetHeader>(`INSERT INTO tenant_enterprise_entitlement_current (tenant_code, revision) VALUES (?, ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision)`, [request.tenantCode, entitlement.revision])
        await tx.execute<ResultSetHeader>(`INSERT INTO tenant_enterprise_entitlement_migrations (tenant_code, migration_id, request_hash, source_hash, previous_revision, result_revision, historical_ids_json, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [request.tenantCode, request.migrationId, payloadHash, loaded.sourceHash, revision, entitlement.revision, JSON.stringify(loaded.historicalIds), JSON.stringify(result)])
        return { replayed: false, result }
      })
    }
  }
}

/** Server-only entry point. No database access occurs on module import; default is read-only. */
export async function convertEnterpriseEntitlement(request: EnterpriseConversionRequest, now = new Date().toISOString()) {
  const { withTransaction } = await import('./db')
  return createEnterpriseEntitlementRepository(withTransaction).convert(request, now)
}

/** Server-only read entry point for migration evidence; it never selects apply. */
export async function previewEnterpriseEntitlementConversion(request: Omit<EnterpriseConversionRequest, 'mode'>, now = new Date().toISOString()) {
  const { withTransaction } = await import('./db')
  return createEnterpriseEntitlementRepository(withTransaction).preview(request, now)
}

import { createHash } from 'node:crypto'

export const ENTERPRISE_ENTITLEMENT_SCHEMA = 'enterprise-entitlement.v1' as const
export const ENTERPRISE_PRODUCT_CODE = 'enterprise-full' as const
export type EnterpriseStatus = 'pending' | 'active' | 'suspended' | 'expired' | 'revoked'
function assertStatus(status: EnterpriseStatus) {
  if (!['pending', 'active', 'suspended', 'expired', 'revoked'].includes(status)) throw new Error('invalid_entitlement_status')
}

export type EnterprisePeriod = {
  effectiveFrom: string
  end: { kind: 'finite', effectiveUntil: string } | { kind: 'unlimited', evidenceReference: string }
}
export interface EntitlementSource {
  id: string
  status: EnterpriseStatus
  period?: EnterprisePeriod
  evidenceReference: string
  /** Only an evidenced enterprise contract can resolve conflicting child periods. */
  authoritativeEnterprisePeriod?: boolean
}
export interface EnterpriseEntitlement extends EnterprisePeriod {
  schemaVersion: typeof ENTERPRISE_ENTITLEMENT_SCHEMA
  productCode: typeof ENTERPRISE_PRODUCT_CODE
  tenantCode: string
  revision: number
  status: EnterpriseStatus
}

export function parseEntitlementUtc(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('strict_utc_required')
  const millis = Date.parse(value)
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw new Error('invalid_utc_date')
  return millis
}

export function normalizeEnterprisePeriod(period: EnterprisePeriod): EnterprisePeriod {
  const from = parseEntitlementUtc(period.effectiveFrom)
  if (period.end?.kind === 'finite') {
    const until = parseEntitlementUtc(period.end.effectiveUntil)
    if (until <= from) throw new Error('invalid_entitlement_period')
    return { effectiveFrom: new Date(from).toISOString(), end: { kind: 'finite', effectiveUntil: new Date(until).toISOString() } }
  }
  if (period.end?.kind !== 'unlimited' || !period.end.evidenceReference.trim()) throw new Error('unlimited_period_evidence_required')
  return { effectiveFrom: new Date(from).toISOString(), end: { kind: 'unlimited', evidenceReference: period.end.evidenceReference.trim() } }
}

export function enterpriseStatusAt(entitlement: Pick<EnterpriseEntitlement, 'status' | 'effectiveFrom' | 'end'>, now: string): EnterpriseStatus {
  assertStatus(entitlement.status)
  const time = parseEntitlementUtc(now)
  const period = normalizeEnterprisePeriod(entitlement)
  if (entitlement.status === 'revoked' || entitlement.status === 'suspended' || entitlement.status === 'expired') return entitlement.status
  if (period.end.kind === 'finite' && time >= parseEntitlementUtc(period.end.effectiveUntil)) return 'expired'
  if (entitlement.status === 'pending' || time < parseEntitlementUtc(period.effectiveFrom)) return 'pending'
  return 'active'
}

/** State recovery never changes periods and cannot recover revoked/expired grants. */
export function restoreEnterpriseEntitlement(entitlement: EnterpriseEntitlement, now: string): EnterpriseEntitlement {
  if (entitlement.status !== 'suspended') throw new Error('entitlement_not_suspended')
  const restored = { ...entitlement, ...normalizeEnterprisePeriod(entitlement), status: 'active' as const }
  return { ...restored, status: enterpriseStatusAt(restored, now) }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

export interface EntitlementMigrationInput {
  tenantCode: string
  migrationId: string
  expectedRevision: number
  tenantStatus: EnterpriseStatus
  /** Current qualification candidates only; archived history is linked by the DB migration receipt. */
  sources: EntitlementSource[]
  now: string
}

export function planEnterpriseEntitlementMigration(input: EntitlementMigrationInput) {
  if (!input.tenantCode.trim() || !input.migrationId.trim() || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('invalid_migration_identity')
  assertStatus(input.tenantStatus)
  parseEntitlementUtc(input.now)
  const conflicts: string[] = []
  const ids = new Set<string>()
  const sources = input.sources.map((source) => {
    if (!source.id.trim() || ids.has(source.id)) throw new Error('duplicate_or_missing_source_id')
    assertStatus(source.status)
    ids.add(source.id)
    let period: EnterprisePeriod | undefined
    try {
      period = source.period && normalizeEnterprisePeriod(source.period)
    } catch {
      conflicts.push(`invalid_period:${source.id}`)
    }
    if (!period) conflicts.push(`missing_period:${source.id}`)
    if (!source.evidenceReference.trim()) conflicts.push(`missing_evidence:${source.id}`)
    return { id: source.id, status: source.status, period, evidenceReference: source.evidenceReference, authoritativeEnterprisePeriod: source.authoritativeEnterprisePeriod === true }
  }).sort((a, b) => a.id.localeCompare(b.id))
  // Hash every source field, including invalid periods, so drift never disappears during normalization.
  const sourceHash = `sha256_${createHash('sha256').update(canonical({ tenantCode: input.tenantCode, tenantStatus: input.tenantStatus, sources: [...input.sources].sort((a, b) => a.id.localeCompare(b.id)) })).digest('hex')}`
  const base = { migrationId: input.migrationId, tenantCode: input.tenantCode, expectedRevision: input.expectedRevision, sourceHash, sourceIds: sources.map(s => s.id) }
  const authorities = sources.filter(s => s.authoritativeEnterprisePeriod)
  if (!sources.length) conflicts.push('missing_sources')
  if (authorities.length > 1) conflicts.push('multiple_authoritative_periods')
  const selected = authorities.length === 1 ? authorities[0] : sources[0]
  const periodKey = (p: EnterprisePeriod | undefined) => p ? `${p.effectiveFrom}/${p.end.kind === 'finite' ? p.end.effectiveUntil : 'unlimited'}` : ''
  if (!authorities.length && sources.some(s => periodKey(s.period) !== periodKey(selected?.period))) conflicts.push('conflicting_periods')
  if (!authorities.length && sources.some(s => s.status !== selected?.status)) conflicts.push('conflicting_source_statuses')
  if (conflicts.length || !selected?.period) return { ...base, decision: 'needs-review' as const, conflicts: [...new Set(conflicts)].sort(), entitlement: null }
  const status = input.tenantStatus === 'revoked' || input.tenantStatus === 'suspended' || input.tenantStatus === 'expired' || input.tenantStatus === 'pending' ? input.tenantStatus : selected.status
  const entitlement: EnterpriseEntitlement = { ...selected.period, schemaVersion: ENTERPRISE_ENTITLEMENT_SCHEMA, productCode: ENTERPRISE_PRODUCT_CODE, tenantCode: input.tenantCode, revision: input.expectedRevision + 1, status }
  entitlement.status = enterpriseStatusAt(entitlement, input.now)
  return { ...base, decision: 'ready' as const, conflicts: [] as string[], entitlement }
}

/** Caller must enforce this under the same database transaction/tenant lock as apply. */
export function assertEntitlementMigrationPreconditions(plan: { sourceHash: string, expectedRevision: number }, actual: { sourceHash: string, revision: number }) {
  if (plan.sourceHash !== actual.sourceHash || plan.expectedRevision !== actual.revision) throw new Error('entitlement_migration_conflict')
}

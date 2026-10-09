export interface FeatureReleaseEvidence {
  record_id: number
  version_id: number
  membership: 'included' | 'absent' | 'unavailable'
  scope_id: number | null
  frozen_status: 'planned' | 'delivered' | 'deferred' | null
  current: boolean
  withdrawn: boolean
  superseded: boolean
}

export function validFeatureReleaseEvidence(value: unknown, versionId: number): value is FeatureReleaseEvidence | null {
  if (value === null) return true
  if (!value || typeof value !== 'object') return false
  const evidence = value as FeatureReleaseEvidence
  if (!Number.isSafeInteger(evidence.record_id) || evidence.record_id <= 0 || evidence.version_id !== versionId || !['included', 'absent', 'unavailable'].includes(evidence.membership) || [evidence.current, evidence.withdrawn, evidence.superseded].some(flag => typeof flag !== 'boolean') || (evidence.current && (evidence.withdrawn || evidence.superseded))) return false
  if (evidence.membership === 'included') return Number.isSafeInteger(evidence.scope_id) && evidence.scope_id! > 0 && ['planned', 'delivered', 'deferred'].includes(evidence.frozen_status ?? '')
  return evidence.scope_id === null && evidence.frozen_status === null
}

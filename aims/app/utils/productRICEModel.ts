import { validProductModelVersion } from './productWeightedModel'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const definition = (value: unknown) => typeof value === 'string' && value.isWellFormed() && !!value.trim() && !value.includes('\0') && [...value].length <= 2000
const date = (value: unknown) => {
  if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? parsed.getTime() : null
}

// Presentation compatibility only: persisted definition and observation freshness
// are verified again by Runtime inside the authorized transaction.
export function supportedRICECycleModel(version: string, snapshot: unknown) {
  if (!validProductModelVersion(version) || version === 'weighted-value-effort-v1' || !record(snapshot) || snapshot.version !== version) return false
  if (snapshot.effort_unit !== 'person_day' || snapshot.minimum_effort_person_days !== '0.50' || snapshot.priority_decimal_places !== 8 || snapshot.rounding !== 'half_up') return false
  if (JSON.stringify(snapshot.impact_values) !== '["0.25","0.50","1.00","2.00","3.00"]' || JSON.stringify(snapshot.confidence_values) !== '["0.50","0.80","1.00"]') return false
  if (!['unique_users', 'unique_customer_organizations'].includes(String(snapshot.reach_unit)) || typeof snapshot.reach_unit !== 'string' || !definition(snapshot.reach_definition) || !definition(snapshot.source_definition)) return false
  const start = date(snapshot.reach_starts_on), end = date(snapshot.reach_ends_on)
  return start !== null && end !== null && end >= start && end - start <= 366 * 86400000
}

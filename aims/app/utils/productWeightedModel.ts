export function validProductModelVersion(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed() && !!value.trim() && value === value.trim() && [...value].length <= 64 && !value.includes('/') && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

// Presentation compatibility only. Runtime verifies the immutable product version
// and computes scores from the cycle snapshot inside the command transaction.
export function supportedWeightedCycleModel(version: string, snapshot: unknown) {
  if (!validProductModelVersion(version) || !record(snapshot) || snapshot.version !== version || !record(snapshot.weights) || snapshot.effort_unit !== 'person_day' || snapshot.minimum_effort_person_days !== '0.50' || JSON.stringify(snapshot.confidence_values) !== '["0.50","0.80","1.00"]') return false
  const weights = ['strategic', 'user_value', 'business', 'risk'].map(key => snapshot.weights && (snapshot.weights as Record<string, unknown>)[key])
  if (weights.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100 || value % 5 !== 0) || (weights as number[]).reduce((sum, value) => sum + value, 0) !== 100) return false
  if (version === 'weighted-value-effort-v1') return weights.every((weight, index) => weight === [30, 30, 20, 20][index])
  return snapshot.dimension_scale === 'integer_0_to_5' && snapshot.value_scale === 100 && snapshot.priority_decimal_places === 8 && snapshot.rounding === 'half_up'
}

export const objectiveStates = { draft: '草稿', active: '进行中', closed: '已结束', archived: '已归档' }
export interface ProductObjective {
  id: number
  biz_id: string
  product_code: string
  title: string
  description: string
  starts_on: string
  ends_on: string
  owner_uid: string
  status: keyof typeof objectiveStates
  revision: number
  metric: { name: string, unit: string, measurement_definition: string, direction: 'increase' | 'decrease', baseline_value: string, target_value: string }
}

export const objectiveDecimal = (value: unknown): value is string => typeof value === 'string' && /^-?\d{1,14}\.\d{6}$/.test(value)
export const objectivePositive = (value: number) => Number.isSafeInteger(value) && value > 0
export function validObjectiveMetric(metric: ProductObjective['metric']) {
  return !!metric && ['increase', 'decrease'].includes(metric.direction) && objectiveDecimal(metric.baseline_value) && objectiveDecimal(metric.target_value) && [metric.name, metric.unit, metric.measurement_definition].every(value => typeof value === 'string' && !!value.trim())
}
export function validProductObjective(item: ProductObjective, code: string) {
  return !!item && objectivePositive(item.id) && objectivePositive(item.revision) && item.product_code === code && typeof item.biz_id === 'string' && !!item.biz_id && typeof item.title === 'string' && !!item.title.trim() && typeof item.description === 'string' && Object.hasOwn(objectiveStates, item.status) && typeof item.owner_uid === 'string' && !!item.owner_uid && /^\d{4}-\d{2}-\d{2}$/.test(item.starts_on) && /^\d{4}-\d{2}-\d{2}$/.test(item.ends_on) && item.ends_on >= item.starts_on && validObjectiveMetric(item.metric)
}

export interface ProductObjectiveObservationView {
  id: number
  biz_id: string
  product_code: string
  objective_id: number
  objective_revision: number
  metric_snapshot: ProductObjective['metric']
  observed_on: string
  measured_value: string
  attainment_percent: string | null
  evidence: string
  note: string
  created_by: string
  created_at: string
  correction_of_id: number | null
  correction_reason: string
  superseded_by_id: number | null
}

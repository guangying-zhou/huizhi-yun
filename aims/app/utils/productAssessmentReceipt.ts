const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function validProductAssessmentReceipt(response: unknown, expected: { cycleId: string, itemId: string, workspaceRevision: number, cycleRevision: number, queueRevision: number, rice: boolean }) {
  if (!record(response) || response.code !== 0 || !record(response.data) || !positive(response.data.receipt_id) || typeof response.data.replayed !== 'boolean' || !record(response.data.value)) return false
  const value = response.data.value
  if (!positive(value.assessment_id) || value.cycle_biz_id !== expected.cycleId || value.item_biz_id !== expected.itemId || value.workspace_revision !== expected.workspaceRevision + 1 || value.cycle_revision !== expected.cycleRevision + 1 || value.queue_revision !== expected.queueRevision || !record(value.score)) return false
  const score = value.score
  if (!Array.isArray(score.missing) || score.missing.some(key => typeof key !== 'string') || new Set(score.missing).size !== score.missing.length) return false
  if (score.priority_score !== null && (typeof score.priority_score !== 'string' || !/^\d+\.\d{8}$/.test(score.priority_score))) return false
  if ((score.missing.length > 0) !== (score.priority_score === null)) return false
  if (expected.rice) return score.value_score === null
  if (score.priority_score !== null && score.value_score === null) return false
  return score.value_score === null || (typeof score.value_score === 'number' && Number.isInteger(score.value_score) && score.value_score >= 0 && score.value_score <= 100)
}

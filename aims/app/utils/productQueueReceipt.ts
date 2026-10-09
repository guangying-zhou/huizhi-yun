const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function validProductQueueReceipt(response: unknown, expected: { cycleId: string, workspaceRevision: number, cycleRevision: number, queueRevision: number }) {
  if (!record(response) || response.code !== 0 || !record(response.data) || !positive(response.data.receipt_id) || typeof response.data.replayed !== 'boolean' || !record(response.data.value)) return false
  const value = response.data.value
  if (value.cycle_biz_id !== expected.cycleId || typeof value.changed !== 'boolean') return false
  const delta = value.changed ? 1 : 0
  return value.workspace_revision === expected.workspaceRevision + delta
    && value.cycle_revision === expected.cycleRevision + delta
    && value.queue_revision === expected.queueRevision + delta
}

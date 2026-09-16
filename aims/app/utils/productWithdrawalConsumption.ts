import type { ProductConsumptionView } from '~/types/productConsumption'

export function withdrawalConsumption(value: ProductConsumptionView, expected: { cycleId: string, itemId: string, workspaceRevision: number, cycleRevision: number, queueRevision: number, itemRevision: number, scopeRevision: number, lifecycle: string }) {
  if (!value || value.cycle_biz_id !== expected.cycleId || value.item_biz_id !== expected.itemId || value.workspace_revision !== expected.workspaceRevision || value.cycle_revision !== expected.cycleRevision || value.queue_revision !== expected.queueRevision || value.item_revision !== expected.itemRevision || value.scope_revision !== expected.scopeRevision || value.lifecycle !== expected.lifecycle || value.selection_status !== 'selected') throw new Error('周期事项或投入确认已变化，请重新读取')
  if (expected.lifecycle === 'proposed') return null
  const pending = value.pending
  if (expected.lifecycle !== 'in_delivery' || value.current !== true || !pending || pending.cycle_biz_id !== expected.cycleId || pending.item_biz_id !== expected.itemId || pending.item_revision !== expected.itemRevision || pending.scope_revision !== expected.scopeRevision || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pending.confirmation_id) || !/^\d+\.\d{2}$/.test(pending.spent_person_days) || Number(pending.spent_person_days) > 1000000) throw new Error('已开工事项需要当前有效的投入确认，请先请研发核验')
  return pending
}

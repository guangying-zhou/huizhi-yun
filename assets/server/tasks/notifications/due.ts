import { drainAssetsDueNotifications } from '~~/server/utils/dueNotificationDrain'
import { isUnifiedAssetsDueNotificationOwner } from '~~/server/utils/dueNotificationOwner'

export default defineTask({
  meta: {
    name: 'notifications:due',
    description: '按冻结时点扫描 Assets 到期与离职未回收条件并通知明确责任人'
  },
  async run({ context }) {
    let result: Record<string, unknown>
    try {
      result = await drainAssetsDueNotifications({
        pageSize: 100,
        maxPagesPerStream: 10,
        maxWallTimeMs: 45_000,
        taskContext: context as Record<string, unknown>
      })
    } catch (error) {
      if (!isUnifiedAssetsDueNotificationOwner(error)) throw error
      result = { enabled: true, skipped: 'unified_scheduler_owner' }
    }
    console.log('[assets:notifications:due]', result)
    return { result }
  }
})

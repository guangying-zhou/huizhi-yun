import { drainAssetsDueNotifications } from '~~/server/utils/dueNotificationDrain'

export default defineTask({
  meta: {
    name: 'notifications:due',
    description: '按冻结时点扫描 Assets 到期与离职未回收条件并通知明确责任人'
  },
  async run({ context }) {
    const result = await drainAssetsDueNotifications({
      pageSize: 100,
      maxPagesPerStream: 10,
      maxWallTimeMs: 45_000,
      taskContext: context as Record<string, unknown>
    })
    console.log('[assets:notifications:due]', result)
    return { result }
  }
})

import { drainAimsDueNotifications } from '~~/server/utils/dueNotificationDrain'

export default defineTask({
  meta: {
    name: 'notifications:due',
    description: '按冻结时点扫描 Aims SLA 与高风险工作项并统一通知明确责任人'
  },
  async run({ context }) {
    const result = await drainAimsDueNotifications({
      pageSize: 100,
      maxPagesPerStream: 10,
      maxWallTimeMs: 45_000,
      taskContext: context as Record<string, unknown>
    })
    console.log('[notifications:due]', result)
    return { result }
  }
})

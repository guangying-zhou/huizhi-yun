import { drainPeopleOffboardingNotifications } from '~~/server/utils/offboardingNotificationDrain'

export default defineTask({
  meta: {
    name: 'notifications:offboarding-due',
    description: '按冻结时点扫描 People 离职交接与资产回收协调任务并通知当前直接责任人'
  },
  async run({ context }) {
    const result = await drainPeopleOffboardingNotifications({
      taskContext: context,
      pageSize: 100,
      maxPagesPerStream: 10,
      maxWallTimeMs: 45_000
    })
    console.log('[people:notifications:offboarding-due]', result)
    return { result }
  }
})

import { drainAssetsOffboardingProjections } from '~~/server/utils/assetsOffboardingProjectionDrain'

export default defineTask({
  meta: {
    name: 'integrations:assets-offboarding',
    description: '将 People 已提交且已生效的离职事实可靠投影到 Assets 回收事项'
  },
  async run() {
    const result = await drainAssetsOffboardingProjections({ limit: 100, maxClaims: 20 })
    console.log('[people:integrations:assets-offboarding]', result)
    return { result }
  }
})

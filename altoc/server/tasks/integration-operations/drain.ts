import { drainIntegrationOperations } from '~~/server/utils/integrationOperationDrain'

export default defineTask({
  meta: {
    name: 'integration-operations:drain',
    description: '按租户预算领取并派发 Altoc 跨应用可靠操作'
  },
  async run() {
    const result = await drainIntegrationOperations({
      maxClaims: 20,
      maxWallTimeMs: 45_000
    })
    console.log('[integration-operations:drain]', result)
    return { result }
  }
})

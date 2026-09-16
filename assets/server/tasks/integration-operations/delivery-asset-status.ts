import { drainDeliveryAssetStatusOperations } from '~~/server/utils/deliveryAssetStatusOperation'

export default defineTask({
  meta: { name: 'integration-operations:delivery-asset-status', description: '可靠投递客户交付资产状态到 Altoc' },
  async run() {
    const result = await drainDeliveryAssetStatusOperations({ maxClaims: 20, maxWallTimeMs: 45_000, claimReserveMs: 25_000 })
    console.log('[assets:integration-operations:delivery-asset-status]', result)
    return { result }
  }
})

import { getRouterParam } from 'h3'
import { handleCustomerDeliveryAssetStatusSync } from '~~/server/utils/customerDeliveryAssetStatusSyncValidation'

export default defineEventHandler(async (event) => {
  return await handleCustomerDeliveryAssetStatusSync(event, {
    deliveryAssetCode: String(getRouterParam(event, 'deliveryAssetCode') || ''),
    statusCommand: String(getRouterParam(event, 'statusCommand') || '')
  })
})

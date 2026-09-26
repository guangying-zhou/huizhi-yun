import { defineEventHandler } from 'h3'
import { handleFeatureCycleList } from '../../../../../../../../aims/server/utils/productFeatureCycleRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../utils/enterpriseProductFeatures'
import { requireEnterpriseProductView } from '../../../../../../utils/enterpriseProductReadGate'

export default defineEventHandler(async (event) => {
  await requireEnterpriseProductView(event, 'product_priorities')
  return handleFeatureCycleList(event, await enterpriseProductFeatureBridge(event))
})

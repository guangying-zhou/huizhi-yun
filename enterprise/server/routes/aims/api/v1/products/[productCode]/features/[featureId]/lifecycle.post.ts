import { handleProductFeatureLifecycle } from '../../../../../../../../../../aims/server/utils/productFeatureLifecycleRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureLifecycle(event, await enterpriseProductFeatureBridge(event)))

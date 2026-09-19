import { handleFeatureCycleList } from '../../../../../../../../aims/server/utils/productFeatureCycleRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleFeatureCycleList(event, await enterpriseProductFeatureBridge(event)))

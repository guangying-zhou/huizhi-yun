import { handleProductFeatureRequests } from '../../../../../../../../../../aims/server/utils/productFeatureRequestRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureRequests(event, 'change', await enterpriseProductFeatureBridge(event)))

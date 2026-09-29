import { handleProductFeatureRead } from '../../../../../../../../../aims/server/utils/productFeatureReadRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureRead(event, 'list', await enterpriseProductFeatureBridge(event)))

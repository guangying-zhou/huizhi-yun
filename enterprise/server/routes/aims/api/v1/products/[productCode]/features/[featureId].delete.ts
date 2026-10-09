import { handleProductFeatureDelete } from '../../../../../../../../../aims/server/utils/productFeatureDeleteRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureDelete(event, await enterpriseProductFeatureBridge(event)))

import { handleProductFeatureCreate } from '../../../../../../../../../aims/server/utils/productFeatureCreateRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureCreate(event, await enterpriseProductFeatureBridge(event)))

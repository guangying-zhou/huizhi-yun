import { handleProductFeatureEdit } from '../../../../../../../../../aims/server/utils/productFeatureEditRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureEdit(event, await enterpriseProductFeatureBridge(event)))

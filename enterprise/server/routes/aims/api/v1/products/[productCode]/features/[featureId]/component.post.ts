import { handleProductFeatureComponent } from '../../../../../../../../../../aims/server/utils/productFeatureComponentRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureComponent(event, await enterpriseProductFeatureBridge(event)))

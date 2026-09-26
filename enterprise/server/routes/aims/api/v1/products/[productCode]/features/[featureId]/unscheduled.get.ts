import { handleProductFeatureUnscheduled } from '../../../../../../../../../../aims/server/utils/productFeatureUnscheduledRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureUnscheduled(event, await enterpriseProductFeatureBridge(event)))

import { handleProductFeatureRoadmap } from '../../../../../../../../../../aims/server/utils/productFeatureRoadmapRuntime'
import { enterpriseProductFeatureBridge } from '../../../../../../../../utils/enterpriseProductFeatures'

export default defineEventHandler(async event => handleProductFeatureRoadmap(event, await enterpriseProductFeatureBridge(event)))

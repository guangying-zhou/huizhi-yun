import { handleProductFeatureLifecycle } from '../../../../../../utils/productFeatureLifecycleRuntime'

export default defineEventHandler(event => handleProductFeatureLifecycle(event))

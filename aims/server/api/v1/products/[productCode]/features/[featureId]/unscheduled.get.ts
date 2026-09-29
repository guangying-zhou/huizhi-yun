import { handleProductFeatureUnscheduled } from '../../../../../../utils/productFeatureUnscheduledRuntime'

export default defineEventHandler(event => handleProductFeatureUnscheduled(event))

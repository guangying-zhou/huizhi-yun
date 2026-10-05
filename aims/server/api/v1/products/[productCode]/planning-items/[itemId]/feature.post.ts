import { handleProductPlanningFeature } from '../../../../../../utils/productPlanningFeatureRuntime'

export default defineEventHandler(event => handleProductPlanningFeature(event, 'change'))

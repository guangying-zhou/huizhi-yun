import { handleProductLightweightPlan } from '../../../../../../../../utils/productLightweightPlanRuntime'

export default defineEventHandler(event => handleProductLightweightPlan(event, 'item-delete'))

import { handleProductLightweightPlan } from '../../../../../../../../utils/productLightweightPlanRuntime'

export default defineEventHandler(event => handleProductLightweightPlan(event, 'item-create'))

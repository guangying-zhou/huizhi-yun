import { defineEventHandler } from 'h3'
import { handleProductLightweightPlan } from '../../../../../../../../../../../../aims/server/utils/productLightweightPlanRuntime'
import { enterpriseProductPlanningBridge } from '../../../../../../../../../../utils/enterpriseProductPlanning'

export default defineEventHandler(async event => handleProductLightweightPlan(event, 'item-list', await enterpriseProductPlanningBridge(event)))

import { defineEventHandler } from 'h3'
import { handleProductExecutionCoordination } from '../../../../../../../../../aims/server/utils/productExecutionCoordinationRuntime'
import { enterpriseProductPlanningBridge } from '../../../../../../../utils/enterpriseProductPlanning'
export default defineEventHandler(async event=>handleProductExecutionCoordination(event,await enterpriseProductPlanningBridge(event)))

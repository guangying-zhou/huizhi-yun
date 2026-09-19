import { defineEventHandler } from 'h3'
import { handleProductVersionAcceptance } from '../../../../../../../../../../../aims/server/utils/productVersionAcceptanceRuntime'
import { enterpriseProductPlanningBridge } from '../../../../../../../../../utils/enterpriseProductPlanning'
export default defineEventHandler(async event => handleProductVersionAcceptance(event, 'view', await enterpriseProductPlanningBridge(event)))

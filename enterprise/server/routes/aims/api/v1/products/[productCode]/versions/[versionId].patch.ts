import { defineEventHandler } from 'h3'
import { handleProductVersionCollection } from '../../../../../../../../../aims/server/utils/productVersionRuntime'
import { enterpriseProductPlanningBridge } from '../../../../../../../utils/enterpriseProductPlanning'

export default defineEventHandler(async event => handleProductVersionCollection(event, 'edit', await enterpriseProductPlanningBridge(event)))

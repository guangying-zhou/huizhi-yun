import { defineEventHandler } from 'h3'
import { handleProductVersionScope } from '../../../../../../../../../../../../aims/server/utils/productVersionScopeRuntime'
import { enterpriseProductPlanningBridge } from '../../../../../../../../../../utils/enterpriseProductPlanning'

export default defineEventHandler(async event => handleProductVersionScope(event, 'reopen', await enterpriseProductPlanningBridge(event)))

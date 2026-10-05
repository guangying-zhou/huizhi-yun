import { defineEventHandler } from 'h3'
import { handleProductPlanningPermissions } from '../../../../../../../../../aims/server/api/v1/products/[productCode]/planning-items/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../../utils/enterpriseProductAuthorization'
export default defineEventHandler(async event=>handleProductPlanningPermissions(event,await enterpriseProductAuthorizationSource(event)))

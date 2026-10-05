import { defineEventHandler } from 'h3'
import { handleProductRequestPermissions } from '../../../../../../../../../aims/server/api/v1/products/[productCode]/requests/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../../utils/enterpriseProductAuthorization'

export default defineEventHandler(async event => handleProductRequestPermissions(event, await enterpriseProductAuthorizationSource(event)))

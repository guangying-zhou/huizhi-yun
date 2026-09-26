import { defineEventHandler } from 'h3'
import { handleProductWorkspacePermissions } from '../../../../../../../../aims/server/api/v1/products/[productCode]/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../utils/enterpriseProductAuthorization'

export default defineEventHandler(async event => handleProductWorkspacePermissions(event, await enterpriseProductAuthorizationSource(event)))

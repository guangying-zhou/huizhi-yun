import { defineEventHandler } from 'h3'
import { handleProductVersionPermissions } from '../../../../../../../../../aims/server/api/v1/products/[productCode]/versions/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../../utils/enterpriseProductAuthorization'

export default defineEventHandler(async event => handleProductVersionPermissions(event, await enterpriseProductAuthorizationSource(event)))

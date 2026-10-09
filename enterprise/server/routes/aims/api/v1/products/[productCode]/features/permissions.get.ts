import { handleProductFeaturePermissions } from '../../../../../../../../../aims/server/api/v1/products/[productCode]/features/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../../utils/enterpriseProductAuthorization'

export default defineEventHandler(async event => handleProductFeaturePermissions(event, await enterpriseProductAuthorizationSource(event)))

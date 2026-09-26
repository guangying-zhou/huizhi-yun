import { handleProductComponentPermissions } from '../../../../../../../../../aims/server/api/v1/products/[productCode]/components/permissions.get'
import { enterpriseProductAuthorizationSource } from '../../../../../../../utils/enterpriseProductAuthorization'

export default defineEventHandler(async event => handleProductComponentPermissions(event, await enterpriseProductAuthorizationSource(event)))

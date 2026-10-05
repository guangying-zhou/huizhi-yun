import { resolveEnterprisePublishedAssetLink } from '../../../../utils/enterpriseCodocsPublishedAssetLinks'

export default defineEventHandler(event => resolveEnterprisePublishedAssetLink(event))

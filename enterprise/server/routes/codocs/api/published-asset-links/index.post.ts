import { createEnterprisePublishedAssetLink } from '../../../../utils/enterpriseCodocsPublishedAssetLinks'

export default defineEventHandler(event => createEnterprisePublishedAssetLink(event))

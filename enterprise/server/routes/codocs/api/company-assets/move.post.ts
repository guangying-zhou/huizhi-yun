import { mutateEnterpriseCompanyAsset } from '../../../../utils/enterpriseCodocsCompanyAssetsMutations'

export default defineEventHandler(event => mutateEnterpriseCompanyAsset(event, 'move'))

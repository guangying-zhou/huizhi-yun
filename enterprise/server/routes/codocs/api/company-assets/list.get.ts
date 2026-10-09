import { listEnterpriseCompanyAssets } from '../../../../utils/enterpriseCodocsCompanyAssets'

export default defineEventHandler(event => listEnterpriseCompanyAssets(event))

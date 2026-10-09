import { enterpriseCompanyAccessRecords } from '../../../../utils/enterpriseCodocsCompanyAccessRecords'

export default defineEventHandler(event => enterpriseCompanyAccessRecords(event))

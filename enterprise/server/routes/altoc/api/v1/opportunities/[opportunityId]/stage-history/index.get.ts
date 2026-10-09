import { enterpriseAltocSalesSupport } from '../../../../../../../utils/enterpriseAltocSalesSupport'

export default defineEventHandler(event => enterpriseAltocSalesSupport(event, 'opportunity-stage-history-list'))

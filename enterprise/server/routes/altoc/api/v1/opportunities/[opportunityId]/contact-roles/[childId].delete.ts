import { enterpriseAltocSalesSupport } from '../../../../../../../utils/enterpriseAltocSalesSupport'

export default defineEventHandler(event => enterpriseAltocSalesSupport(event, 'opportunity-contact-roles-delete'))

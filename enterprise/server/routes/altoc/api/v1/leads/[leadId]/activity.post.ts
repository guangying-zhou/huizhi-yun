import { enterpriseAltocSales } from '../../../../../../utils/enterpriseAltocSales'

export default defineEventHandler(event => enterpriseAltocSales(event, 'lead-activities-create'))

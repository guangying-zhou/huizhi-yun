import { enterpriseAltocSales } from '../../../../../../utils/enterpriseAltocSales'

export default defineEventHandler(event => enterpriseAltocSales(event, 'opportunities-close-lost'))

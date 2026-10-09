import { enterpriseAltocReceivables } from '../../../../../../utils/enterpriseAltocReceivables'

export default defineEventHandler(event => enterpriseAltocReceivables(event, 'receivables-set-collection-owner'))

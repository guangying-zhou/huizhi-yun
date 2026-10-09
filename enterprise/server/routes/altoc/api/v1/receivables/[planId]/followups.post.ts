import { enterpriseAltocReceivables } from '../../../../../../utils/enterpriseAltocReceivables'

export default defineEventHandler(event => enterpriseAltocReceivables(event, 'collection-followup-create'))

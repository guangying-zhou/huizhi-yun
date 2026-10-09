import { enterpriseAltocTenders } from '../../../../../utils/enterpriseAltocTenders'

export default defineEventHandler(event => enterpriseAltocTenders(event, 'tenders-update'))

import { enterpriseAltocServiceTickets } from '../../../../../../utils/enterpriseAltocServiceTickets'

export default defineEventHandler(event => enterpriseAltocServiceTickets(event, 'service-tickets-update'))

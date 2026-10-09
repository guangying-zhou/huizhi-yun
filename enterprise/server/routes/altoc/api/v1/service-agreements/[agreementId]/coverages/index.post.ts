import { defineEventHandler } from 'h3'
import { enterpriseAltocServiceAgreements } from '../../../../../../../utils/enterpriseAltocServiceAgreements'

export default defineEventHandler(event => enterpriseAltocServiceAgreements(event, 'service-coverages-create'))

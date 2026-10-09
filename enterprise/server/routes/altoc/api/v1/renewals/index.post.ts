import { defineEventHandler } from 'h3'
import { enterpriseAltocRenewals } from '../../../../../utils/enterpriseAltocRenewals'

export default defineEventHandler(event => enterpriseAltocRenewals(event, 'renewals-create'))

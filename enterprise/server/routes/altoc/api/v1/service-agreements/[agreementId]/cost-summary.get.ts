import { defineEventHandler } from 'h3'
import { enterpriseAltocFinancialSummary } from '../../../../../../utils/enterpriseAltocFinancialSummary'

export default defineEventHandler(event => enterpriseAltocFinancialSummary(event, 'service-cost-summary-view'))

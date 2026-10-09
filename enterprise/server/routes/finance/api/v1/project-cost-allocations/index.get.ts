import { defineEventHandler } from 'h3'
import { enterpriseFinanceCost } from '../../../../../utils/enterpriseFinanceCost'

export default defineEventHandler(event => enterpriseFinanceCost(event, 'project-cost-allocations-page'))

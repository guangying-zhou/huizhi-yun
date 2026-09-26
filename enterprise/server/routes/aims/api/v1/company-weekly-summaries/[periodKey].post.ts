import { defineEventHandler } from 'h3'
import { enterpriseAimsCompanyWeeklySummaryCommand } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsCompanyWeeklySummaryCommand)

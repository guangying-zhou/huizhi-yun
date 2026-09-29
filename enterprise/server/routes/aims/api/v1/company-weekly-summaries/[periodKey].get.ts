import { defineEventHandler } from 'h3'
import { enterpriseAimsCompanyWeeklySummary } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsCompanyWeeklySummary)

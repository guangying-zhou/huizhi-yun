import { defineEventHandler } from 'h3'
import { enterpriseAimsCompanyWeeklySummaryVersions } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsCompanyWeeklySummaryVersions)

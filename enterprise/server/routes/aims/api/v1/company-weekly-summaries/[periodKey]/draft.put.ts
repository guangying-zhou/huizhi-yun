import { defineEventHandler } from 'h3'
import { enterpriseAimsCompanyWeeklySummarySaveDraft } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsCompanyWeeklySummarySaveDraft)

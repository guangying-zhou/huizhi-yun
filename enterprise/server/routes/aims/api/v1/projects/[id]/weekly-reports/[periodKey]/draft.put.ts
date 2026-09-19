import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectWeeklyReportDraft } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsProjectWeeklyReportDraft)

import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectWeeklyReportSubmit } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsProjectWeeklyReportSubmit)

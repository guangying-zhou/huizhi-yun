import { defineEventHandler } from 'h3'
import { enterpriseAimsWeeklyReportCommand } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsWeeklyReportCommand)

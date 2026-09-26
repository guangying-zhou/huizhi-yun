import { defineEventHandler } from 'h3'
import { enterpriseAimsWeeklyPeriodWorkbench } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsWeeklyPeriodWorkbench)

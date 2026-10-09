import { defineEventHandler } from 'h3'
import { enterpriseAimsWeeklyPeriodGenerate } from '~~/server/utils/enterpriseAimsWeeklyGovernance'

export default defineEventHandler(enterpriseAimsWeeklyPeriodGenerate)

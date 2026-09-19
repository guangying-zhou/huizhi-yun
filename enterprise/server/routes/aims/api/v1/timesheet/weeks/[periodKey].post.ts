import { defineEventHandler } from 'h3'
import { enterpriseAimsTimesheetWeekSubmit } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsTimesheetWeekSubmit)

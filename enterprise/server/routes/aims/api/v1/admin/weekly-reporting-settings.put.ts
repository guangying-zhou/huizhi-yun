import { defineEventHandler } from 'h3'
import { enterpriseAimsWeeklyReportingSettingsUpdate } from '~~/server/utils/enterpriseAimsWeeklyReportingSettings'

export default defineEventHandler(enterpriseAimsWeeklyReportingSettingsUpdate)

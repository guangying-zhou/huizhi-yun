import { defineEventHandler } from 'h3'
import { enterpriseAimsTimeEntryReviews } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsTimeEntryReviews)

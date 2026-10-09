import { defineEventHandler } from 'h3'
import { enterpriseAimsTimeEntryReviewSubmit } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsTimeEntryReviewSubmit)

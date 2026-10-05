import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectTimeEntryUpdate } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsProjectTimeEntryUpdate)

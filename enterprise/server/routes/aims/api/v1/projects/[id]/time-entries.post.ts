import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectTimeEntryCreate } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsProjectTimeEntryCreate)

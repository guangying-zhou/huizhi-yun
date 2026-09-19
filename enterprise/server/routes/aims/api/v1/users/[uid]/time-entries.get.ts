import { defineEventHandler } from 'h3'
import { enterpriseAimsUserTimeEntries } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsUserTimeEntries)

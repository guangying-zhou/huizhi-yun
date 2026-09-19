import { defineEventHandler } from 'h3'
import { enterpriseAimsMyWorkItems } from '~~/server/utils/enterpriseAimsTimesheet'

export default defineEventHandler(enterpriseAimsMyWorkItems)

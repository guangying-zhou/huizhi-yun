import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectWorkItems } from '~~/server/utils/enterpriseAimsProjectWorkspace'

export default defineEventHandler(enterpriseAimsProjectWorkItems)

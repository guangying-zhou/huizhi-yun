import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemTransitions } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemTransitions)

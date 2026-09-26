import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemExecutionContext } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemExecutionContext)

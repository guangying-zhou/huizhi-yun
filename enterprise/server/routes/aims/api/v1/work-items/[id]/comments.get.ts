import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemComments } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemComments)

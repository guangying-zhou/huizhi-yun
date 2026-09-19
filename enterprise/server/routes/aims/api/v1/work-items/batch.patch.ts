import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemBatchUpdate } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemBatchUpdate)

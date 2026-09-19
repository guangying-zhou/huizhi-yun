import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemCommentCreate } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemCommentCreate)

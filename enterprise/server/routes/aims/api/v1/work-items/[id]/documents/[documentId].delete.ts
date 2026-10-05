import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemDocumentUnlink } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemDocumentUnlink)

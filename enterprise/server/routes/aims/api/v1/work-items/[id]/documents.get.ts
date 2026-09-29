import { defineEventHandler } from 'h3'
import { enterpriseAimsWorkItemDocuments } from '~~/server/utils/enterpriseAimsWorkItemWorkspace'

export default defineEventHandler(enterpriseAimsWorkItemDocuments)

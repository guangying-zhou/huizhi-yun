import { defineEventHandler } from 'h3'
import { enterpriseAimsUpdateDocumentAccessPolicy } from '~~/server/utils/enterpriseAimsProjectDocumentAccess'

export default defineEventHandler(enterpriseAimsUpdateDocumentAccessPolicy)

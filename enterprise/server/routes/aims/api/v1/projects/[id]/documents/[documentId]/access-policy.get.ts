import { defineEventHandler } from 'h3'
import { enterpriseAimsReadDocumentAccessPolicy } from '~~/server/utils/enterpriseAimsProjectDocumentAccess'

export default defineEventHandler(enterpriseAimsReadDocumentAccessPolicy)

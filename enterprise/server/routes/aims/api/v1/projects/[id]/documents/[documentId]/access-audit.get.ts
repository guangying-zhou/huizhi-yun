import { defineEventHandler } from 'h3'
import { enterpriseAimsListDocumentAccessAudit } from '~~/server/utils/enterpriseAimsProjectDocumentAccess'

export default defineEventHandler(enterpriseAimsListDocumentAccessAudit)

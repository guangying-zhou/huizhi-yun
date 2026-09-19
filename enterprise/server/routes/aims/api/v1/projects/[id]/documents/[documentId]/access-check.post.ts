import { defineEventHandler } from 'h3'
import { enterpriseAimsCheckDocumentAccess } from '~~/server/utils/enterpriseAimsProjectDocumentAccess'

export default defineEventHandler(enterpriseAimsCheckDocumentAccess)

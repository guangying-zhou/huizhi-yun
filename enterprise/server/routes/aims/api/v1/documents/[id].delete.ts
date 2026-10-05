import { defineEventHandler } from 'h3'
import { enterpriseAimsDeleteProjectDocument } from '~~/server/utils/enterpriseAimsProjectDocumentWrites'

export default defineEventHandler(enterpriseAimsDeleteProjectDocument)

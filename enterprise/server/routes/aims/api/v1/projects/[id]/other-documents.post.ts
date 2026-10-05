import { defineEventHandler } from 'h3'
import { enterpriseAimsUploadProjectDocument } from '~~/server/utils/enterpriseAimsProjectDocumentWrites'

export default defineEventHandler(enterpriseAimsUploadProjectDocument)

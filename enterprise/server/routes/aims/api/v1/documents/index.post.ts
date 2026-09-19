import { defineEventHandler } from 'h3'
import { enterpriseAimsCreateProjectDocument } from '~~/server/utils/enterpriseAimsProjectDocumentWrites'

export default defineEventHandler(enterpriseAimsCreateProjectDocument)

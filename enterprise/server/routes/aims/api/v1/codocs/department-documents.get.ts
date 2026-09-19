import { defineEventHandler } from 'h3'
import { enterpriseAimsDepartmentDocuments } from '~~/server/utils/enterpriseAimsProjectDocumentSources'

export default defineEventHandler(enterpriseAimsDepartmentDocuments)

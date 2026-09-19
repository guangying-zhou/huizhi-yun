import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectDocumentPreview } from '~~/server/utils/enterpriseAimsProjectDocumentFiles'

export default defineEventHandler(enterpriseAimsProjectDocumentPreview)

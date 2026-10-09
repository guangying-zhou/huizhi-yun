import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectDocumentDownload } from '~~/server/utils/enterpriseAimsProjectDocumentFiles'

export default defineEventHandler(enterpriseAimsProjectDocumentDownload)

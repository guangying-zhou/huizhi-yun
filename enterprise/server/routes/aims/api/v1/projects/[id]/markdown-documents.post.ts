import { defineEventHandler } from 'h3'
import { enterpriseAimsCreateProjectMarkdownDocument } from '~~/server/utils/enterpriseAimsProjectDocumentWrites'

export default defineEventHandler(enterpriseAimsCreateProjectMarkdownDocument)

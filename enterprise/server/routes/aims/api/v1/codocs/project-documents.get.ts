import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioDocuments } from '~~/server/utils/enterpriseAimsProjectDocumentSources'

export default defineEventHandler(enterpriseAimsPortfolioDocuments)

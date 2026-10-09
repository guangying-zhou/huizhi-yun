import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioDocumentPolicy } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioDocumentPolicy)

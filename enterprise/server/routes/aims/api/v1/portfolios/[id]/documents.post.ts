import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioDocumentCreate } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioDocumentCreate)

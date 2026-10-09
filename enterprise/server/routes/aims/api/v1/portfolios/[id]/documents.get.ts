import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioDocumentList } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioDocumentList)

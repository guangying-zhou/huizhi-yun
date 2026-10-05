import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioUpdate } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioUpdate)

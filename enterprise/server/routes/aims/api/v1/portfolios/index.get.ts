import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioList } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioList)

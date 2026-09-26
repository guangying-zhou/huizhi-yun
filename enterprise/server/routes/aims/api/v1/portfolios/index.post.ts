import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioCreate } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioCreate)

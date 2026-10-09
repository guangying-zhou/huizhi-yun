import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioDocRepoSave } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioDocRepoSave)

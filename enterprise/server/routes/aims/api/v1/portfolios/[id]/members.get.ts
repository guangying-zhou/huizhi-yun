import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioMembers } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioMembers)

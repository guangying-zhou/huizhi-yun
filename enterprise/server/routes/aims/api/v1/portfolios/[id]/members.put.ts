import { defineEventHandler } from 'h3'
import { enterpriseAimsPortfolioMemberSave } from '~~/server/utils/enterpriseAimsPortfolios'

export default defineEventHandler(enterpriseAimsPortfolioMemberSave)

import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectProducts } from '~~/server/utils/enterpriseAimsProjectProducts'

export default defineEventHandler(enterpriseAimsProjectProducts)

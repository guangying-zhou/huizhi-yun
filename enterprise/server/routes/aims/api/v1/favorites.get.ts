import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectFavorites } from '~~/server/utils/enterpriseAimsProjectWorkspace'

export default defineEventHandler(enterpriseAimsProjectFavorites)

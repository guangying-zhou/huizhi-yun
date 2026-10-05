import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectModules } from '~~/server/utils/enterpriseAimsProjectLifecycle'

export default defineEventHandler(enterpriseAimsProjectModules)

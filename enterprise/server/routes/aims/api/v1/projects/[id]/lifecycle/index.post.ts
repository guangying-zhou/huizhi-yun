import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectLifecycle } from '~~/server/utils/enterpriseAimsProjectLifecycle'

export default defineEventHandler(enterpriseAimsProjectLifecycle)

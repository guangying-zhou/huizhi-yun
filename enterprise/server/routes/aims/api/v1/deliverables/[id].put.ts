import { defineEventHandler } from 'h3'
import { enterpriseAimsDeliverableUpdate } from '~~/server/utils/enterpriseAimsDeliverables'

export default defineEventHandler(enterpriseAimsDeliverableUpdate)

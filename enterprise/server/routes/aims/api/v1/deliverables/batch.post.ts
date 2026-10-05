import { defineEventHandler } from 'h3'
import { enterpriseAimsDeliverableBatchCreate } from '~~/server/utils/enterpriseAimsDeliverables'

export default defineEventHandler(enterpriseAimsDeliverableBatchCreate)

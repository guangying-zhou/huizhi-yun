import { defineEventHandler } from 'h3'
import { enterpriseAimsMatterDeliverableCreate } from '~~/server/utils/enterpriseAimsDeliverables'

export default defineEventHandler(enterpriseAimsMatterDeliverableCreate)

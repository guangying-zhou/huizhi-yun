import { defineEventHandler } from 'h3'
import { enterpriseAimsDeliverableList } from '~~/server/utils/enterpriseAimsDeliverables'

export default defineEventHandler(enterpriseAimsDeliverableList)

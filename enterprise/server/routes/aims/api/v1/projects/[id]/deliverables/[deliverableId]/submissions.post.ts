import { defineEventHandler } from 'h3'
import { enterpriseAimsDeliverableQuality } from '~~/server/utils/enterpriseAimsDeliverableQuality'

export default defineEventHandler(event => enterpriseAimsDeliverableQuality(event, 'submission'))

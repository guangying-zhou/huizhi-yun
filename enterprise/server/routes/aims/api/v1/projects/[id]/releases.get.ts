import { defineEventHandler } from 'h3'
import { enterpriseAimsProjectReleases } from '~~/server/utils/enterpriseAimsDeliverables'

export default defineEventHandler(enterpriseAimsProjectReleases)

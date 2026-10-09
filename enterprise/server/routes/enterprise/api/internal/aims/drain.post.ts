import { defineEventHandler } from 'h3'
import { drainEnterpriseAims } from '../../../../../utils/enterpriseAimsScheduler'

export default defineEventHandler(async event => ({ code: 0, data: await drainEnterpriseAims(event) }))

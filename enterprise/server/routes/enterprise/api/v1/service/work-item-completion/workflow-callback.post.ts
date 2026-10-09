import { defineEventHandler, readBody } from 'h3'
import { receiveWorkflowCallback } from '../../../../../../../../aims/layer/server/index'
import { requireEnterpriseAimsServiceIngress } from '../../../../../../utils/enterpriseAimsServiceIngress'

// Completion is retained for historical requests and installations with lane disabled.
export default defineEventHandler(async (event) => {
  await requireEnterpriseAimsServiceIngress(event, 'callback')
  return await receiveWorkflowCallback(event, 'completion', await readBody(event))
})

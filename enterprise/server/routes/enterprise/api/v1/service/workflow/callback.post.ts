import { receiveEnterprisePeopleWorkflow } from '../../../../../../utils/enterprisePeopleWorkflow'
import { createError, defineEventHandler, readBody } from 'h3'
import { receiveWorkflowCallback } from '../../../../../../../../aims/layer/server/index'
import { requireEnterpriseAimsServiceIngress } from '../../../../../../utils/enterpriseAimsServiceIngress'

import { callEnterpriseSystemRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeChannels'

// Completion is retained for historical requests and installations with lane disabled.
export default defineEventHandler(async (event) => {
  await requireEnterpriseAimsServiceIngress(event, 'callback')
  const body = await readBody<Record<string, unknown>>(event)
  if (body?.app_code === 'people') return await receiveEnterprisePeopleWorkflow(event, body)
  if (body?.app_code === 'finance') {
    if (!((body.resource_code === 'invoices' && body.action_code === 'request') || (body.resource_code === 'expenses' && ['claim', 'project_expense', 'payment'].includes(String(body.action_code)))) || body.event !== 'flow_completed') throw createError({ statusCode: 403 })
    return await callEnterpriseSystemRuntime(event, 'finance.approval-callback', body)
  }
  if (body?.app_code === 'altoc') {
    if (!['quotation', 'contract'].includes(String(body.resource_code)) || body.action_code !== 'approve' || body.event !== 'flow_completed') throw createError({ statusCode: 403 })
    return await callEnterpriseSystemRuntime(event, 'altoc.approval-callback', body)
  }
  return await receiveWorkflowCallback(event, 'standard', body)
})

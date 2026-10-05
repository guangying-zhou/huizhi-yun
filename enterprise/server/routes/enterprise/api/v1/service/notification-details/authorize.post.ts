import { createError, defineEventHandler, readBody } from 'h3'
import { receiveAimsNotificationAuthorization } from '../../../../../../../../aims/layer/server/index'
import { receiveAssetsNotificationAuthorization } from '../../../../../../../../assets/layer/server/index'
import { requireEnterpriseAimsServiceIngress } from '../../../../../../utils/enterpriseAimsServiceIngress'

export default defineEventHandler(async (event) => {
  await requireEnterpriseAimsServiceIngress(event, 'notification')
  const body = await readBody<Record<string, unknown>>(event)
  if (body?.sourceAppCode === 'aims') return await receiveAimsNotificationAuthorization(event, body, false)
  if (body?.sourceAppCode === 'assets') return await receiveAssetsNotificationAuthorization(event, body)
  throw createError({ statusCode: 403, message: 'Notification owning application is not supported.' })
})
